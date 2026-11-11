/**
 * The differences between an entry and the live field of the same name (specs/07-install-plan.md,
 * "Differences and equality", PLN-11, PLN-12).
 *
 * Equality only. Whether a difference can be written is the planner's question (`plan.ts`).
 *
 * | setting       | equal when                                                                       |
 * |---------------|----------------------------------------------------------------------------------|
 * | display name  | equal after trimming both                                                        |
 * | description   | equal after trimming both; none and blank are the same                           |
 * | default value | compared only on a type that carries one. None, missing and blank are the same.  |
 * |               | Otherwise same kind and same value. A structured live value never equals one.    |
 * | valid values  | list: same values, same order. Status list: same set. Any other type: equal.     |
 * | valid types   | same types in the same order                                                     |
 * | unique        | same boolean; missing is off                                                     |
 *
 * Three points the table leaves open, settled here:
 *
 * - A checkbox always has a default on the site: its create fails without one, and a create sends
 *   false for an entry with none (PLN-13). So an entry with no checkbox default wants false. Without
 *   this a field the tool just created would not read as matching (PLN-20).
 * - Valid types keep "order matters". The site keeps the order sent and a write that only reorders
 *   is applied: a reorder is a change (`findings/121_field_settings_edges`).
 * - Repeats. The site drops a repeated value from a list's valid values and from valid types, and
 *   stores a repeated code of a status list twice (finding 121). So the entry is compared, and
 *   sent, with its repeats removed: `wantedEntry`. Without this an entry holding a repeat would be
 *   written, read back without it, and differ for ever (PLN-20). The live side is compared as read.
 */
import { cleanEntry } from './clean';
import { carries } from './data-types';
import type { LiveField } from './live-field';
import type { EntryDefinition } from './model';

/** The settings that are compared, in the order differences are listed. */
export const DIFF_SETTINGS = ['displayName', 'description', 'defaultValue', 'validValues', 'validTypes', 'unique'] as const;

export type DiffSetting = (typeof DIFF_SETTINGS)[number];

/** A value an entry asks for. None is `null` for a single value and `[]` for a list. */
export type WantedValue = string | boolean | string[] | null;

/** One setting where the live field and the entry disagree. */
export interface Difference {
	setting: DiffSetting;
	/**
	 * What the site holds, with none as `null` or `[]`. A text, a boolean or a list of texts, except
	 * a default value, which is whatever the site sent.
	 */
	live: unknown;
	/** What the entry asks for. Text is trimmed. */
	wanted: WantedValue;
}

function isBlank(value: unknown): boolean {
	return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((item, index) => item === b[index]);
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((item) => b.includes(item)) && b.every((item) => a.includes(item));
}

/** A list with its repeats removed: the first occurrence is kept, the order otherwise preserved. Exact match. */
export function withoutRepeats(items: readonly string[]): string[] {
	return items.filter((item, index) => items.indexOf(item) === index);
}

/**
 * The entry as it is compared and sent: cleaned (`cleanEntry`), with no repeat in its valid values
 * or its valid types (finding 121). The entry given is never altered.
 */
export function wantedEntry<T extends EntryDefinition>(entry: T): T {
	const cleaned = cleanEntry(entry);
	return { ...cleaned, validValues: withoutRepeats(cleaned.validValues), validTypes: withoutRepeats(cleaned.validTypes) };
}

/**
 * The default value an entry asks for: a boolean on a checkbox (none is false, PLN-13), trimmed
 * text or null on a list or a status list, null on every other type (PLN-12).
 */
export function wantedDefault(entry: EntryDefinition): boolean | string | null {
	const cleaned = cleanEntry(entry);
	if (cleaned.dataType === 'checkbox') return cleaned.defaultValue === true;
	return cleaned.defaultValue;
}

/**
 * The differences between an entry and a live field, in the order of `DIFF_SETTINGS`. Empty when
 * they match. The data types are not compared: a field of another type is a type conflict, not a
 * difference (PLN-7).
 *
 * The entry is cleaned first (`wantedEntry`), so text is trimmed, a setting its type does not
 * carry counts as none and a repeated value counts once. Neither argument is altered.
 */
export function diffEntry(entry: EntryDefinition, live: LiveField): Difference[] {
	const wanted = wantedEntry(entry);
	const differences: Difference[] = [];

	const liveName = live.displayName.trim();
	if (liveName !== wanted.displayName) {
		differences.push({ setting: 'displayName', live: liveName, wanted: wanted.displayName });
	}

	const liveDescription = live.description.trim();
	if (liveDescription !== (wanted.description ?? '')) {
		differences.push({ setting: 'description', live: liveDescription === '' ? null : liveDescription, wanted: wanted.description });
	}

	if (carries(wanted.dataType, 'defaultValue')) {
		const want = wantedDefault(wanted);
		const liveDefault = isBlank(live.defaultValue) ? null : live.defaultValue;
		// A wanted default is a text, a boolean or none (`DefaultValue`), so identity is the whole of "by content".
		const equal = wanted.dataType === 'checkbox' ? (liveDefault ?? false) === want : liveDefault === want;
		if (!equal) differences.push({ setting: 'defaultValue', live: liveDefault, wanted: want });
	}

	if (carries(wanted.dataType, 'validValues')) {
		const equal = wanted.dataType === 'status_list' ? sameSet(live.validValues, wanted.validValues) : sameOrder(live.validValues, wanted.validValues);
		if (!equal) differences.push({ setting: 'validValues', live: [...live.validValues], wanted: wanted.validValues });
	}

	if (!sameOrder(live.validTypes, wanted.validTypes)) {
		differences.push({ setting: 'validTypes', live: [...live.validTypes], wanted: wanted.validTypes });
	}

	if (live.unique !== wanted.uniquePerProject) {
		differences.push({ setting: 'unique', live: live.unique, wanted: wanted.uniquePerProject });
	}

	return differences;
}
