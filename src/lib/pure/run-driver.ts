/**
 * The driver of an install run: the small async part that reads, writes and emits events
 * (RUN-6, RUN-16 to RUN-20). The state is `run.ts`; what an item does is `run-item.ts`.
 *
 * `createRun` is what a screen holds:
 *
 * ```ts
 * const run = createRun({ port, reader, site: { siteUrl, trashPageUrl }, applyVisibility });
 * const stop = run.subscribe((state) => render(state));
 * await run.start(selectedEntries);   // re-plans, then applies, one item at a time
 * run.cancel();                       // honoured between items and between visibility steps
 * await run.retry();                  // the failed rows only
 * await run.resume();                 // the rows a cancel left pending
 * await run.retryVisibility(entryId); // one row's visibility again
 * run.reset();                        // back to idle: the screen's refresh
 * ```
 *
 * The order of a run (RUN-6):
 *
 * 1. Re-plan from the site: the entity types, one read per entry, and the field listing of each
 *    type that has an absent field. All reads. A read that fails ends the run with a run-level
 *    error and nothing written (RUN-17).
 * 2. The items, in the order of the entries, one after the other. Nothing runs beside an item:
 *    each call is awaited before the next, so no two schema writes are ever in flight.
 * 3. After an item's schema work, its visibility, when a visibility step was given (RUN-7).
 *
 * Cancel (RUN-18) is looked at before each item and handed to the visibility step, which asks
 * between projects. An item's schema work is one step: a cancel never leaves an update half
 * sent or a write unverified. A cancel before the first item comes after the re-plan's reads
 * and before any write. The run ends `cancelled` only when something was left undone: a row
 * still pending, or a visibility cut short. A cancel that arrives during the last item's schema
 * work changes nothing, and the run ends `finished`.
 *
 * Only one operation runs at a time. Starting another while one runs rejects.
 */
import { needsRead, planEntry, type PlanEntry, type PlanItem, type PlanSite } from './plan';
import type { LiveField, LiveFieldRead } from './live-field';
import { applyItem } from './run-item';
import { errorMessage, type RunReader, type SchemaWritePort } from './run-port';
import { INITIAL_RUN_STATE, needsVisibilityRetry, reduceRun, resumeIds, retryIds, type RunEvent, type RunState } from './run';
import type { ApplyVisibility, FieldOrigin, VisibilityHooks, VisibilityOutcome } from './visibility-types';

export interface RunDeps {
	/** The writes. */
	port: SchemaWritePort;
	/** The reads, each one fresh from the site. */
	reader: RunReader;
	/** The site's address and its trash page for fields, or null when it has none (corpus finding 120). */
	site: { siteUrl: string; trashPageUrl: string | null };
	/**
	 * Per-project visibility (VIS-4 to VIS-7). Left out: no visibility is applied and the rows say
	 * nothing about it, the fallback of the VIS requirements.
	 */
	applyVisibility?: ApplyVisibility;
	/**
	 * Applies visibility again on the projects that failed, and only those (VIS-7). `visibility-run`'s
	 * `retryVisibility`, bound to its port and plan, fits. Left out: a row's retry applies the whole
	 * scope again with `applyVisibility`, which writes only where the site differs.
	 */
	retryVisibility?: (
		field: { entityType: string; name: string },
		origin: FieldOrigin,
		projectIds: number[],
		hooks: VisibilityHooks
	) => Promise<VisibilityOutcome>;
}

/** How many one-field reads of the re-plan are in flight at once. Reads only. */
const READS_AT_ONCE = 8;

/**
 * The plan of these entries, read fresh from the site (RUN-6, PLN-3). Reads only. Rejects when
 * any read fails: a failed read is never taken for an absent field.
 */
