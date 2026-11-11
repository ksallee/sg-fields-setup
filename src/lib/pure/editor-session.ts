/**
 * What the editor screen keeps beside the working copy and has to carry across a save: which rows
 * are expanded and selected (EDT-46), and which entity types' fields the comparison needs
 * (CMP-2). Data in, data out.
 */
import type { Entry } from './model';
import type { Selection } from './selection';
import type { WorkingCopy } from './working-copy';

/**
 * Each row's key after a successful save (EDT-46). `afterSave` keys every row by its entry id:
 * a stored row keeps that id, an added row takes the id of the entry the store made for it.
 * `added` is the save result's `added`, in the order of `addedKeys`. A row with no entry is left
 * out.
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
