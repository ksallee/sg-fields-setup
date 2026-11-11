/**
 * The editor's working copy: one set's unsaved edits beside its last saved state
 * (specs/05-editor.md, EDT-1 to EDT-3, EDT-12, EDT-18, EDT-25, EDT-32, EDT-33).
 *
 * Data in, data out. Every edit returns a new working copy and never alters the one it was given;
 * an edit that is refused or names no row returns the very same object. No clock, no id
 * generation: the caller supplies the keys of new rows. What is visible, selected or expanded is
 * the view's business, not held here.
 */
import { cleanEntry } from './clean';
import { isMirror } from './data-types';
import { predictFieldName } from './field-name';
import type { Entry, EntryDefinition, EntrySnapshot, FieldSet } from './model';
import { validateSet, type SetValidity } from './validity';

/**
 * How a row's programmatic name moves (EDT-25). Derived: it follows the display name and cannot
 * be typed. Manual: it is typed and the display name leaves it alone.
 */
export type NameMode = 'derived' | 'manual';

/** One entry as the editor holds it: its definition, its snapshot, and what the editor needs. */
export interface Row extends EntryDefinition, EntrySnapshot {
	/**
	 * Stable for the life of the working copy. The stored entry's id for a row loaded from
	 * storage; the caller's client key for a row added here. It does not change when an added
	 * row is stored (`adoptStored`).
	 */
	key: string;
	/** The stored entry's id, or null while the row is not stored. */
	entryId: string | null;
	/** Not stored yet: exactly when `entryId` is null. */
	isNew: boolean;
	nameMode: NameMode;
}

/** The set as last stored: what dirtiness and the save compare against. */
export interface SavedState {
	name: string;
	description: string | null;
	entries: readonly Entry[];
}

/** One set being edited. */
export interface WorkingCopy {
	setId: string;
	saved: SavedState;
	/** The name as typed, untrimmed. */
	name: string;
	/** The description as typed; `''` for none. */
	description: string;
	/** In the order they were loaded and added. */
	rows: readonly Row[];
}

/** The nine keys of a definition, the part dirtiness and the save compare (EDT-3). */
export const DEFINITION_KEYS = [
	'targetEntityType',
	'programmaticName',
	'displayName',
	'dataType',
	'validTypes',
	'validValues',
	'defaultValue',
	'description',
	'uniquePerProject'
] as const satisfies readonly (keyof EntryDefinition)[];

/** Just the definition of an entry or a row, as a fresh object. Lists are shared, not copied. */
export function definitionOf(source: EntryDefinition): EntryDefinition {
	return {
		targetEntityType: source.targetEntityType,
		programmaticName: source.programmaticName,
		displayName: source.displayName,
		dataType: source.dataType,
		validTypes: source.validTypes,
		validValues: source.validValues,
		defaultValue: source.defaultValue,
		description: source.description,
		uniquePerProject: source.uniquePerProject
	};
}

