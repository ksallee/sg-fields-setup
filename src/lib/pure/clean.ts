/**
 * Cleaning an entry for storing (MOD-7, MOD-8, MOD-9). The cleaned form is also what the editor
 * compares to tell whether an entry changed (EDT-3, EDT-45).
 */
import { carries } from './data-types';
import type { DefaultValue, EntryDefinition, EntrySnapshot, Timestamp } from './model';

function cleanList(items: readonly string[]): string[] {
	return items.map((item) => item.trim()).filter((item) => item !== '');
}

/** Checkbox: a boolean or none. List and status list: non-blank trimmed text or none (MOD-10). */
function cleanDefault(dataType: string, value: DefaultValue): DefaultValue {
	if (dataType === 'checkbox') return typeof value === 'boolean' ? value : null;
	if (typeof value !== 'string') return null;
	return value.trim() === '' ? null : value.trim();
}

/**
 * A cleaned copy of an entry. The entry given is never altered, and the copy shares no list with it.
 *
 * - The four required texts are trimmed (MOD-7). The data type is otherwise kept as read (MOD-14).
 * - A blank description becomes null (MOD-7).
 * - Every setting the data type does not carry is dropped: `[]`, `null`, `false` (MOD-9).
 * - A carried list has each item trimmed and blank items dropped. Order and repeats are kept.
 * - A carried default follows MOD-10: a default of the wrong kind for the type becomes null.
 *
 * Everything else on the entry (identity, timestamps, snapshot) passes through untouched.
 * Cleaning a cleaned entry changes nothing.
 */
export function cleanEntry<T extends EntryDefinition>(entry: T): T {
	const dataType = entry.dataType.trim();
	const description = entry.description?.trim() ?? '';
	return {
		...entry,
		targetEntityType: entry.targetEntityType.trim(),
		programmaticName: entry.programmaticName.trim(),
		displayName: entry.displayName.trim(),
		dataType,
		validTypes: carries(dataType, 'validTypes') ? cleanList(entry.validTypes) : [],
		validValues: carries(dataType, 'validValues') ? cleanList(entry.validValues) : [],
		defaultValue: carries(dataType, 'defaultValue') ? cleanDefault(dataType, entry.defaultValue) : null,
		description: description === '' ? null : description,
		uniquePerProject: carries(dataType, 'uniquePerProject') && entry.uniquePerProject
	};
}

/**
 * The entry as it is stored at `now`: one with a snapshot and no snapshot time gets `now` as its
 * snapshot time (MOD-8). Any other entry is returned as given. Never alters its input.
 */
export function withSnapshotTime<T extends EntrySnapshot>(entry: T, now: Timestamp): T {
	if (entry.snapshot === null || entry.snapshotTime !== null) return entry;
	return { ...entry, snapshotTime: now };
}
