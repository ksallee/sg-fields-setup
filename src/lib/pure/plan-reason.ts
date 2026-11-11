/**
 * Why the plan will not apply an entry, as data and as text (PLN-18, RUN-21).
 *
 * A reason is plain data: the screen can lay it out itself. `reasonParts` renders it as text and
 * link parts, `reasonText` as one text. Neither carries HTML. A link is given as its own part, to
 * be opened in a new tab.
 *
 * Every reason names the field by display and programmatic name. A reason about one setting names
 * the setting, the live value and the wanted value, then the manual fix.
 */
import { dataTypeLabel } from './data-types';
import type { DiffSetting, WantedValue } from './plan-diff';

/**
 * Every reason an entry is not applied.
 *
 * | code                                | class         | what it means                                                        |
 * |-------------------------------------|---------------|----------------------------------------------------------------------|
 * | `type-conflict`                     | type-conflict | the live field has another data type                                 |
 * | `incomplete`                        | refused       | a required value is blank (never so for a saved set, PLN-2)          |
 * | `type-not-on-site`                  | refused       | the target entity type is absent from the site (PLN-14)              |
 * | `undeclared`                        | refused       | the site answers for the name but its schema lists no such field     |
 * | `no-data-type`                      | refused       | the site returned the field with no data type                        |
 * | `non-ascii-name`                    | refused       | the display name holds a non-ASCII character (PLN-15)                |
 * | `unreachable-name`                  | refused       | the site would derive another programmatic name (PLN-15)             |
 * | `label-taken`                       | refused       | another live field has the display name (PLN-16)                     |
 * | `status-list-needs-values`          | refused       | a status list cannot be created without valid values                 |
 * | `entity-needs-valid-types`          | refused       | an entity link cannot be created without a valid type                |
 * | `multi-entity-needs-one-valid-type` | refused       | a multi-entity link takes exactly one valid type                     |
 * | `default-not-in-values`             | refused, blocked | the wanted default is missing from the wanted valid values        |
 * | `unique-cannot-change`              | blocked       | the unique flag differs (PLN-8)                                      |
 * | `multi-entity-valid-types`          | blocked       | valid types differ on a multi-entity link (PLN-8)                    |
 * | `default-cannot-be-cleared`         | blocked       | the live field has a default and the entry has none                  |
 * | `cannot-be-emptied`                 | blocked       | a description, valid values or valid types would be written as empty |
 * | `status-values-need-default`        | blocked       | the wanted status values leave out the default that stays            |
 * | `valid-type-not-on-site`            | refused, blocked | a valid type that would be sent is no entity type of the site, by exact name (finding 121) |
 * | `valid-type-removed`                | blocked       | an entity link's wanted valid types leave out a live one (finding 121) |
 */
export type ReasonCode =
	| 'type-conflict'
	| 'incomplete'
	| 'type-not-on-site'
	| 'undeclared'
	| 'no-data-type'
	| 'non-ascii-name'
	| 'unreachable-name'
	| 'label-taken'
	| 'status-list-needs-values'
	| 'entity-needs-valid-types'
	| 'multi-entity-needs-one-valid-type'
	| 'default-not-in-values'
	| 'unique-cannot-change'
	| 'multi-entity-valid-types'
	| 'default-cannot-be-cleared'
	| 'cannot-be-emptied'
	| 'status-values-need-default'
	| 'valid-type-not-on-site'
	| 'valid-type-removed';

/** An entity type a reason is about. */
export interface ReasonType {
	/** The name as the entry or the site holds it. */
	name: string;
	/** `valid-type-not-on-site`: the API name probably meant, when the site has exactly one candidate. Else null. */
	meant: string | null;
}

export interface PlanReason {
	code: ReasonCode;
	/** The entry's target entity type, programmatic name, display name and data type. */
	entityType: string;
	programmaticName: string;
	displayName: string;
	dataType: string;
	/** The setting the reason is about, or null when it is about the whole field. */
	setting: DiffSetting | null;
	/** That setting's value on the site. Null when there is no setting or no live field. */
	live: unknown;
	/** That setting's value in the entry. Null when there is no setting. */
	wanted: WantedValue;
	/**
	 * One more fact, by code. `type-conflict`: the live data type. `non-ascii-name` and
	 * `unreachable-name`: the name the site would give. `label-taken`: the programmatic name of the
	 * live field that has the label. `status-values-need-default`: the default the field would hold.
	 * Else null.
	 */
	other: string | null;
	/**
	 * The entity types the reason is about, in the order of the list they come from.
	 * `valid-type-not-on-site`: the wanted valid types the site lacks, each with the API name
	 * probably meant. `valid-type-removed`: the live valid types the entry leaves out. Else empty.
	 */
	types: ReasonType[];
	/** Whether the manual fix goes through the site's trash page for fields. */
	needsTrash: boolean;
	/** The trash page's address when the fix needs it and the site has one. Null otherwise. */
	trashPageUrl: string | null;
}