export async function replan(deps: Pick<RunDeps, 'reader' | 'site'>, entries: readonly PlanEntry[]): Promise<{ site: PlanSite; items: PlanItem[] }> {
	const entityTypes = await deps.reader.entityTypes();
	const toRead = entries.filter((entry) => needsRead(entry, entityTypes));
	const reads = new Map<string, LiveFieldRead>();
	for (let start = 0; start < toRead.length; start += READS_AT_ONCE) {
		const batch = toRead.slice(start, start + READS_AT_ONCE);
		const answers = await Promise.all(batch.map((entry) => deps.reader.field(entry.targetEntityType.trim(), entry.programmaticName.trim())));
		batch.forEach((entry, index) => reads.set(entry.id, answers[index]));
	}
	// The listing of each type with an absent field: the plan checks the label against it (PLN-16).
	const fieldsByType = new Map<string, readonly LiveField[]>();
	for (const entry of toRead) {
		const type = entry.targetEntityType.trim();
		if (reads.get(entry.id)?.kind === 'absent' && !fieldsByType.has(type)) fieldsByType.set(type, await deps.reader.fields(type));
	}
	const site: PlanSite = { siteUrl: deps.site.siteUrl, trashPageUrl: deps.site.trashPageUrl, entityTypes, fieldsByType };
	const items: PlanItem[] = [];
	for (const entry of entries) {
		const item = planEntry(entry, reads.get(entry.id) ?? null, site);
		// A mirror entry is never planned (PLN-10): it gets no row.
		if (item !== null) items.push(item);
	}
	return { site, items };
}

type Emit = (event: RunEvent) => void;

/** Applies one field's visibility and reports it on its row. True when a cancel cut it short. */
async function showOn(
	apply: (hooks: VisibilityHooks) => Promise<VisibilityOutcome>,
	emit: Emit,
	isCancelled: () => boolean,
	entryId: string,
	origin: FieldOrigin
): Promise<boolean> {
	if (isCancelled()) {
		emit({ type: 'visibility-skipped', entryId, origin });
		return true;
	}
	emit({ type: 'visibility-started', entryId, origin });
	let outcome: VisibilityOutcome | null = null;
	let error: string | null = null;
	try {
		outcome = await apply({ isCancelled, onProgress: (done, total) => emit({ type: 'visibility-progress', entryId, done, total }) });
	} catch (failure) {
		// The step promises never to throw. If it does, the row carries the error and stays done.
		error = errorMessage(failure);
	}
	emit({ type: 'visibility-finished', entryId, outcome, error });
	return outcome?.cancelled === true;
}

/**
 * One pass of a run over these entries: re-plan, then each item in order. Emits every change
 * and ends with exactly one `finished` event. Never rejects.
 */
export async function drive(deps: RunDeps, entries: readonly PlanEntry[], emit: Emit, isCancelled: () => boolean): Promise<void> {
	let site: PlanSite;
	let items: PlanItem[];
	try {
		({ site, items } = await replan(deps, entries));
	} catch (error) {
		emit({ type: 'finished', status: 'finished', error: errorMessage(error) });
		return;
	}
	emit({ type: 'planned', items });

	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	let cut = false;
	for (const item of items) {
		const entry = byId.get(item.entryId);
		if (!entry) continue;
		if (isCancelled()) {
			cut = true;
			break;
		}
		const entryId = item.entryId;
		emit({ type: 'item-started', entryId });
		const result = await applyItem(
			{ port: deps.port, reader: deps.reader, site, onEffect: (effect) => emit({ type: 'field-changed', entryId, effect }) },
			entry,
			item
		);
		const apply = deps.applyVisibility;
		const origin = result.visibility;
		if (origin !== null && apply && result.abort === null) {
			const field = { entityType: item.entityType, name: item.programmaticName };
			if (await showOn((hooks) => apply(field, origin, hooks), emit, isCancelled, entryId, origin)) cut = true;
		}
		emit({ type: 'item-finished', entryId, state: result.state, note: result.note });
		if (result.abort !== null) {
			emit({ type: 'finished', status: 'finished', error: result.abort });
			return;
		}
	}
	emit({ type: 'finished', status: cut ? 'cancelled' : 'finished', error: null });
}

