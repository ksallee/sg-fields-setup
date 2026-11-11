import { describe, expect, it } from 'vitest';
import {
	EMPTY_SELECTION,
	clickRow,
	deselect,
	groupCheckState,
	pruneSelection,
	selectAll,
	selectedInOrder,
	selectionSummary,
	shiftClickRow,
	toggleGroup,
	toggleRow,
	type Selection
} from './selection';

function sel(keys: string[], anchor: string | null = null): Selection {
	return { selected: new Set(keys), anchor };
}

function keys(selection: Selection): string[] {
	return [...selection.selected].sort();
}

const VISIBLE = ['a', 'b', 'c', 'd', 'e'];

describe('toggleRow', () => {
	it('EDT-39: a plain click selects an unselected row and makes it the anchor', () => {
		const next = toggleRow(EMPTY_SELECTION, 'b');
		expect(keys(next)).toEqual(['b']);
		expect(next.anchor).toBe('b');
	});

	it('EDT-39: a plain click clears a selected row and still makes it the anchor', () => {
		const next = toggleRow(sel(['a', 'b'], 'a'), 'b');
		expect(keys(next)).toEqual(['a']);
		expect(next.anchor).toBe('b');
	});

	it('does not mutate the selection it was given', () => {
		const before = sel(['a'], 'a');
		toggleRow(before, 'b');
		expect(keys(before)).toEqual(['a']);
		expect(before.anchor).toBe('a');
	});
});

describe('shiftClickRow', () => {
	it('EDT-39: selects every visible row from the anchor down to the clicked row, inclusive', () => {
		const next = shiftClickRow(sel(['b'], 'b'), 'd', VISIBLE);
		expect(keys(next)).toEqual(['b', 'c', 'd']);
	});

	it('EDT-39: works upwards too, whichever end comes first on screen', () => {
		const next = shiftClickRow(sel(['d'], 'd'), 'b', VISIBLE);
		expect(keys(next)).toEqual(['b', 'c', 'd']);
	});

	it('EDT-39: the range only adds; selected rows outside or inside it stay selected', () => {
		const next = shiftClickRow(sel(['a', 'e'], 'b'), 'c', VISIBLE);
		expect(keys(next)).toEqual(['a', 'b', 'c', 'e']);
	});

	it('EDT-39: the range adds even when the anchor row was cleared', () => {
		const next = shiftClickRow(sel([], 'b'), 'c', VISIBLE);
		expect(keys(next)).toEqual(['b', 'c']);
	});

	it('EDT-39: the anchor stays put, so a second shift-click ranges from the same row', () => {
		const once = shiftClickRow(sel(['b'], 'b'), 'c', VISIBLE);
		expect(once.anchor).toBe('b');
		const twice = shiftClickRow(once, 'e', VISIBLE);
		expect(keys(twice)).toEqual(['b', 'c', 'd', 'e']);
	});

	it('EDT-39: rows hidden by search between the ends are not touched', () => {
		const next = shiftClickRow(sel(['a'], 'a'), 'e', ['a', 'c', 'e']);
		expect(keys(next)).toEqual(['a', 'c', 'e']);
	});

	it('EDT-39: no anchor, a shift-click is a plain click', () => {
		const next = shiftClickRow(EMPTY_SELECTION, 'c', VISIBLE);
		expect(keys(next)).toEqual(['c']);
		expect(next.anchor).toBe('c');
	});

	it('EDT-39: an anchor that is not visible makes it a plain click', () => {
		const next = shiftClickRow(sel(['x'], 'x'), 'c', VISIBLE);
		expect(keys(next)).toEqual(['c', 'x']);
		expect(next.anchor).toBe('c');
	});

	it('EDT-39: a clicked row that is not visible makes it a plain click', () => {
		const next = shiftClickRow(sel(['a'], 'a'), 'x', VISIBLE);
		expect(keys(next)).toEqual(['a', 'x']);
		expect(next.anchor).toBe('x');
	});

	it('EDT-39: shift-clicking the anchor itself selects just that row', () => {
		const next = shiftClickRow(sel([], 'c'), 'c', VISIBLE);
		expect(keys(next)).toEqual(['c']);
	});
});

