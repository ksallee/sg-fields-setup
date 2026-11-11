/**
 * What leaves the working copy: the save request (EDT-44, EDT-45), the state after a save
 * (EDT-46, EDT-47), and the entries handed to Duplicate and Install (EDT-9, EDT-10, PLN-1).
 * Rows are cleaned on the way out (MOD-7, MOD-9).
 */
import { cleanEntry } from './clean';
import type { Entry, EntryDraft, FieldSet } from './model';
import {
	cleanedDescription,
	cleanedName,
	definitionOf,
	detailsChanged,
	openWorkingCopy,
	sameCleanedDefinition,
	savedById,
	type Row,
	type WorkingCopy
} from './working-copy';

/**
 * One save, as the store applies it, in this order (EDT-44): details, removals, changes,
 * additions. Removals come before additions so a pair deleted and added again does not trip MOD-5.
 */
export interface SaveRequest {
	/** The cleaned name and description, both, when either changed once cleaned; else null. */
	details: { name: string; description: string | null } | null;
	/** Ids of the stored entries whose rows were removed, in saved order. */
	removedIds: string[];
	/**
	 * The stored entries whose cleaned definition changed, only those (EDT-45), in row order:
	 * the saved entry (id, set, timestamps) with the row's cleaned definition and the row's
	 * snapshot over it. The snapshot is the row's because a re-sync refreshes it (EDT-42); on a
	 * row never re-synced it is the saved one.
	 */
	changed: Entry[];
	/** The added rows as cleaned drafts, in row order. `addedKeys` gives their row keys. */
	added: EntryDraft[];
}

function draftOf(row: Row): EntryDraft {
	return cleanEntry({
		...definitionOf(row),
		snapshot: row.snapshot,
		snapshotSite: row.snapshotSite,
		snapshotTime: row.snapshotTime
	});
}

/** What Save sends (EDT-44, EDT-45). A clean working copy gives an empty request. */
export function saveRequest(workingCopy: WorkingCopy): SaveRequest {
	const saved = savedById(workingCopy);
	const kept = new Set<string>();
	const changed: Entry[] = [];
	const added: EntryDraft[] = [];
	for (const row of workingCopy.rows) {
		if (row.entryId === null) {
			added.push(draftOf(row));
			continue;
		}
		kept.add(row.entryId);
		const entry = saved.get(row.entryId);
		if (entry && !sameCleanedDefinition(row, entry)) {
			changed.push({
				...entry,
				...cleanEntry(definitionOf(row)),
				snapshot: row.snapshot,
				snapshotSite: row.snapshotSite,
				snapshotTime: row.snapshotTime
			});
		}
	}
	return {
		details: detailsChanged(workingCopy)
			? { name: cleanedName(workingCopy), description: cleanedDescription(workingCopy) }
			: null,
		removedIds: workingCopy.saved.entries.filter((entry) => !kept.has(entry.id)).map((entry) => entry.id),
		changed,
		added
	};
}

/** The row keys of `saveRequest(workingCopy).added`, in the same order. */
export function addedKeys(workingCopy: WorkingCopy): string[] {
	return workingCopy.rows.filter((row) => row.entryId === null).map((row) => row.key);
}

/**
 * After a successful save and reload (EDT-46): a clean working copy on the stored state, as
 * `openWorkingCopy` builds it. Every row is stored, so every row is in manual mode (EDT-25).
 * On a failed save the caller keeps its working copy as it is (EDT-47).
 */
export function afterSave(_workingCopy: WorkingCopy, storedSet: FieldSet, storedEntries: readonly Entry[]): WorkingCopy {
	return openWorkingCopy(storedSet, storedEntries);
}

/**
 * Marks added rows as stored, given the entries the store created for them by row key (EDT-47):
 * for a save whose additions were stored but whose reload failed. Each such row keeps its key,
 * its edits and its name mode, takes the entry's id, and the entry joins the saved state, so a
 * retry sends it as a change if edited since and never adds it again. Keys that are not added
 * rows are ignored. Nothing else moves: a retry sends the details, removals and changes again,
 * which the store applies idempotently.
 */
export function adoptStored(workingCopy: WorkingCopy, stored: ReadonlyMap<string, Entry>): WorkingCopy {
	const adopted: Entry[] = [];
	const rows = workingCopy.rows.map((row) => {
		const entry = row.entryId === null ? stored.get(row.key) : undefined;
		if (!entry) return row;
		adopted.push(entry);
		return { ...row, entryId: entry.id, isNew: false };
	});
	if (adopted.length === 0) return workingCopy;
	return {
		...workingCopy,
		saved: { ...workingCopy.saved, entries: [...workingCopy.saved.entries, ...adopted] },
		rows
	};
}

function pick(workingCopy: WorkingCopy, keys: readonly string[] | undefined): readonly Row[] {
	if (keys === undefined) return workingCopy.rows;
	const wanted = new Set(keys);
	return workingCopy.rows.filter((row) => wanted.has(row.key));
}

/**
 * What Duplicate copies (EDT-9): every row, or only those with the given keys, as cleaned drafts
 * in row order. Unsaved edits are included and snapshots kept. Unknown keys are ignored.
 */
export function draftsOf(workingCopy: WorkingCopy, keys?: readonly string[]): EntryDraft[] {
	return pick(workingCopy, keys).map(draftOf);
}

/**
 * What Install considers (EDT-10, PLN-1): the stored entries of every row, or only of the rows
 * with the given keys, in row order, as stored. Install is offered only for a clean set (EDT-10,
 * PLN-2), so these match the rows; a row not stored is left out. Mirror entries are included:
 * the planner sets them aside (PLN-10). Unknown keys are ignored.
 */
export function installEntries(workingCopy: WorkingCopy, keys?: readonly string[]): Entry[] {
	const saved = savedById(workingCopy);
	const entries: Entry[] = [];
	for (const row of pick(workingCopy, keys)) {
		const entry = row.entryId === null ? undefined : saved.get(row.entryId);
		if (entry) entries.push(entry);
	}
	return entries;
}
