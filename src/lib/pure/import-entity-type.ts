/**
 * Which entity type an imported column belongs to (IMP-17, IMP-21 to IMP-26, IMP-52).
 *
 * Rules where the spec leaves room:
 * - Hints, worksheet names, API names and display names are all compared trimmed and lowercased.
 * - Plural tolerance: one side equals the other plus "s" or "es". Only one suffix, on one side.
 * - A site type with a blank name or display name never matches on that name.
 * - When several types match, the first tier with a match wins: exact API name, exact display
 *   name, plural-tolerant API name, plural-tolerant display name. Within a tier, the list's order.
 * - The fallback is used trimmed and as given. It is not checked against the site's types.
 */
import type { LiveEntityType } from './live-entity-types';
import { trimFold } from './fold';

/** The two fields this module reads of a site's entity type: its API name and its display name. */
type NamedType = Pick<LiveEntityType, 'name' | 'displayName'>;

/** The modes, the default first (IMP-17). */
export const IMPORT_MODES = ['automatic', 'worksheet', 'header_prefix'] as const;

export type ImportMode = (typeof IMPORT_MODES)[number];

function isPluralOf(a: string, b: string): boolean {
	return a === b + 's' || a === b + 'es';
}

function exact(a: string, b: string): boolean {
	return b !== '' && a === b;
}

function pluralTolerant(a: string, b: string): boolean {
	return b !== '' && (isPluralOf(a, b) || isPluralOf(b, a));
}

/**
 * The API name of the site type a hint or worksheet name names, or `null` (IMP-21). Precedence
 * is in the module comment.
 */
export function resolveEntityType(text: string, types: readonly NamedType[]): string | null {
	const wanted = trimFold(text);
	if (wanted === '') return null;
	const tiers: [(a: string, b: string) => boolean, 'name' | 'displayName'][] = [
		[exact, 'name'],
		[exact, 'displayName'],
		[pluralTolerant, 'name'],
		[pluralTolerant, 'displayName']
	];
	for (const [matches, field] of tiers) {
		const found = types.find((type) => matches(wanted, trimFold(type[field])));
		if (found) return found.name;
	}
	return null;
}

export interface TargetInput {
	mode: ImportMode;
	/** The header's type hint, '' for none (import-header). */
	hint: string;
	/** The worksheet's name. Absent for a CSV. */
	worksheet?: string;
	/** The bucket's fallback entity type. '' when none is set. */
	fallback: string;
	/** The site's entity types. Absent when no site is connected. */
	types?: readonly NamedType[];
}

/**
 * The column's target entity type: an API name, the fallback, or '' when neither (IMP-22 to
 * IMP-25). Without a site nothing resolves and the fallback is used (IMP-52).
 */
export function targetEntityType(input: TargetInput): string {
	const { mode, hint, worksheet, fallback, types } = input;
	if (types) {
		const signals = mode === 'automatic' ? [hint, worksheet] : mode === 'worksheet' ? [worksheet] : [hint];
		for (const signal of signals) {
			const resolved = signal === undefined ? null : resolveEntityType(signal, types);
			if (resolved !== null) return resolved;
		}
	}
	return fallback.trim();
}

const HINTS: Readonly<Record<ImportMode, string>> = {
	automatic: 'Each column takes its type from its header prefix, else its sheet name, else the fallback.',
	worksheet: 'Each column takes its type from its sheet name, else the fallback. Prefixes are still cut from names.',
	header_prefix: 'Each column takes its type from its header prefix, else the fallback. Sheet names are ignored.'
};

/** The one-line hint under the mode switch (IMP-26). */
export function importModeHint(mode: ImportMode): string {
	return HINTS[mode];
}