export interface Run {
	/** The state now. A new object after every event; never altered in place. */
	getState(): RunState;
	/** Calls `listener` after every event. Returns the function that stops it. */
	subscribe(listener: (state: RunState) => void): () => void;
	/**
	 * Starts the run for these entries, in this order: the rows the person selected (RUN-6).
	 * Resolves with the final state when the run has ended. Rejects, with nothing done, when a run
	 * is in progress or one has already been started: `reset` first.
	 */
	start(entries: readonly PlanEntry[]): Promise<RunState>;
	/** Asks the run to stop after the step in flight (RUN-18). Does nothing when nothing runs. */
	cancel(): void;
	/** Runs the failed rows again, re-planned from the site (RUN-19). Resolves at once when there are none. */
	retry(): Promise<RunState>;
	/** Runs the rows still pending after a cancel or a run-level error (RUN-20). */
	resume(): Promise<RunState>;
	/** Applies one row's visibility again (VIS-7). Rejects when the row has nothing to retry. */
	retryVisibility(entryId: string): Promise<RunState>;
	/** Forgets the run: idle, no rows. Rejects nothing; does nothing while a run is in progress. */
	reset(): void;
}

export function createRun(deps: RunDeps): Run {
	let state = INITIAL_RUN_STATE;
	let entries: readonly PlanEntry[] = [];
	let busy = false;
	let cancelled = false;
	const listeners = new Set<(state: RunState) => void>();

	const emit: Emit = (event) => {
		const next = reduceRun(state, event);
		if (next === state) return;
		state = next;
		for (const listener of listeners) listener(state);
	};

	/** One operation at a time. The check and the flag are set before anything is awaited. */
	async function exclusive(work: () => Promise<void>): Promise<RunState> {
		if (busy) throw new Error('A run is in progress.');
		busy = true;
		cancelled = false;
		try {
			await work();
		} finally {
			busy = false;
		}
		return state;
	}

	function rerun(ids: string[]): Promise<RunState> {
		if (busy) return Promise.reject(new Error('A run is in progress.'));
		if (ids.length === 0) return Promise.resolve(state);
		const wanted = new Set(ids);
		return exclusive(async () => {
			emit({ type: 'rerun', entryIds: ids });
			await drive(
				deps,
				entries.filter((entry) => wanted.has(entry.id)),
				emit,
				() => cancelled
			);
		});
	}

	return {
		getState: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		start(selected) {
			if (!busy && state.status !== 'idle') return Promise.reject(new Error('This run has already started. Reset it first.'));
			return exclusive(async () => {
				entries = [...selected];
				emit({ type: 'started' });
				await drive(deps, entries, emit, () => cancelled);
			});
		},
		cancel() {
			if (!busy || cancelled) return;
			cancelled = true;
			emit({ type: 'cancel-requested' });
		},
		retry: () => rerun(retryIds(state)),
		resume: () => rerun(resumeIds(state)),
		retryVisibility(entryId) {
			const row = state.rows.find((candidate) => candidate.entryId === entryId);
			const apply = deps.applyVisibility;
			if (!busy && (!row || !row.visibility || !apply || !needsVisibilityRetry(row))) {
				return Promise.reject(new Error('This row has no visibility to retry.'));
			}
			return exclusive(async () => {
				if (!row?.visibility || !apply) return;
				const before = state.status === 'cancelled' ? 'cancelled' : 'finished';
				const { origin, failures, status, error } = row.visibility;
				const field = { entityType: row.entityType, name: row.programmaticName };
				// Only the failed projects when that is all there is to redo; else the whole scope again.
				const failedOnly = deps.retryVisibility && status === 'applied' && error === null ? deps.retryVisibility : null;
				const projectIds = failures.map((failure) => failure.projectId);
				emit({ type: 'visibility-retry', entryId });
				const cut = await showOn(
					(hooks) => (failedOnly ? failedOnly(field, origin, projectIds, hooks) : apply(field, origin, hooks)),
					emit,
					() => cancelled,
					entryId,
					origin
				);
				emit({ type: 'finished', status: cut ? 'cancelled' : before, error: null });
			});
		},
		reset() {
			if (busy) return;
			entries = [];
			emit({ type: 'reset' });
		}
	};
}