describe('clickRow', () => {
	it('EDT-39: routes to a plain click or a shift-click', () => {
		const start = sel(['b'], 'b');
		expect(clickRow(start, 'd', false, VISIBLE)).toEqual(toggleRow(start, 'd'));
		expect(clickRow(start, 'd', true, VISIBLE)).toEqual(shiftClickRow(start, 'd', VISIBLE));
	});
});

describe('group checkbox', () => {
	const group = ['b', 'c'];

	it('EDT-40: none, some or all of the group\'s visible rows', () => {
		expect(groupCheckState(sel(['a']), group)).toBe('none');
		expect(groupCheckState(sel(['b']), group)).toBe('some');
		expect(groupCheckState(sel(['b', 'c', 'a']), group)).toBe('all');
	});

	it('EDT-40: a group with no visible rows reads none', () => {
		expect(groupCheckState(sel(['a']), [])).toBe('none');
	});

	it('EDT-40: when not all are selected, the click selects them all', () => {
		expect(keys(toggleGroup(sel(['a']), group))).toEqual(['a', 'b', 'c']);
		expect(keys(toggleGroup(sel(['b']), group))).toEqual(['b', 'c']);
	});

	it('EDT-40: when all are selected, the click clears them and keeps the rest', () => {
		expect(keys(toggleGroup(sel(['a', 'b', 'c']), group))).toEqual(['a']);
	});

	it('EDT-40: the anchor is left as it was', () => {
		expect(toggleGroup(sel(['a'], 'a'), group).anchor).toBe('a');
		expect(toggleGroup(sel(['b', 'c'], 'b'), group).anchor).toBe('b');
	});

	it('EDT-40: an empty group changes nothing', () => {
		const start = sel(['a'], 'a');
		expect(toggleGroup(start, [])).toEqual(start);
	});
});

describe('clear, prune and select all', () => {
	it('EDT-41: clear empties the selection and the anchor', () => {
		expect(EMPTY_SELECTION).toEqual({ selected: new Set(), anchor: null });
	});

	it('EDT-33: pruning drops keys that no longer exist and keeps the rest', () => {
		const next = pruneSelection(sel(['a', 'b', 'x'], 'b'), ['a', 'b', 'c']);
		expect(keys(next)).toEqual(['a', 'b']);
		expect(next.anchor).toBe('b');
	});

	it('EDT-33: a pruned anchor becomes none', () => {
		expect(pruneSelection(sel(['a'], 'x'), ['a']).anchor).toBe(null);
	});

	it('deselect removes the given keys only', () => {
		const next = deselect(sel(['a', 'b', 'c'], 'a'), ['a', 'c']);
		expect(keys(next)).toEqual(['b']);
		expect(next.anchor).toBe('a');
	});

	it('selectAll adds every given row, keeping what was selected', () => {
		expect(keys(selectAll(sel(['x'], 'x'), VISIBLE))).toEqual(['a', 'b', 'c', 'd', 'e', 'x']);
	});
});

describe('selection across search and filter', () => {
	it('EDT-41: the summary splits selected rows into visible and hidden', () => {
		expect(selectionSummary(sel(['a', 'c', 'x', 'y']), VISIBLE)).toEqual({ selected: 4, visible: 2, hidden: 2 });
		expect(selectionSummary(EMPTY_SELECTION, VISIBLE)).toEqual({ selected: 0, visible: 0, hidden: 0 });
	});

	it('EDT-41: bulk actions take the visible selected rows, in on-screen order', () => {
		expect(selectedInOrder(sel(['d', 'x', 'a']), VISIBLE)).toEqual(['a', 'd']);
	});
});
