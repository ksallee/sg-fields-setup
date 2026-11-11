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
 * |               | Otherwise same kind and same value, structured values by content.                |
 * | valid values  | list: same values, same order. Status list: same set. Any other type: equal.     |
 * | valid types   | same types in the same order                                                     |
 * | unique        | same boolean; missing is off                                                     |
 *
 * Two points the table leaves open, settled here:
 *
 * - A checkbox always has a default on the site: its create fails without one, and a create sends
 *   false for an entry with none (PLN-13). So an entry with no checkbox default wants false. Without
 *   this a field the tool just created would not read as matching (PLN-20).
 * - Valid types keep "order matters". The corpus measured one read-back, `["Shot", "Asset"]`, and
 *   it came back in the order sent (`findings/116_field_settings_create_update`). Nothing measured
 *   contradicts the spec. What a write that only reorders does is unmeasured.
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

function sameContent(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	if (aKeys.length !== bKeys.length) return false;
	return aKeys.every(
		(key) => Object.hasOwn(b, key) && sameContent((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
	);
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((item, index) => item === b[index]);
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((item) => b.includes(item)) && b.every((item) => a.includes(item));
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
 * The entry is cleaned first (`cleanEntry`), so text is trimmed and a setting its type does not
 * carry counts as none. Neither argument is altered.
 */
export function diffEntry(entry: EntryDefinition, live: LiveField): Difference[] {
	const wanted = cleanEntry(entry);
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
		const equal = wanted.dataType === 'checkbox' ? (liveDefault ?? false) === want : sameContent(liveDefault, want);
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