/** A piece of a rendered reason. Text is plain, never HTML. A link opens in a new tab. */
export type ReasonPart = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string };

const SETTING_LABELS: Readonly<Record<DiffSetting, string>> = {
	displayName: 'display name',
	description: 'description',
	defaultValue: 'default value',
	validValues: 'valid values',
	validTypes: 'valid types',
	unique: 'unique'
};

/** The name a person reads for a compared setting. */
export function settingLabel(setting: DiffSetting): string {
	return SETTING_LABELS[setting];
}

/**
 * A setting's value as a reason shows it: `none` for an empty value, text in quotes, a list in
 * brackets, a boolean as `true` or `false`, anything else as JSON.
 */
export function formatValue(value: unknown): string {
	if (value === null || value === undefined || value === '') return 'none';
	if (typeof value === 'string') return `"${value}"`;
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (Array.isArray(value)) return value.length === 0 ? 'none' : `[${value.map((item) => String(item)).join(', ')}]`;
	return JSON.stringify(value);
}

function fieldLabel(reason: PlanReason): string {
	return `"${reason.displayName}" (${reason.entityType}.${reason.programmaticName})`;
}

function onOff(value: unknown): string {
	return value === true ? 'on' : 'off';
}

/** "<field>, <setting>: <live> on the site, <wanted> in the set." */
function settingLead(reason: PlanReason): string {
	const setting = reason.setting;
	if (setting === null) return `${fieldLabel(reason)}.`;
	const show = setting === 'unique' ? onOff : formatValue;
	return `${fieldLabel(reason)}, ${settingLabel(setting)}: ${show(reason.live)} on the site, ${show(reason.wanted)} in the set.`;
}

/**
 * How to reach the site's trash page for fields: a link when the site has the page, the menu path
 * in words when it has none (corpus `findings/120_field_trash_page`). Ends the sentence it is in.
 */
export function trashParts(trashPageUrl: string | null): ReasonPart[] {
	if (trashPageUrl === null) {
		return [{ kind: 'text', text: 'the trash for fields. In Flow PT, open the admin menu, then Trash, then Fields.' }];
	}
	return [
		{ kind: 'link', text: 'the trash page for fields', href: trashPageUrl },
		{ kind: 'text', text: '.' }
	];
}

/** "A", "A and B", "A, B and C". */
function listed(items: readonly string[], last = 'and'): string {
	if (items.length <= 1) return items.join('');
	return `${items.slice(0, -1).join(', ')} ${last} ${items.at(-1)}`;
}

/**
 * The note for an item that makes reverse fields (`PlanItem.reverseFieldTypes`): a create of a
 * link, or an update that adds valid types to an entity link (corpus findings 116 and 121). Null
 * when it makes none. Information only: it stops nothing.
 */
export function reverseFieldsText(types: readonly string[]): string | null {
	if (types.length === 0) return null;
	return `Also makes a reverse field on ${listed(types)}. ${types.length === 1 ? 'It takes' : 'Each takes'} a field name there for good.`;
}

function text(value: string): ReasonPart[] {
	return [{ kind: 'text', text: value }];
}

