/**
 * The install run as a state machine (specs/08-install-run.md, RUN-6 to RUN-27).
 *
 * This module is the state and nothing else: what a run looks like at any moment, the events
 * that change it, and one pure reducer. The screen renders the state. The driver
 * (`run-driver.ts`) does the I/O and emits the events. The text is in `run-text.ts`, the report
 * in `run-report.ts`.
 *
 * | run status  | means                                                                    |
 * |-------------|--------------------------------------------------------------------------|
 * | `idle`      | nothing started                                                          |
 * | `running`   | re-planning, applying items, or applying one row's visibility again      |
 * | `finished`  | ended on its own, with or without failures, or on a run-level error      |
 * | `cancelled` | a cancel left something undone (RUN-18)                                  |
 *
 * | row state     | means                                                                  |
 * |---------------|------------------------------------------------------------------------|
 * | `pending`     | not started                                                            |
 * | `in_progress` | being applied, its visibility included                                 |
 * | `done`        | the field was created, revived or updated, and reads back as wanted    |
 * | `skipped`     | no schema write was needed or allowed. `note` says why                 |
 * | `failed`      | `note` says what went wrong. Retry runs it again (RUN-19)              |
 *
 * A row's `class` is the class the last re-plan gave it. A re-plan happens at the start, on retry
 * and on resume, and only then does a row's class change (RUN-19). What an item finds when it
 * re-reads its field is told by the row's note, not by its class.
 *
 * A visibility failure never fails a row (VIS-7, Q5): the row is done or skipped and its
 * `visibility` holds the projects that failed.
 */
import type { Difference } from './plan-diff';
import type { PlanClass, PlanItem } from './plan';
import type { PlanReason } from './plan-reason';
import type { FieldOrigin, VisibilityFailure, VisibilityOutcome } from './visibility-types';

export type RunStatus = 'idle' | 'running' | 'finished' | 'cancelled';

export type RowState = 'pending' | 'in_progress' | 'done' | 'skipped' | 'failed';

/** A call the run makes on a site. */
export type RunAction = 'read' | 'create' | 'update' | 'revive' | 'retire';

/** What had just been written when a read-back went wrong. */
export type WriteKind = 'create' | 'revive' | 'update';

/** One change the run made to the site's schema. `name` is the field's programmatic name on the site. */
export interface FieldEffect {
	/** `retired`: the run put a field it had just created or revived back in the trash (RUN-10, RUN-12). */
	kind: 'created' | 'revived' | 'updated' | 'retired';
	name: string;
	/**
	 * The entity types the write made a reverse field on (`PlanItem.reverseFieldTypes`, corpus
	 * findings 116 and 121). Each took a field name there for good. Left out when it made none.
	 */
	reverseFieldTypes?: string[];
}

/** How a re-trash went (RUN-10, RUN-12). */
export interface Retrash {
	/** Whether the field is back in the trash. */
	retired: boolean;
	/** Why it is not, in the server's words. Null when it is. */
	retireError: string | null;
}

/**
 * Why a row was skipped or failed, as data. `run-text.ts` words each one.
 *
 * | code                 | row state       | means                                                              |
 * |----------------------|-----------------|--------------------------------------------------------------------|
 * | `plan`               | skipped, failed | the plan's own reasons: type conflict, blocked, refused (RUN-7)    |
 * | `nothing-to-change`  | skipped         | the field already matches (RUN-7)                                  |
 * | `already-exists`     | skipped         | a create found the field live with the wanted type (RUN-8)         |
 * | `unknown-valid-types`| failed          | a valid type is not an entity type of the site; nothing was sent   |
 * | `gone`               | failed          | an update found the field gone (RUN-7)                             |
 * | `not-applied`        | failed          | the read-back differs from what was written (RUN-15)               |
 * | `unreadable`         | failed          | the field could not be read after a write (RUN-10)                 |
 * | `refused`            | failed          | the site refused a call, or the call got no answer (RUN-27)        |
 * | `retired-other-type` | failed          | the revived field has another data type; re-trashed (RUN-10)       |
 * | `retired-blocked`    | failed          | the revived field has a blocked difference; re-trashed (RUN-10)    |
 * | `name-retired`       | failed          | the create was refused: a retired field holds the name (RUN-14)    |
 * | `wrong-name`         | failed          | the site gave the new field another name; re-trashed (RUN-12)      |
 * | `error`              | failed          | something broke that is not the site's answer                      |
 */
