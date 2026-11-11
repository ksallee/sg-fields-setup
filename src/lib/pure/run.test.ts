import { describe, expect, it } from 'vitest';
import type { PlanItem } from './plan';
import { INITIAL_RUN_STATE, madeByRun, needsVisibilityRetry, reduceRun, resumeIds, retryIds, runCounters, type RunEvent, type RunState } from './run';

function item(entryId: string, planClass: PlanItem['class'] = 'create'): PlanItem {
	return {
		entryId,
		entityType: 'Version',
		programmaticName: `sg_${entryId}`,
		displayName: entryId.toUpperCase(),
		dataType: 'text',
		class: planClass,
		refusal: null,
		liveDataType: null,
		differences: [],
		blocked: [],
		reasons: [],
		create: null,
		update: null,
		reverseFieldTypes: []
	};
}

function after(...events: RunEvent[]): RunState {
	return events.reduce(reduceRun, INITIAL_RUN_STATE);
}

const planned: RunEvent[] = [{ type: 'started' }, { type: 'planned', items: [item('a'), item('b', 'update')] }];

describe('reduceRun', () => {
	it('starts idle, with no rows', () => {
		expect(INITIAL_RUN_STATE).toEqual({ status: 'idle', phase: null, cancelRequested: false, rows: [], error: null });
	});

	it('RUN-6: a start is running and planning; the plan gives one pending row per item, in order', () => {
		expect(after({ type: 'started' })).toMatchObject({ status: 'running', phase: 'planning', rows: [] });
		const state = after(...planned);
		expect(state.phase).toBe('applying');
		expect(state.rows).toEqual([
			{ entryId: 'a', entityType: 'Version', programmaticName: 'sg_a', displayName: 'A', dataType: 'text', class: 'create', state: 'pending', note: null, effects: [], visibility: null },
			{ entryId: 'b', entityType: 'Version', programmaticName: 'sg_b', displayName: 'B', dataType: 'text', class: 'update', state: 'pending', note: null, effects: [], visibility: null }
		]);
	});

	it('RUN-22: a row goes pending, in progress, then done, skipped or failed with its note', () => {
		const started = after(...planned, { type: 'item-started', entryId: 'a' });
		expect(started.rows.map((row) => row.state)).toEqual(['in_progress', 'pending']);
		const finished = reduceRun(started, { type: 'item-finished', entryId: 'a', state: 'failed', note: { code: 'gone' } });
		expect(finished.rows[0]).toMatchObject({ state: 'failed', note: { code: 'gone' } });
	});

	it('RUN-20: keeps every schema change on its row', () => {
		const state = after(
			...planned,
			{ type: 'item-started', entryId: 'a' },
			{ type: 'field-changed', entryId: 'a', effect: { kind: 'revived', name: 'sg_a' } },
			{ type: 'field-changed', entryId: 'a', effect: { kind: 'updated', name: 'sg_a' } }
		);
		expect(state.rows[0].effects).toEqual([
			{ kind: 'revived', name: 'sg_a' },
			{ kind: 'updated', name: 'sg_a' }
		]);
	});

	it('RUN-22, VIS-7: visibility shows on the row as it goes, and its failures stay there', () => {
		const going = after(
			...planned,
			{ type: 'item-started', entryId: 'a' },
			{ type: 'visibility-started', entryId: 'a', origin: 'new' },
			{ type: 'visibility-progress', entryId: 'a', done: 2, total: 5 }
		);
		expect(going.rows[0].visibility).toEqual({ origin: 'new', status: 'applying', done: 2, total: 5, written: 0, failures: [], error: null });
		const failure = { projectId: 70, projectName: 'Alpha', message: 'Refused.' };
		const ended = reduceRun(going, {
			type: 'visibility-finished',
			entryId: 'a',
			outcome: { total: 5, done: 4, written: 3, failures: [failure], cancelled: false },
			error: null
		});
		expect(ended.rows[0].visibility).toEqual({ origin: 'new', status: 'applied', done: 4, total: 5, written: 3, failures: [failure], error: null });
		expect(needsVisibilityRetry(ended.rows[0])).toBe(true);
		expect(needsVisibilityRetry(going.rows[0])).toBe(false);
	});

	it('RUN-18: notes a cancel while running, and ends as cancelled or finished', () => {
		const asked = after(...planned, { type: 'cancel-requested' });
		expect(asked.cancelRequested).toBe(true);
		expect(reduceRun(asked, { type: 'cancel-requested' })).toBe(asked);
		expect(reduceRun(asked, { type: 'finished', status: 'cancelled', error: null })).toMatchObject({ status: 'cancelled', phase: null, cancelRequested: false });
		expect(reduceRun(INITIAL_RUN_STATE, { type: 'cancel-requested' })).toBe(INITIAL_RUN_STATE);
	});

	it('RUN-17: a run-level error ends the run as finished, with the error', () => {
		expect(after({ type: 'started' }, { type: 'finished', status: 'finished', error: 'No connection.' })).toMatchObject({
			status: 'finished',
			error: 'No connection.',
			rows: []
		});
	});

	it('RUN-19: a rerun returns only its rows to pending, and the re-plan gives them their new class', () => {
		const failed = after(
			...planned,
			{ type: 'item-started', entryId: 'a' },
			{ type: 'item-finished', entryId: 'a', state: 'done', note: null },
			{ type: 'item-started', entryId: 'b' },
			{ type: 'field-changed', entryId: 'b', effect: { kind: 'updated', name: 'sg_b' } },
			{ type: 'item-finished', entryId: 'b', state: 'failed', note: { code: 'gone' } },
			{ type: 'finished', status: 'finished', error: 'Old error.' }
		);
		expect(retryIds(failed)).toEqual(['b']);
		const again = reduceRun(failed, { type: 'rerun', entryIds: ['b'] });
		expect(again).toMatchObject({ status: 'running', phase: 'planning', error: null });
		expect(again.rows.map((row) => [row.state, row.note])).toEqual([
			['done', null],
			['pending', null]
		]);
		// A plan that also names the done row leaves that row as it is.
		const replanned = reduceRun(again, { type: 'planned', items: [item('a', 'already-matches'), item('b', 'create')] });
		expect(replanned.rows.map((row) => [row.class, row.state])).toEqual([
			['create', 'done'],
			['create', 'pending']
		]);
		expect(replanned.rows[1].effects).toEqual([{ kind: 'updated', name: 'sg_b' }]);
	});

	it('RUN-20: the rows a cancel left pending are the ones a resume runs', () => {
		const cancelled = after(
			...planned,
			{ type: 'item-started', entryId: 'a' },
			{ type: 'item-finished', entryId: 'a', state: 'skipped', note: { code: 'nothing-to-change' } },
			{ type: 'finished', status: 'cancelled', error: null }
		);
		expect(resumeIds(cancelled)).toEqual(['b']);
		expect(retryIds(cancelled)).toEqual([]);
	});

	it('RUN-23: counts finished rows out of the total', () => {
		const state = after(
			...planned,
			{ type: 'item-started', entryId: 'a' },
			{ type: 'item-finished', entryId: 'a', state: 'skipped', note: { code: 'nothing-to-change' } },
			{ type: 'item-started', entryId: 'b' }
		);
		expect(runCounters(state)).toEqual({ finished: 1, total: 2, done: 0, skipped: 1, failed: 0, pending: 0, visibilityWarnings: 0 });
	});

	it('ignores an event that does not fit: an unknown row, a start or a reset while running, a row finished twice', () => {
		const running = after(...planned, { type: 'item-started', entryId: 'a' });
		expect(reduceRun(running, { type: 'item-started', entryId: 'zzz' })).toBe(running);
		expect(reduceRun(running, { type: 'started' })).toBe(running);
		expect(reduceRun(running, { type: 'reset' })).toBe(running);
		expect(reduceRun(running, { type: 'rerun', entryIds: ['a'] })).toBe(running);
		const done = reduceRun(running, { type: 'item-finished', entryId: 'a', state: 'done', note: null });
		expect(reduceRun(done, { type: 'item-finished', entryId: 'a', state: 'failed', note: { code: 'gone' } }).rows[0].state).toBe('done');
		expect(reduceRun(INITIAL_RUN_STATE, { type: 'finished', status: 'finished', error: null })).toBe(INITIAL_RUN_STATE);
	});

	it('RUN-25: a reset forgets a finished run', () => {
		const ended = after(...planned, { type: 'finished', status: 'finished', error: null });
		expect(reduceRun(ended, { type: 'reset' })).toBe(INITIAL_RUN_STATE);
	});

	it('never alters the state it is given', () => {
		const before = after(...planned);
		const frozen = structuredClone(before);
		reduceRun(before, { type: 'item-started', entryId: 'a' });
		reduceRun(before, { type: 'field-changed', entryId: 'a', effect: { kind: 'created', name: 'sg_a' } });
		expect(before).toEqual(frozen);
	});
});

describe('madeByRun (VIS-4, VIS-6)', () => {
	it.each([
		['nothing', [], false],
		['a create', [{ kind: 'created', name: 'sg_a' }], true],
		['a revive', [{ kind: 'revived', name: 'sg_a' }], true],
		['a revive then an update', [{ kind: 'revived', name: 'sg_a' }, { kind: 'updated', name: 'sg_a' }], true],
		['an update alone', [{ kind: 'updated', name: 'sg_a' }], false],
		['a revive then a re-trash', [{ kind: 'revived', name: 'sg_a' }, { kind: 'retired', name: 'sg_a' }], false],
		['a create under another name', [{ kind: 'created', name: 'sg_a_1' }, { kind: 'retired', name: 'sg_a_1' }], false],
		['a re-trash then a create', [{ kind: 'revived', name: 'sg_a' }, { kind: 'retired', name: 'sg_a' }, { kind: 'created', name: 'sg_a' }], true]
	] as const)('after %s', (_, effects, expected) => {
		expect(madeByRun(effects, 'sg_a')).toBe(expected);
	});
});
