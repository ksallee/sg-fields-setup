/**
 * What the editor screen keeps beside the working copy and has to carry across a save or a
 * delete: which rows are expanded and selected (EDT-46, EDT-33), where the keyboard goes when
 * the focused row is deleted, and which entity types' fields the comparison needs (CMP-2). Data
 * in, data out. `$lib/app/editor/session.svelte.ts` holds the state these work on.
 */
import type { Entry } from './model';
import type { Selection } from './selection';
import type { WorkingCopy } from './working-copy';

/**
 * Each row's key after a successful save (EDT-46). `openWorkingCopy` keys every row by its entry id:
 * a stored row keeps that id, an added row takes the id of the entry the store made for it.
 * `added` is the save result's `added`: the store answers one entry per draft of
 * `saveRequest(before).added`, in that order, and `saveRequest` emits those in row order. The
 * test of this function holds the two to that. A row with no entry is left out.
 */
export function keysAfterSave(before: WorkingCopy, added: readonly Pick<Entry, 'id'>[]): Map<string, string> {
	const map = new Map<string, string>();
	let next = 0;
	for (const row of before.rows) {
		if (row.entryId !== null) {
			map.set(row.key, row.entryId);
			continue;
		}
		const entry = added[next];
		next += 1;
		if (entry) map.set(row.key, entry.id);
	}
	return map;
}

/** A set of row keys carried over a re-keying. Keys with no row any more are dropped. */
export function remapKeys(keys: ReadonlySet<string>, map: ReadonlyMap<string, string>): Set<string> {
	const next = new Set<string>();
	for (const key of keys) {
		const mapped = map.get(key);
		if (mapped !== undefined) next.add(mapped);
	}
	return next;
}

/** The selection and its anchor carried over a re-keying (EDT-39, EDT-46). */
export function remapSelection(selection: Selection, map: ReadonlyMap<string, string>): Selection {
	return {
		selected: remapKeys(selection.selected, map),
		anchor: selection.anchor === null ? null : (map.get(selection.anchor) ?? null)
	};
}

/**
 * The distinct target entity types among the rows, trimmed, blanks left out, in first-seen
 * order: the types whose fields the comparison reads, once each (CMP-2, CMP-4).
 */
export function targetTypes(rows: readonly { targetEntityType: string }[]): string[] {
	const types = new Set<string>();
	for (const row of rows) {
		const type = row.targetEntityType.trim();
		if (type !== '') types.add(type);
	}
	return [...types];
}

/** A set of row keys without those whose row is gone (EDT-33, EDT-43). Order kept. */
export function pruneKeys(keys: ReadonlySet<string>, existing: Iterable<string>): Set<string> {
	const still = new Set(existing);
	return new Set([...keys].filter((key) => still.has(key)));
}

/** What the list shows, as far as focus needs it: the groups in order, each with its rows' keys. */
export type FocusGroup = { type: string; keys: readonly string[] };

/** Where the keyboard goes next: a row's toggle, a group's "Add field", or "Add entity type". */
export type FocusTarget = { kind: 'row'; key: string } | { kind: 'add-field'; type: string } | { kind: 'add-entity-type' };

/**
 * Where focus goes when rows are deleted (EDT-33, EDT-43): the deleted row's button goes with it,
 * and focus must not fall back to the top of the page. Read from the list before and after:
 *
 * 1. the next row of the same group that is still there, else the previous one;
 * 2. else that group's "Add field", when the group still shows;
 * 3. else the next row on screen, else the previous one;
 * 4. else "Add entity type".
 *
 * A bulk delete goes by its first removed row on screen. Null when no removed row was on screen:
 * focus was not on one.
 */
export function focusAfterRemoval(before: readonly FocusGroup[], after: readonly FocusGroup[], removed: Iterable<string>): FocusTarget | null {
	const gone = new Set(removed);
	const left = new Set(after.flatMap((group) => group.keys));
	const home = before.find((group) => group.keys.some((key) => gone.has(key)));
	if (!home) return null;
	const neighbour = (keys: readonly string[], at: number): string | undefined =>
		keys.slice(at + 1).find((key) => left.has(key)) ?? keys.slice(0, at).findLast((key) => left.has(key));

	const inGroup = neighbour(
		home.keys,
		home.keys.findIndex((key) => gone.has(key))
	);
	if (inGroup !== undefined) return { kind: 'row', key: inGroup };
	if (after.some((group) => group.type === home.type)) return { kind: 'add-field', type: home.type };
	const all = before.flatMap((group) => group.keys);
	const onScreen = neighbour(
		all,
		all.findIndex((key) => gone.has(key))
	);
	return onScreen !== undefined ? { kind: 'row', key: onScreen } : { kind: 'add-entity-type' };
}