export type RowNote =
	| { code: 'plan'; reasons: PlanReason[] }
	| { code: 'nothing-to-change' }
	| {
			code: 'already-exists';
			/** Where the live field differs from the entry. Left as they are: the row was planned as a create (RUN-8). */
			differences: Difference[];
	  }
	| {
			code: 'unknown-valid-types';
			/** The names that are no entity type of the site, case included. */
			names: string[];
	  }
	| { code: 'gone' }
	| { code: 'not-applied'; after: WriteKind; differences: Difference[] }
	| { code: 'unreadable'; after: WriteKind; message: string | null }
	| {
			code: 'refused';
			action: RunAction;
			/** The error status, or null when no answer came. */
			status: number | null;
			/** The server's message (RUN-27). */
			message: string;
			/** True when earlier requests of the same update were written. */
			partial: boolean;
	  }
	| ({ code: 'retired-other-type'; liveDataType: string; trashPageUrl: string | null } & Retrash)
	| ({ code: 'retired-blocked'; reasons: PlanReason[]; trashPageUrl: string | null } & Retrash)
	| { code: 'name-retired'; name: string; trashPageUrl: string | null }
	| ({ code: 'wrong-name'; assigned: string } & Retrash)
	| { code: 'error'; message: string };

/** Per-project visibility of one row's field (VIS-4, VIS-5, VIS-7, RUN-22). */
export interface RowVisibility {
	/** `new`: the run created or revived the field. `existing`: it was there. What a retry passes again. */
	origin: FieldOrigin;
	/** `applying`: in flight. `applied`: ran to its last step. `cancelled`: a cancel cut it short, or kept it from starting. */
	status: 'applying' | 'applied' | 'cancelled';
	/** Projects finished, of `total` (RUN-22). */
	done: number;
	total: number;
	/** Steps that changed the site. */
	written: number;
	/** The projects where it failed (VIS-7). */
	failures: VisibilityFailure[];
	/** Set when the visibility step itself broke. */
	error: string | null;
}

export interface RunRow {
	entryId: string;
	entityType: string;
	programmaticName: string;
	displayName: string;
	dataType: string;
	/** The class of the last re-plan. */
	class: PlanClass;
	state: RowState;
	/** Why it was skipped or failed. Null while pending or in progress, and on a done row. */
	note: RowNote | null;
	/** Every schema change the run made for this row, oldest first, across retries (RUN-20). */
	effects: FieldEffect[];
	/** Null when no visibility was applied. */
	visibility: RowVisibility | null;
}

export interface RunState {
	status: RunStatus;
	/** What a running run is doing. Null when it is not running. */
	phase: 'planning' | 'applying' | 'visibility' | null;
	/** A cancel was asked for and the step in flight is finishing (RUN-18). */
	cancelRequested: boolean;
	/** One row per planned item, in plan order (RUN-6). Empty until the first re-plan answers. */
	rows: RunRow[];
	/** The run-level error (RUN-17), or null. */
	error: string | null;
}

export const INITIAL_RUN_STATE: RunState = { status: 'idle', phase: null, cancelRequested: false, rows: [], error: null };

