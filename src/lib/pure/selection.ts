/**
 * Row selection in the editor (EDT-39 to EDT-41). Every function returns a new selection and
 * leaves the one it was given alone. Visible keys come from the editor view, in on-screen order.
 *
 * Decisions where the spec leaves room:
 * - A shift-range only adds rows. It never clears one, and it leaves the anchor where it was, so
 *   the next shift-click ranges from the same row (EDT-39).
 * - The group checkbox leaves the anchor as it was (EDT-40).
 * - The selection survives search and filter changes. Rows a person cannot see are never acted
 *   on: bulk actions take `selectedInOrder`, the selected rows that are visible. Hidden selected
 *   rows stay selected and come back when the search clears. `selectionSummary` gives both
 *   numbers so the bar can read "N selected, M hidden" (EDT-41).
 */

export interface Selection {
	selected: ReadonlySet<string>;
	/** The row the last plain click landed on, selected or not, or null. */
	anchor: string | null;
}

/** Nothing selected, no anchor. */
export const EMPTY_SELECTION: Selection = Object.freeze({ selected: new Set<string>(), anchor: null });

/** A plain click on a row's checkbox (EDT-39): toggles it and makes it the anchor. */
export function toggleRow(selection: Selection, key: string): Selection {
	const selected = new Set(selection.selected);
	if (selected.has(key)) selected.delete(key);
	else selected.add(key);
	return { selected, anchor: key };
}

/**
 * A shift-click on a row's checkbox (EDT-39): adds every visible row between the anchor and the
 * clicked row, both included, whichever comes first on screen. No anchor, or either end not
 * visible, and it is a plain click.
 */
export function shiftClickRow(selection: Selection, key: string, visibleKeys: readonly string[]): Selection {
	const from = selection.anchor === null ? -1 : visibleKeys.indexOf(selection.anchor);
	const to = visibleKeys.indexOf(key);
	if (from < 0 || to < 0) return toggleRow(selection, key);
	const selected = new Set(selection.selected);
	for (let i = Math.min(from, to); i <= Math.max(from, to); i++) selected.add(visibleKeys[i]);
	return { selected, anchor: selection.anchor };
}

/** A click on a row's checkbox, plain or with shift held (EDT-39). */
export function clickRow(selection: Selection, key: string, shift: boolean, visibleKeys: readonly string[]): Selection {
	return shift ? shiftClickRow(selection, key, visibleKeys) : toggleRow(selection, key);
}

/** A group checkbox's state over the group's visible rows (EDT-40). No visible rows reads `none`. */
export type GroupCheckState = 'none' | 'some' | 'all';

export function groupCheckState(selection: Selection, groupKeys: readonly string[]): GroupCheckState {
	let count = 0;
	for (const key of groupKeys) if (selection.selected.has(key)) count += 1;
	if (count === 0) return 'none';
	return count === groupKeys.length ? 'all' : 'some';
}

/**
 * A click on a group checkbox (EDT-40): selects all the group's visible rows unless all are
 * selected already, in which case it clears them. Rows elsewhere and the anchor stay.
 */
export function toggleGroup(selection: Selection, groupKeys: readonly string[]): Selection {
	if (groupKeys.length === 0) return selection;
	return groupCheckState(selection, groupKeys) === 'all' ? deselect(selection, groupKeys) : selectAll(selection, groupKeys);
}

/** Adds the given rows, keeping what was selected and the anchor. With the visible keys: select all shown. */
export function selectAll(selection: Selection, keys: readonly string[]): Selection {
	const selected = new Set(selection.selected);
	for (const key of keys) selected.add(key);
	return { selected, anchor: selection.anchor };
}

/** Removes the given rows from the selection, keeping the rest and the anchor. */
export function deselect(selection: Selection, keys: readonly string[]): Selection {
	const selected = new Set(selection.selected);
	for (const key of keys) selected.delete(key);
	return { selected, anchor: selection.anchor };
}

/** Clears the selection and the anchor (EDT-41). */
export function clearSelection(): Selection {
	return EMPTY_SELECTION;
}

/**
 * Drops the keys that no longer exist, after a delete or a reload (EDT-33). The rest stays
 * selected; an anchor that is gone becomes null.
 */
export function pruneSelection(selection: Selection, existingKeys: Iterable<string>): Selection {
	const existing = new Set(existingKeys);
	const selected = new Set([...selection.selected].filter((key) => existing.has(key)));
	const anchor = selection.anchor !== null && existing.has(selection.anchor) ? selection.anchor : null;
	return { selected, anchor };
}

/** How many rows are selected, and how many of those are visible or hidden by search and filter (EDT-41). */
export interface SelectionSummary {
	selected: number;
	visible: number;
	hidden: number;
}

export function selectionSummary(selection: Selection, visibleKeys: readonly string[]): SelectionSummary {
	const visible = selectedInOrder(selection, visibleKeys).length;
	return { selected: selection.selected.size, visible, hidden: selection.selected.size - visible };
}

/** The selected rows that are visible, in on-screen order: what bulk actions act on (EDT-41). */
export function selectedInOrder(selection: Selection, visibleKeys: readonly string[]): string[] {
	return visibleKeys.filter((key) => selection.selected.has(key));
}
