/**
 * Matching an imported column's field name with a live field of its type (IMP-27, IMP-28).
 *
 * Rules where the spec leaves room:
 * - Both sides go through `normaliseName`. The live display name is used as read (untrimmed);
 *   the normaliser trims.
 * - Display names are tried first, programmatic names only when no display name matches. A
 *   display name match wins even if another field's programmatic name also matches.
 * - Several fields with the same normalised display name (or programmatic name): the first in
 *   listing order wins.
 * - A name that normalises to '' matches nothing, on either side. A live field whose display
 *   name normalises to '' can still match by programmatic name.
 * - The index for a type is built once, on the first column that asks for it.
 */
import { normaliseName } from './import-normalise';
import type { LiveField } from './live-field';

/** Live fields per entity type API name. A type with no entry has no fields. */
export type LiveFieldsByType = ReadonlyMap<string, readonly LiveField[]>;

/** One type's fields, keyed by normalised display name and by normalised programmatic name. */
export interface LiveFieldIndex {
	byDisplayName: ReadonlyMap<string, LiveField>;
	byName: ReadonlyMap<string, LiveField>;
}

function addFirst(map: Map<string, LiveField>, key: string, field: LiveField): void {
	if (key !== '' && !map.has(key)) map.set(key, field);
}

/** Indexes one type's fields, in listing order. */
export function indexLiveFields(fields: readonly LiveField[]): LiveFieldIndex {
	const byDisplayName = new Map<string, LiveField>();
	const byName = new Map<string, LiveField>();
	for (const field of fields) {
		addFirst(byDisplayName, normaliseName(field.displayName), field);
		addFirst(byName, normaliseName(field.name), field);
	}
	return { byDisplayName, byName };
}

/** The live field a field name matches, display names first (IMP-28). Null for none. */
export function matchLiveField(index: LiveFieldIndex, fieldName: string): LiveField | null {
	const key = normaliseName(fieldName);
	if (key === '') return null;
	return index.byDisplayName.get(key) ?? index.byName.get(key) ?? null;
}

/** Matches a field name on a type. Null when the type has no listing or nothing matches. */
export type Matcher = (entityType: string, fieldName: string) => LiveField | null;

/** A matcher over several types. Each type's index is built once, when first asked. */
export function createMatcher(fieldsByType: LiveFieldsByType): Matcher {
	const indexes = new Map<string, LiveFieldIndex>();
	return (entityType, fieldName) => {
		let index = indexes.get(entityType);
		if (!index) {
			index = indexLiveFields(fieldsByType.get(entityType) ?? []);
			indexes.set(entityType, index);
		}
		return matchLiveField(index, fieldName);
	};
}