/**
 * Everything that changes a run.
 *
 * | event                 | effect                                                                    |
 * |-----------------------|---------------------------------------------------------------------------|
 * | `started`             | a new run: running, planning, no rows                                     |
 * | `rerun`               | retry or resume: those rows back to pending, running, planning (RUN-19)   |
 * | `planned`             | the re-plan answered: rows added, or their class updated; applying        |
 * | `item-started`        | the row is in progress                                                    |
 * | `field-changed`       | one schema change, kept on the row for the report (RUN-20)                |
 * | `visibility-started`  | the row shows visibility progress                                         |
 * | `visibility-progress` | "done of total" projects (RUN-22)                                         |
 * | `visibility-finished` | the row keeps the outcome and its failures (VIS-7)                        |
 * | `visibility-skipped`  | a cancel came before the row's visibility began                           |
 * | `item-finished`       | the row is done, skipped or failed, with its note                         |
 * | `visibility-retry`    | one row's visibility is applied again; the run is running meanwhile       |
 * | `cancel-requested`    | noted, so the screen can say so                                           |
 * | `finished`            | the run ended: finished or cancelled, with the run-level error if any     |
 * | `reset`               | back to idle with no rows (the screen's refresh)                          |
 */
export type RunEvent =
	| { type: 'started' }
	| { type: 'rerun'; entryIds: readonly string[] }
	| { type: 'planned'; items: readonly PlanItem[] }
	| { type: 'item-started'; entryId: string }
	| { type: 'field-changed'; entryId: string; effect: FieldEffect }
	| { type: 'visibility-started'; entryId: string; origin: FieldOrigin }
	| { type: 'visibility-progress'; entryId: string; done: number; total: number }
	| { type: 'visibility-finished'; entryId: string; outcome: VisibilityOutcome | null; error: string | null }
	| { type: 'visibility-skipped'; entryId: string; origin: FieldOrigin }
	| { type: 'item-finished'; entryId: string; state: 'done' | 'skipped' | 'failed'; note: RowNote | null }
	| { type: 'visibility-retry'; entryId: string }
	| { type: 'cancel-requested' }
	| { type: 'finished'; status: 'finished' | 'cancelled'; error: string | null }
	| { type: 'reset' };

function rowFor(item: PlanItem, previous: RunRow | undefined): RunRow {
	return {
		entryId: item.entryId,
		entityType: item.entityType,
		programmaticName: item.programmaticName,
		displayName: item.displayName,
		dataType: item.dataType,
		class: item.class,
		state: 'pending',
		note: null,
		effects: previous?.effects ?? [],
		visibility: null
	};
}

function withRow(state: RunState, entryId: string, change: (row: RunRow) => RunRow): RunState {
	if (!state.rows.some((row) => row.entryId === entryId)) return state;
	return { ...state, rows: state.rows.map((row) => (row.entryId === entryId ? change(row) : row)) };
}

function visibilityOf(origin: FieldOrigin): RowVisibility {
	return { origin, status: 'applying', done: 0, total: 0, written: 0, failures: [], error: null };
}

/**
 * The next state. Pure: neither argument is altered. An event that does not fit the state (a row
 * that is not there, a start while running) changes nothing.
 */
