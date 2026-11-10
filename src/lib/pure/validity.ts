/**
 * What makes a set savable: a name, complete entries, no duplicated entry (EDT-12). Checks against
 * the live site are not here and never block a save (EDT-14).
 */
import type { Entry } from './model';

/** Whether a set name can be stored: something is left after trimming (MOD-1). */
export function isValidSetName(name: string): boolean {
	return name.trim() !== '';
}

/**
 * Whether the entry misses a required attribute: target entity type, programmatic name, display
 * name or data type, blank after trimming (MOD-6). Any non-blank data type counts, mirror or not.
 */
export function isIncomplete(
	entry: Pick<Entry, 'targetEntityType' | 'programmaticName' | 'displayName' | 'dataType'>
): boolean {
	return (
		entry.targetEntityType.trim() === '' ||
		entry.programmaticName.trim() === '' ||
		entry.displayName.trim() === '' ||
		entry.dataType.trim() === ''
	);
}

/**
 * The ids of the entries that share (target entity type, programmatic name) with another entry
 * of the list (MOD-5). Every member is reported, not only the later one (EDT-13). The pair is
 * compared after trimming and case-sensitively, as the site spells names. An entry missing
 * either half is never counted (EDT-12).
 */
export function duplicatedIds(
	entries: readonly Pick<Entry, 'id' | 'targetEntityType' | 'programmaticName'>[]
): Set<string> {
	const idsByPair = new Map<string, string[]>();
	for (const entry of entries) {
		const type = entry.targetEntityType.trim();
		const name = entry.programmaticName.trim();
		if (type === '' || name === '') continue;
		const pair = JSON.stringify([type, name]);
		const ids = idsByPair.get(pair);
		if (ids) ids.push(entry.id);
		else idsByPair.set(pair, [entry.id]);
	}
	const duplicated = new Set<string>();
	for (const ids of idsByPair.values()) {
		if (ids.length > 1) for (const id of ids) duplicated.add(id);
	}
	return duplicated;
}

/** What `validateSet` found: enough for the row marks (EDT-13) and the disabled reasons (EDT-9 to EDT-11). */
export interface SetValidity {
	/** The name is there, no entry is incomplete and none is duplicated (EDT-12). */
	valid: boolean;
	/** The set name is blank (MOD-1). */
	nameMissing: boolean;
	/** Ids of the incomplete entries, in entry order. Its length is the N of "N fields missing required values". */
	incompleteIds: string[];
	/** Ids of every entry in a duplicated pair, in entry order. */
	duplicateIds: string[];
}

/**
 * The validity of a working copy: the set's name and its entries as they stand, uncleaned.
 * An entry can be in both lists. A set with no entries is valid.
 */
export function validateSet(
	name: string,
	entries: readonly Pick<Entry, 'id' | 'targetEntityType' | 'programmaticName' | 'displayName' | 'dataType'>[]
): SetValidity {
	const nameMissing = !isValidSetName(name);
	const incompleteIds = entries.filter(isIncomplete).map((entry) => entry.id);
	const duplicated = duplicatedIds(entries);
	const duplicateIds = entries.filter((entry) => duplicated.has(entry.id)).map((entry) => entry.id);
	return {
		valid: !nameMissing && incompleteIds.length === 0 && duplicateIds.length === 0,
		nameMissing,
		incompleteIds,
		duplicateIds
	};
}
