/**
 * Which entries the install screen plans (PLN-1, EDT-10): the whole set, or the selection the
 * editor handed over (`$lib/io/install-selection`). Pure: the caller reads the route and the
 * storage.
 *
 * The route says which was asked for (`?selection=1`). The selection itself is kept in the tab's
 * session storage, so it can be missing: a new tab, cleared storage, a link pasted elsewhere. An
 * install then never falls back to the whole set. That would widen a few fields to all of them
 * without a word, and every create spends a field name for good. The screen says the selection
 * was lost and sends the person back to choose again.
 */

export type InstallEntries<T> =
	| { kind: 'whole'; entries: T[] }
	| { kind: 'selection'; entries: T[] }
	/** A selection was asked for and none of it is left: nothing is planned. */
	| { kind: 'selection-lost' };

/**
 * The entries to plan, in the order of the set.
 *
 * `asked`: the route asks for the selection. `selection`: the entry ids stored for this set, or
 * null when none is. Ids the set no longer holds are left out. When that leaves nothing, the
 * selection is lost as well.
 */
export function installEntries<T extends { id: string }>(entries: readonly T[], asked: boolean, selection: readonly string[] | null): InstallEntries<T> {
	if (!asked) return { kind: 'whole', entries: [...entries] };
	const wanted = new Set(selection ?? []);
	const selected = entries.filter((entry) => wanted.has(entry.id));
	return selected.length === 0 ? { kind: 'selection-lost' } : { kind: 'selection', entries: selected };
}

/** What the screen shows for a lost selection. */
export const SELECTION_LOST = {
	title: 'The selection was lost',
	line: 'Go back to the set and choose the fields again.'
} as const;