export function reduceRun(state: RunState, event: RunEvent): RunState {
	const running = state.status === 'running';
	switch (event.type) {
		case 'started':
			if (state.status !== 'idle') return state;
			return { status: 'running', phase: 'planning', cancelRequested: false, rows: [], error: null };

		case 'rerun': {
			if (running) return state;
			const ids = new Set(event.entryIds);
			return {
				status: 'running',
				phase: 'planning',
				cancelRequested: false,
				error: null,
				rows: state.rows.map((row) => (ids.has(row.entryId) ? { ...row, state: 'pending', note: null, visibility: null } : row))
			};
		}

		case 'planned': {
			if (!running) return state;
			const planned = new Map(event.items.map((item) => [item.entryId, item]));
			const known = new Set(state.rows.map((row) => row.entryId));
			const rows = state.rows.map((row) => {
				const item = planned.get(row.entryId);
				// Only a row waiting to run takes the new class: a completed row keeps its result (RUN-19).
				return item && row.state === 'pending' ? rowFor(item, row) : row;
			});
			for (const item of event.items) if (!known.has(item.entryId)) rows.push(rowFor(item, undefined));
			return { ...state, phase: 'applying', rows };
		}

		case 'item-started':
			if (!running) return state;
			return withRow(state, event.entryId, (row) => (row.state === 'pending' ? { ...row, state: 'in_progress' } : row));

		case 'field-changed':
			return withRow(state, event.entryId, (row) => ({ ...row, effects: [...row.effects, event.effect] }));

		case 'visibility-started':
			return withRow(state, event.entryId, (row) => ({ ...row, visibility: visibilityOf(event.origin) }));

		case 'visibility-progress':
			return withRow(state, event.entryId, (row) =>
				row.visibility ? { ...row, visibility: { ...row.visibility, done: event.done, total: event.total } } : row
			);

		case 'visibility-finished':
			return withRow(state, event.entryId, (row) => {
				if (!row.visibility) return row;
				const outcome = event.outcome;
				if (!outcome) return { ...row, visibility: { ...row.visibility, status: 'applied', error: event.error ?? 'Unknown error.' } };
				return {
					...row,
					visibility: {
						origin: row.visibility.origin,
						status: outcome.cancelled ? 'cancelled' : 'applied',
						done: outcome.done,
						total: outcome.total,
						written: outcome.written,
						failures: [...outcome.failures],
						error: event.error
					}
				};
			});

		case 'visibility-skipped':
			return withRow(state, event.entryId, (row) => ({ ...row, visibility: { ...visibilityOf(event.origin), status: 'cancelled' } }));

		case 'item-finished':
			return withRow(state, event.entryId, (row) =>
				row.state === 'in_progress' ? { ...row, state: event.state, note: event.note } : row
			);

		case 'visibility-retry': {
			if (running) return state;
			const row = state.rows.find((candidate) => candidate.entryId === event.entryId);
			if (!row?.visibility) return state;
			return { ...state, status: 'running', phase: 'visibility', cancelRequested: false, error: null };
		}

		case 'cancel-requested':
			return running && !state.cancelRequested ? { ...state, cancelRequested: true } : state;

		case 'finished':
			if (!running) return state;
			return { ...state, status: event.status, phase: null, cancelRequested: false, error: event.error };

		case 'reset':
			return running ? state : INITIAL_RUN_STATE;
	}
}

/* What the screen reads off the state. */

export interface RunCounters {
	/** Rows done, skipped or failed (RUN-23). */
	finished: number;
	total: number;
	done: number;
	skipped: number;
	failed: number;
	pending: number;
	/** Done or skipped rows whose visibility needs another go (VIS-7). */
	visibilityWarnings: number;
}

/** Whether a row's visibility is worth applying again: a project failed, it broke, or a cancel cut it. */
export function needsVisibilityRetry(row: RunRow): boolean {
	const visibility = row.visibility;
	if (!visibility || visibility.status === 'applying') return false;
	return visibility.failures.length > 0 || visibility.error !== null || visibility.status === 'cancelled';
}

export function runCounters(state: RunState): RunCounters {
	const count = (rowState: RowState) => state.rows.filter((row) => row.state === rowState).length;
	const done = count('done');
	const skipped = count('skipped');
	const failed = count('failed');
	return {
		finished: done + skipped + failed,
		total: state.rows.length,
		done,
		skipped,
		failed,
		pending: count('pending'),
		visibilityWarnings: state.rows.filter(needsVisibilityRetry).length
	};
}

/** The entry ids a retry runs again: the failed rows, in order (RUN-19). */
export function retryIds(state: RunState): string[] {
	return state.rows.filter((row) => row.state === 'failed').map((row) => row.entryId);
}

/** The entry ids a resume runs: the rows a cancel or a run-level error left pending (RUN-20). */
export function resumeIds(state: RunState): string[] {
	return state.rows.filter((row) => row.state === 'pending').map((row) => row.entryId);
}
