/**
 * What one row of the editor shows beyond its own values (EDT-20, EDT-25, EDT-29): its badges,
 * the required values it lacks, the default value's inputs and the hint on a derived name.
 * Pure: the row component draws what these return.
 */
import type { RowMarker } from './compare';
import { isMirror } from './data-types';
import { hasNonAscii, predictFieldName } from './field-name';
import type { DefaultValue, EntryDefinition } from './model';
import type { NameMode } from './working-copy';

export type RowBadgeKind = 'mirror' | 'incomplete' | 'duplicate' | RowMarker;

/** How a badge reads at a glance. The component maps it to a theme token. */
export type BadgeTone = 'neutral' | 'success' | 'warning' | 'destructive';

export interface RowBadge {
	kind: RowBadgeKind;
	label: string;
	tone: BadgeTone;
}

const BADGES: Record<RowBadgeKind, Omit<RowBadge, 'kind'>> = {
	mirror: { label: 'Computed', tone: 'neutral' },
	incomplete: { label: 'Incomplete', tone: 'destructive' },
	duplicate: { label: 'Duplicate', tone: 'destructive' },
	on_site: { label: 'On site', tone: 'success' },
	type_mismatch: { label: 'Type mismatch', tone: 'warning' },
	cannot_update: { label: 'Cannot update', tone: 'warning' },
	cannot_create: { label: 'Cannot create', tone: 'warning' },
	label_taken: { label: 'Label taken', tone: 'warning' }
};

/**
 * The markers on a collapsed row (EDT-20): mirror, incomplete, duplicate (EDT-13), then the site
 * markers in the comparison's order (CMP-9). What blocks a save reads as destructive; what the
 * site will object to as a warning.
 */
export function rowBadges(state: {
	mirror: boolean;
	incomplete: boolean;
	duplicated: boolean;
	markers: readonly RowMarker[];
}): RowBadge[] {
	const kinds: RowBadgeKind[] = [];
	if (state.mirror) kinds.push('mirror');
	if (state.incomplete) kinds.push('incomplete');
	if (state.duplicated) kinds.push('duplicate');
	kinds.push(...state.markers);
	return kinds.map((kind) => ({ kind, ...BADGES[kind] }));
}

/** The required values a row lacks, named as the form labels them, in form order (MOD-6). */
export function missingRequired(
	row: Pick<EntryDefinition, 'targetEntityType' | 'programmaticName' | 'displayName' | 'dataType'>
): string[] {
	const missing: string[] = [];
	if (row.targetEntityType.trim() === '') missing.push('entity type');
	if (row.displayName.trim() === '') missing.push('display name');
	if (row.programmaticName.trim() === '') missing.push('programmatic name');
	if (row.dataType.trim() === '') missing.push('data type');
	return missing;
}

/** "Missing entity type and display name." Empty for nothing missing. */
export function missingText(missing: readonly string[]): string {
	if (missing.length === 0) return '';
	if (missing.length === 1) return `Missing ${missing[0]}.`;
	return `Missing ${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}.`;
}

/** A checkbox default's three states in the editor (MOD-10). */
export const CHECKBOX_DEFAULTS = ['none', 'checked', 'unchecked'] as const;
export type CheckboxDefault = (typeof CHECKBOX_DEFAULTS)[number];

export const CHECKBOX_DEFAULT_LABELS: Record<CheckboxDefault, string> = {
	none: 'None',
	checked: 'Checked',
	unchecked: 'Unchecked'
};

/** Which of the three states a stored default is. Anything but a boolean is none (MOD-10). */
export function checkboxDefaultChoice(value: DefaultValue): CheckboxDefault {
	return value === true ? 'checked' : value === false ? 'unchecked' : 'none';
}

export function checkboxDefaultValue(choice: CheckboxDefault): DefaultValue {
	return choice === 'checked' ? true : choice === 'unchecked' ? false : null;
}

/** A list or status list default as the text box shows it: its text, or blank for none (MOD-10). */
export function listDefaultText(value: DefaultValue): string {
	return typeof value === 'string' ? value : '';
}

/** The default as typed. Blank is none; trimming is left to cleaning (MOD-10, MOD-7). */
export function listDefaultValue(text: string): DefaultValue {
	return text === '' ? null : text;
}

/**
 * The hint on a derived name whose display name holds a non-ASCII character (EDT-25, G11): the
 * site names such a field `sg_<data_type>` and the plan refuses to create it (PLN-15,
 * findings/117). Null on a typed name, on a mirror row and on an ASCII display name.
 *
 * Only for a row the planner has not judged: no site, a type the site lacks, a listing still on
 * its way. With a site the comparison asks the planner, and the open row shows the planner's own
 * reason for this and for a typed name the site would not derive (`compare.ts`). A typed name is
 * left alone here: without the site's fields it may be a field that exists, such as `code`.
 */
export function nonAsciiNameWarning(row: Pick<EntryDefinition, 'displayName' | 'dataType'> & { nameMode: NameMode }): string | null {
	if (row.nameMode !== 'derived' || isMirror(row)) return null;
	const display = row.displayName.trim();
	if (!hasNonAscii(display)) return null;
	const predicted = predictFieldName(display, row.dataType.trim() || undefined);
	const named = predicted ? `name a new field ${predicted}` : 'name a new field after its data type';
	return `The display name holds a character outside ASCII. The site would ${named}. Install refuses to create it. Use an ASCII display name.`;
}
