/**
 * The one place a live field becomes an entry's definition: import on a match (IMP-30) and
 * re-sync from site (EDT-42).
 *
 * Rules where the spec leaves room:
 * - Display name: the site's, trimmed (Q8). A blank one stays '' and the entry is incomplete;
 *   it is never replaced by the header's text, which would plan a rename.
 * - Data type: exactly as read, never narrowed or guessed (MOD-14, MOD-16).
 * - Valid types, valid values and the unique flag are copied as read, whatever the type carries.
 *   Cleaning on save drops what the type does not carry (MOD-9).
 * - Description: trimmed, null when blank.
 * - Default value: a boolean for a checkbox, non-blank text (trimmed) for a list or status list,
 *   otherwise null. A default of another kind is dropped, never coerced: "true" on a checkbox is
 *   null.
 * - Snapshot: the live field's `raw` record, the site given, no time: storing sets the time
 *   (MOD-8). Re-sync refreshes the snapshot too, since the snapshot is the live field the entry was
 *   captured from.
 * - Re-sync matches a row's programmatic name exactly (trimmed, case kept, as the site spells
 *   names) among the live fields of the row's target type (trimmed). It keeps the row's target
 *   type and programmatic name exactly as they were.
 */
import { carries } from './data-types';
import type { LiveFieldsByType } from './import-match';
import type { LiveField } from './live-field';
import type { DefaultValue, EntryDefinition, EntryDraft, EntrySnapshot } from './model';

/** The live default as the model holds it (MOD-10), or null. */
export function liveDefaultValue(field: LiveField): DefaultValue {
	if (!carries(field.dataType, 'defaultValue')) return null;
	const value = field.defaultValue;
	if (field.dataType === 'checkbox') return typeof value === 'boolean' ? value : null;
	if (typeof value !== 'string') return null;
	return value.trim() === '' ? null : value.trim();
}

/** The seven attributes re-sync overwrites (EDT-42), from the live field. */
function liveAttributes(field: LiveField): Omit<EntryDefinition, 'targetEntityType' | 'programmaticName'> {
	const description = field.description.trim();
	return {
		displayName: field.displayName.trim(),
		dataType: field.dataType,
		validTypes: [...field.validTypes],
		validValues: [...field.validValues],
		defaultValue: liveDefaultValue(field),
		description: description === '' ? null : description,
		uniquePerProject: field.unique
	};
}

/** The definition that mirrors a live field, on the type it was read on (IMP-30). */
export function definitionFromLiveField(field: LiveField): EntryDefinition {
	return { targetEntityType: field.entityType, programmaticName: field.name, ...liveAttributes(field) };
}

/** The snapshot of a live field read from `site`. The time is left to storing (MOD-8). */
export function snapshotFromLiveField(field: LiveField, site: string): EntrySnapshot {
	return { snapshot: field.raw, snapshotSite: site, snapshotTime: null };
}

/** An import's entry for a matched column (IMP-30): the mirrored definition and its snapshot. */
export function draftFromLiveField(field: LiveField, site: string): EntryDraft {
	return { ...definitionFromLiveField(field), ...snapshotFromLiveField(field, site) };
}

/**
 * A row's definition re-synced from its live field (EDT-42): a fresh plain definition, with the
 * row's target type and programmatic name and the live values for the rest. The row is left as it
 * was, and nothing but the nine definition keys is returned.
 */
export function resyncDefinition(definition: EntryDefinition, field: LiveField): EntryDefinition {
	return {
		targetEntityType: definition.targetEntityType,
		programmaticName: definition.programmaticName,
		...liveAttributes(field)
	};
}

/** The live field with this exact programmatic name on this type (EDT-42), or null. */
export function findLiveField(fieldsByType: LiveFieldsByType, targetEntityType: string, programmaticName: string): LiveField | null {
	const type = targetEntityType.trim();
	const name = programmaticName.trim();
	if (type === '' || name === '') return null;
	return fieldsByType.get(type)?.find((field) => field.name === name) ?? null;
}

/** One re-synced row: its key, its new definition, its new snapshot. */
export interface ResyncUpdate<K = string> {
	key: K;
	definition: EntryDefinition;
	snapshot: EntrySnapshot;
}

export interface ResyncResult<K = string> {
	/** In row order. Rows with no live match are absent: they stay as they are. */
	updates: ResyncUpdate<K>[];
	/** How many rows were re-synced. Zero means none exist on the site: the screen warns. */
	count: number;
}

/**
 * Re-sync of the selected rows (EDT-42). `fieldsByType` holds the live fields of the rows'
 * target types; `site` is the connected site's URL, for the snapshot.
 */
export function resyncRows<K>(
	rows: readonly (EntryDefinition & { key: K })[],
	fieldsByType: LiveFieldsByType,
	site: string
): ResyncResult<K> {
	const updates: ResyncUpdate<K>[] = [];
	for (const row of rows) {
		const field = findLiveField(fieldsByType, row.targetEntityType, row.programmaticName);
		if (field) updates.push({ key: row.key, definition: resyncDefinition(row, field), snapshot: snapshotFromLiveField(field, site) });
	}
	return { updates, count: updates.length };
}
