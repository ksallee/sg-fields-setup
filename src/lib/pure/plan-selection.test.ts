import { describe, expect, it } from 'vitest';
import { ALL_TICKED, isTicked, selectAllState, setAllTicked, tickedIds, toggleTick, type TickRow } from './plan-selection';

const ROWS: TickRow[] = [
	{ entryId: 'conflict', selectable: false, disabled: false },
	{ entryId: 'create', selectable: true, disabled: false },
	{ entryId: 'update', selectable: true, disabled: false },
	{ entryId: 'matches', selectable: true, disabled: false },
	{ entryId: 'nothing', selectable: true, disabled: true }
];

describe('row selection of the plan (RUN-4)', () => {
	it('ticks every row with a checkbox by default', () => {
		expect(ROWS.map((row) => isTicked(ALL_TICKED, row))).toEqual([false, true, true, true, false]);
		expect(tickedIds(ALL_TICKED, ROWS)).toEqual(['create', 'update', 'matches']);
	});

	it('never ticks a conflict or blocked row, whatever is asked', () => {
		const selection = toggleTick(toggleTick(ALL_TICKED, 'conflict'), 'conflict');
		expect(isTicked(selection, ROWS[0]!)).toBe(false);
	});

	it('unticks and disables an already-matches row with nothing left to do', () => {
		expect(isTicked(ALL_TICKED, ROWS[4]!)).toBe(false);
	});

	it('ticks that row again when it has something to do again, unless the person unticked it', () => {
		const back = { ...ROWS[4]!, disabled: false };
		expect(isTicked(ALL_TICKED, back)).toBe(true);
		expect(isTicked(toggleTick(ALL_TICKED, 'nothing'), back)).toBe(false);
	});

	it('toggles one row and leaves the selection it was given alone', () => {
		const once = toggleTick(ALL_TICKED, 'update');
		expect(tickedIds(once, ROWS)).toEqual(['create', 'matches']);
		expect(tickedIds(toggleTick(once, 'update'), ROWS)).toEqual(['create', 'update', 'matches']);
		expect(tickedIds(ALL_TICKED, ROWS)).toEqual(['create', 'update', 'matches']);
	});

	it('keeps the plan order, whatever the order of the clicks', () => {
		const selection = toggleTick(toggleTick(setAllTicked(ALL_TICKED, ROWS, false), 'matches'), 'create');
		expect(tickedIds(selection, ROWS)).toEqual(['create', 'matches']);
	});
});

describe('select all (RUN-4)', () => {
	it('reads "N of M selected" over the rows that can be ticked', () => {
		expect(selectAllState(ALL_TICKED, ROWS)).toEqual({ selected: 3, total: 3, state: 'all', text: '3 of 3 selected' });
	});

	it('is mixed when some are ticked and none when none is', () => {
		const some = toggleTick(ALL_TICKED, 'create');
		expect(selectAllState(some, ROWS)).toMatchObject({ selected: 2, total: 3, state: 'some', text: '2 of 3 selected' });
		const none = setAllTicked(ALL_TICKED, ROWS, false);
		expect(selectAllState(none, ROWS)).toMatchObject({ selected: 0, total: 3, state: 'none', text: '0 of 3 selected' });
	});

	it('ticks all and unticks all, the rows without a usable checkbox left out', () => {
		const none = setAllTicked(ALL_TICKED, ROWS, false);
		expect(tickedIds(none, ROWS)).toEqual([]);
		expect(tickedIds(setAllTicked(none, ROWS, true), ROWS)).toEqual(['create', 'update', 'matches']);
	});

	it('has nothing to select in a plan of conflicts alone', () => {
		expect(selectAllState(ALL_TICKED, [ROWS[0]!])).toEqual({ selected: 0, total: 0, state: 'none', text: '0 of 0 selected' });
	});
});
