/**
 * Which rows of the install plan are ticked (RUN-4). Pure: every function returns a new
 * selection and leaves the one it was given alone.
 *
 * Rows are ticked by default, so the selection holds what the person unticked, not what is
 * ticked. That is what lets an already-matches row come and go: it is unticked and disabled while
 * it has nothing left to do (VIS-9), and ticked again when a change of the picker gives it
 * something to do, unless the person unticked it themselves.
 */

export interface PlanSelection {
	/** The entry ids the person unticked. */
	unticked: ReadonlySet<string>;
}

/** Every row with a checkbox ticked: the state a plan opens in. */
export const ALL_TICKED: PlanSelection = Object.freeze({ unticked: new Set<string>() });

/** A row as the selection needs it. */
export interface TickRow {
	entryId: string;
	/** Whether the row has a checkbox: create, update and already-matches rows. */
	selectable: boolean;
	/** An already-matches row with nothing left to do: unticked and disabled. */
	disabled: boolean;
}

function usable(row: TickRow): boolean {
	return row.selectable && !row.disabled;
}

export function isTicked(selection: PlanSelection, row: TickRow): boolean {
	return usable(row) && !selection.unticked.has(row.entryId);
}

/** A click on one row's checkbox. */
export function toggleTick(selection: PlanSelection, entryId: string): PlanSelection {
	const unticked = new Set(selection.unticked);
	if (!unticked.delete(entryId)) unticked.add(entryId);
	return { unticked };
}

/** Select all, or none: every row whose checkbox can be used. */
export function setAllTicked(selection: PlanSelection, rows: readonly TickRow[], ticked: boolean): PlanSelection {
	const unticked = new Set(selection.unticked);
	for (const row of rows) {
		if (!usable(row)) continue;
		if (ticked) unticked.delete(row.entryId);
		else unticked.add(row.entryId);
	}
	return { unticked };
}

/** The ticked rows' entry ids, in plan order: what a run starts with (RUN-6). */
export function tickedIds(selection: PlanSelection, rows: readonly TickRow[]): string[] {
	return rows.filter((row) => isTicked(selection, row)).map((row) => row.entryId);
}

export interface SelectAllState {
	selected: number;
	/** The rows whose checkbox can be used. */
	total: number;
	/** `some` is the mixed state. */
	state: 'all' | 'some' | 'none';
	/** "N of M selected". */
	text: string;
}

export function selectAllState(selection: PlanSelection, rows: readonly TickRow[]): SelectAllState {
	const total = rows.filter(usable).length;
	const selected = tickedIds(selection, rows).length;
	const state = selected === 0 ? 'none' : selected === total ? 'all' : 'some';
	return { selected, total, state, text: `${selected} of ${total} selected` };
}