/** Code unit order: deterministic in every locale. */
function compareText(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function storedRow(entry: Entry): Row {
	return {
		...definitionOf(entry),
		snapshot: entry.snapshot,
		snapshotSite: entry.snapshotSite,
		snapshotTime: entry.snapshotTime,
		key: entry.id,
		entryId: entry.id,
		isNew: false,
		nameMode: 'manual'
	};
}

/**
 * A clean working copy of a stored set (EDT-1). Rows come ordered by target entity type, then
 * programmatic name, in code unit order; ties keep the order given. Stored rows start in manual
 * mode so their names never change under the user (EDT-25).
 */
export function openWorkingCopy(set: FieldSet, entries: readonly Entry[]): WorkingCopy {
	const rows = entries
		.map(storedRow)
		.sort(
			(a, b) =>
				compareText(a.targetEntityType, b.targetEntityType) ||
				compareText(a.programmaticName, b.programmaticName)
		);
	return {
		setId: set.id,
		saved: { name: set.name, description: set.description, entries: [...entries] },
		name: set.name,
		description: set.description ?? '',
		rows
	};
}

/** The row with this key, if any. */
export function rowByKey(workingCopy: WorkingCopy, key: string): Row | undefined {
	return workingCopy.rows.find((row) => row.key === key);
}

/** The set name as typed (EDT-15). */
export function setName(workingCopy: WorkingCopy, name: string): WorkingCopy {
	return { ...workingCopy, name };
}

/** The set description as typed (EDT-15). */
export function setDescription(workingCopy: WorkingCopy, description: string): WorkingCopy {
	return { ...workingCopy, description };
}

/** Replaces the row with this key through `change`; the same working copy when nothing changes. */
function updateRow(workingCopy: WorkingCopy, key: string, change: (row: Row) => Row): WorkingCopy {
	const index = workingCopy.rows.findIndex((row) => row.key === key);
	if (index === -1) return workingCopy;
	const row = workingCopy.rows[index];
	const changed = change(row);
	if (changed === row) return workingCopy;
	const rows = [...workingCopy.rows];
	rows[index] = changed;
	return { ...workingCopy, rows };
}

/**
 * The definition with `patch` applied by the rules of one row: derived mode keeps the
 * programmatic name read-only and re-derives it on a display name edit (EDT-25, MOD-17); a blank
 * display name gives a blank name (MOD-19).
 */
function applyPatch(row: Row, patch: Partial<EntryDefinition>): Row {
	if (row.nameMode === 'manual') return { ...row, ...patch };
	const { programmaticName: _ignored, ...rest } = patch;
	const next = { ...row, ...rest };
	if ('displayName' in patch) next.programmaticName = predictFieldName(next.displayName) ?? '';
	return next;
}

/**
 * Edits one row's definition: any of its nine keys, one or several (EDT-23 to EDT-31).
 *
 * In derived mode an edit to the programmatic name is dropped and a display name edit re-derives
 * it (EDT-25). A mirror row refuses every edit (EDT-32, MOD-15). Values are kept as typed: the
 * cleaned form is computed on comparison and on save.
 */
export function editRow(workingCopy: WorkingCopy, key: string, patch: Partial<EntryDefinition>): WorkingCopy {
	return updateRow(workingCopy, key, (row) => (isMirror(row) ? row : applyPatch(row, patch)));
}

/**
 * Switches a row between derived and manual (EDT-25). The name does not move now: to manual it
 * stays as it is, now editable; back to derived it follows from the next display name edit.
 * A mirror row refuses (EDT-32).
 */
export function setNameMode(workingCopy: WorkingCopy, key: string, nameMode: NameMode): WorkingCopy {
	return updateRow(workingCopy, key, (row) =>
		isMirror(row) || row.nameMode === nameMode ? row : { ...row, nameMode }
	);
}

/**
 * Appends a blank row assigned to `targetEntityType` (EDT-18): data type text, everything else
 * empty, derived mode, new. `key` is the caller's client key; one already in use throws, since it
 * would make two rows one.
 */
export function addRow(workingCopy: WorkingCopy, key: string, targetEntityType: string): WorkingCopy {
	if (rowByKey(workingCopy, key)) throw new Error(`Row key already in use: ${key}`);
	const row: Row = {
		key,
		entryId: null,
		isNew: true,
		nameMode: 'derived',
		targetEntityType,
		programmaticName: '',
		displayName: '',
		dataType: 'text',
		validTypes: [],
		validValues: [],
		defaultValue: null,
		description: null,
		uniquePerProject: false,
		snapshot: null,
		snapshotSite: null,
		snapshotTime: null
	};
	return { ...workingCopy, rows: [...workingCopy.rows, row] };
}

/** Removes the rows with these keys at once, mirror rows included (EDT-33, EDT-32). */
export function removeRows(workingCopy: WorkingCopy, keys: readonly string[]): WorkingCopy {
	const gone = new Set(keys);
	const rows = workingCopy.rows.filter((row) => !gone.has(row.key));
	return rows.length === workingCopy.rows.length ? workingCopy : { ...workingCopy, rows };
}

/** Removes one row at once, a mirror row included (EDT-33, EDT-32). */
export function removeRow(workingCopy: WorkingCopy, key: string): WorkingCopy {
	return removeRows(workingCopy, [key]);
}

/**
 * The seam for re-sync from site (EDT-42): replaces a row's nine definition keys with
 * `definition`, wholesale, and its three snapshot fields with `snapshot` when one is given.
 * Nothing else moves: not the key, nor the name mode. No derivation, no mirror lock: re-sync is
 * how a mirror row catches up with the site. A snapshot is never compared (EDT-3): a refreshed
 * one alone leaves the set clean, and it is stored when the row's definition is (`saveRequest`).
 */
export function replaceDefinition(
	workingCopy: WorkingCopy,
	key: string,
	definition: EntryDefinition,
	snapshot?: EntrySnapshot
): WorkingCopy {
	return updateRow(workingCopy, key, (row) => ({
		...row,
		...definitionOf(definition),
		...(snapshot
			? { snapshot: snapshot.snapshot, snapshotSite: snapshot.snapshotSite, snapshotTime: snapshot.snapshotTime }
			: {})
	}));
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((item, i) => item === b[i]);
}

/** Whether two definitions have the same cleaned form (MOD-7, MOD-9). */
export function sameCleanedDefinition(a: EntryDefinition, b: EntryDefinition): boolean {
	const x = cleanEntry(definitionOf(a));
	const y = cleanEntry(definitionOf(b));
	return (
		x.targetEntityType === y.targetEntityType &&
		x.programmaticName === y.programmaticName &&
		x.displayName === y.displayName &&
		x.dataType === y.dataType &&
		sameList(x.validTypes, y.validTypes) &&
		sameList(x.validValues, y.validValues) &&
		x.defaultValue === y.defaultValue &&
		x.description === y.description &&
		x.uniquePerProject === y.uniquePerProject
	);
}

/** The set name as it would be stored (MOD-1). */
export function cleanedName(workingCopy: WorkingCopy): string {
	return workingCopy.name.trim();
}

/** The description as it would be stored: trimmed, blank as none (MOD-7). */
export function cleanedDescription(workingCopy: WorkingCopy): string | null {
	const description = workingCopy.description.trim();
	return description === '' ? null : description;
}

/** Whether the name or description differs from the saved one once cleaned. */
export function detailsChanged(workingCopy: WorkingCopy): boolean {
	const { saved } = workingCopy;
	return cleanedName(workingCopy) !== saved.name.trim() || cleanedDescription(workingCopy) !== saved.description;
}

/** The saved entries by id. */
export function savedById(workingCopy: WorkingCopy): Map<string, Entry> {
	return new Map(workingCopy.saved.entries.map((entry) => [entry.id, entry]));
}

/**
 * Whether there is anything to save (EDT-3): the name or description differs once cleaned, a row
 * was added or removed, or a stored row's cleaned definition differs from its saved entry's.
 * Snapshots, row order and name modes are not compared. An edit undone, or a row added and
 * removed again, leaves it clean.
 */
export function isDirty(workingCopy: WorkingCopy): boolean {
	if (detailsChanged(workingCopy)) return true;
	const saved = savedById(workingCopy);
	let stored = 0;
	for (const row of workingCopy.rows) {
		if (row.entryId === null) return true;
		const entry = saved.get(row.entryId);
		if (!entry || !sameCleanedDefinition(row, entry)) return true;
		stored += 1;
	}
	return stored !== saved.size;
}

/**
 * The validity of the set as it stands (EDT-12, EDT-13), by `validateSet`. Its ids are row keys.
 */
export function validity(workingCopy: WorkingCopy): SetValidity {
	return validateSet(
		workingCopy.name,
		workingCopy.rows.map((row) => ({
			id: row.key,
			targetEntityType: row.targetEntityType,
			programmaticName: row.programmaticName,
			displayName: row.displayName,
			dataType: row.dataType
		}))
	);
}