function body(reason: PlanReason): ReasonPart[] {
	const field = fieldLabel(reason);
	const type = dataTypeLabel(reason.dataType);
	switch (reason.code) {
		case 'type-conflict': {
			const liveType = dataTypeLabel(reason.other ?? '');
			return text(
				`${field} is a ${liveType} field on the site. The set wants ${type}. A field's data type cannot be changed. Install skips it. Change the field's data type to ${liveType}, or give the field another name.`
			);
		}
		case 'incomplete':
			return text(
				`${field} misses a required value: entity type, programmatic name, display name or data type. Complete the field in the editor.`
			);
		case 'type-not-on-site':
			return text(
				`${field} is skipped. This site has no ${reason.entityType} entity. Enable it in Flow PT's admin screens, then refresh.`
			);
		case 'undeclared':
			return text(
				`${field} is skipped. The site answers for this name, but its schema does not list the field. The name is taken. Give the field another name.`
			);
		case 'no-data-type':
			return text(
				`${field} is skipped. The site returned this field with no data type. The name is taken and the field cannot be compared. Check the field in Flow PT, or give the field another name.`
			);
		case 'non-ascii-name':
			return text(
				`${field} cannot be created. The display name holds a character outside ASCII. The site drops such a name and calls the field ${reason.other}. Use an ASCII display name for the install. A later rename keeps the programmatic name.`
			);
		case 'unreachable-name':
			return text(
				`${field} cannot be created under that name. The site names a new field from its display name: ${reason.other}. Change the programmatic name to ${reason.other}, or change the display name.`
			);
		case 'label-taken':
			return text(
				`${field} cannot be created. ${reason.entityType}.${reason.other} already has the display name "${reason.displayName}". The site would add a suffix to the new field's name. Rename the field on the site, or change this display name.`
			);
		case 'status-list-needs-values':
			return text(`${field} cannot be created. A status list needs at least one valid value. Add valid values to the field.`);
		case 'entity-needs-valid-types':
			return text(`${field} cannot be created. An entity link needs at least one valid type. Add one to the field.`);
		case 'multi-entity-needs-one-valid-type': {
			const count = Array.isArray(reason.wanted) ? reason.wanted.length : 0;
			const has = count === 0 ? 'The field has none. Add one.' : `The field has ${count}. Keep one.`;
			return text(`${field} cannot be created. A multi-entity link takes exactly one valid type. ${has}`);
		}
		case 'default-not-in-values':
			return text(
				`${settingLead(reason)} The site refuses a default that is missing from the valid values. Add ${formatValue(reason.wanted)} to the field's valid values, or change its default.`
			);
		case 'unique-cannot-change':
			return text(
				`${settingLead(reason)} The API cannot change it. Change it by hand in Flow PT: open a ${reason.entityType} page, configure the field's column and turn the unique option ${onOff(reason.wanted)}. Or turn it ${onOff(reason.live)} in the set.`
			);
		case 'multi-entity-valid-types':
			return [
				...text(
					`${settingLead(reason)} The API cannot change the valid types of a multi-entity link. Install skips the field. To install it again, delete the field on the site, then delete it for good from `
				),
				...trashParts(reason.trashPageUrl)
			];
		case 'default-cannot-be-cleared':
			return text(
				`${settingLead(reason)} The API cannot clear a default. It can only change it to another value. Clear it by hand in Flow PT, or give the field a default.`
			);
		case 'cannot-be-emptied':
			return text(
				`${settingLead(reason)} The API refuses an empty value. Clear it by hand in Flow PT, or fill it in the set.`
			);
		case 'valid-type-not-on-site': {
			const names = reason.types.map((type) => `"${type.name}"`);
			const guesses = reason.types
				.filter((type) => type.meant !== null)
				.map((type) => ` "${type.name}" is probably ${type.meant}.`)
				.join('');
			const rule = `This site has no entity type named ${listed(names, 'or')}.${guesses} A valid type is the API name of an entity type, case included.`;
			// No live value: the field is absent and this is a create. The retirement was measured on an update only.
			if (reason.live === null) {
				return text(`${field} cannot be created. Its valid types are ${formatValue(reason.wanted)}. ${rule} Correct the field.`);
			}
			return text(
				`${settingLead(reason)} ${rule} On a field that exists, the site answers a name in the wrong case with a server error and retires the field. Install sends nothing. Correct the field.`
			);
		}
		case 'valid-type-removed': {
			const removed = listed(reason.types.map((type) => type.name));
			const one = reason.types.length === 1;
			const where = one ? removed : 'each of them';
			return text(
				`${settingLead(reason)} Removing ${removed} retires the reverse field of this link on ${where}. A retired field keeps its name, so the name stays taken, and adding the type back makes a new field under a new name. Install skips the field. Keep ${removed} in the field, or remove ${one ? 'it' : 'them'} by hand in Flow PT.`
			);
		}
		case 'status-values-need-default':
			return text(
				`${settingLead(reason)} A status list's valid values must include its default, ${formatValue(reason.other)}. Add it to the field's valid values, or change the default.`
			);
	}
}

/** The reason as text and link parts, in reading order. Adjacent text parts are merged. */
export function reasonParts(reason: PlanReason): ReasonPart[] {
	const merged: ReasonPart[] = [];
	for (const part of body(reason)) {
		const last = merged.at(-1);
		if (part.kind === 'text' && last?.kind === 'text') last.text += part.text;
		else merged.push({ ...part });
	}
	return merged;
}

/** The reason as one plain text. A link reads as its text followed by its address in brackets. */
export function reasonText(reason: PlanReason): string {
	return reasonParts(reason)
		.map((part) => (part.kind === 'link' ? `${part.text} (${part.href})` : part.text))
		.join('');
}
