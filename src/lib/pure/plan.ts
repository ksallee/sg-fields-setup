/**
 * The install plan (specs/07-install-plan.md): what an install would create, update, leave alone
 * or refuse, entry by entry. Pure: the caller reads the site and hands the reads in. Planning
 * writes nothing (PLN-19).
 *
 * Each entry gets exactly one class, first match wins (PLN-7, PLN-14 to PLN-16):
 *
 * | order | class             | when                                                               |
 * |-------|-------------------|--------------------------------------------------------------------|
 * | 0     | (left out)        | a mirror entry (PLN-10, B4)                                        |
 * | 1     | `refused`         | incomplete; or the target type is absent from the site (PLN-14)    |
 * | 2     | `refused`         | the name is taken by something that is not a readable field        |
 * | 3     | `refused`         | absent, and the create would go wrong (PLN-15, PLN-16, see below)  |
 * | 4     | `create`          | absent                                                             |
 * | 5     | `type-conflict`   | present with another data type                                     |
 * | 6     | `already-matches` | present, same type, no difference                                  |
 * | 7     | `blocked`         | present, same type, a difference the API cannot write              |
 * | 8     | `update`          | present, same type, every difference can be written                |
 *
 * Where the measured API (corpus findings 116, 117, 119, 120, 121) goes further than the spec:
 *
 * - A create is one request with every setting (finding 116). No update follows it.
 * - A create the server would refuse is refused here: a status list with no valid values, an
 *   entity link with no valid type, a multi-entity link with any number but one.
 * - A display name with a non-ASCII character makes the server name the field `sg_<data_type>`
 *   (finding 117). Such a create is refused, even when the entry asks for exactly that name.
 * - An update is one request with every property that differs (finding 121). The site applies a
 *   request whole or not at all, and checks it against the state it would leave, in any order. The
 *   properties go in a fixed order all the same: `UPDATE_ORDER`. There is never a second request,
 *   so nothing is ever half written.
 * - No write can clear a value: null, "", spaces alone and [] are refused (findings 116 and 121).
 *   A difference that would need one is blocked: a default, a description, valid values or valid
 *   types that the entry leaves empty and the site holds.
 * - A default that is written must be among the valid values the request leaves, and a status
 *   list's valid values must include the default the field would then hold. A wanted state that
 *   breaks either is blocked.
 * - Every valid type that would be sent must be an entity type of the site, by exact name. On an
 *   update a name in the wrong case is a 500 that retires the field (finding 121). Such an entry is
 *   refused or blocked, and nothing is sent. A connection type passes: the site lists it among the
 *   types it takes.
 * - An entity link holds a reverse field on each of its valid types (finding 121). Removing a type
 *   retires that field, and its name stays taken: an update that removes one is blocked. Adding a
 *   type, or creating a link, makes one: the item says on which types (`reverseFieldTypes`). A
 *   write that only reorders spent no name in the probe's run and is a plain update.
 * - Repeated valid values and valid types are sent once (`wantedEntry`, finding 121).
 * - A read that came back as `undeclared` or `no-data-type` means the server answers for the
 *   name. A create over it would get a suffixed name (finding 019). It is refused, not created.
 *   This is stricter than PLN-4, which calls such a read absent.
 */
import { cleanEntry } from './clean';
import { isMirror } from './data-types';
import { hasNonAscii, predictFieldName } from './field-name';
import { hasEntityType, type LiveEntityType } from './live-entity-types';
import type { LiveField, LiveFieldRead } from './live-field';
import type { EntryDefinition } from './model';
import { diffEntry, wantedDefault, wantedEntry, type Difference, type DiffSetting, type WantedValue } from './plan-diff';
import type { PlanReason, ReasonCode, ReasonType } from './plan-reason';
import { isIncomplete } from './validity';

/* What goes in. */

/** An entry as the planner needs it: its definition and its id. A stored `Entry` fits. */
export type PlanEntry = EntryDefinition & { id: string };

/** What the caller read from the site. The same for every entry of a plan. */
export interface PlanSite {
	/** The site's address, carried into the plan. */
	siteUrl: string;
	/**
	 * The address of the site's trash page for fields, `<site>/page/<id>`, or null when the site
	 * has no such page (corpus `findings/120_field_trash_page`).
	 */
	trashPageUrl: string | null;
	/** The site's entity types (PLN-14). Also what every valid type that is sent is checked against. */
	entityTypes: readonly LiveEntityType[];
	/**
	 * The live fields of each target entity type, keyed by the type's API name (PLN-16). Needed
	 * for every type that has an entry whose field is absent.
	 */
	fieldsByType: ReadonlyMap<string, readonly LiveField[]>;
}

/** Which projects the install makes the fields visible on (PLN-17, VIS-2). Carried through. */
export interface PlanScope {
	/** `all-eligible`: the picker is empty. `chosen`: the person picked projects. */
	kind: 'all-eligible' | 'chosen';
	/** The projects in scope, with names. */
	projects: readonly { id: number; name: string }[];
}

export interface PlanInput extends PlanSite {
	/** The entries to consider, in stored order: the whole set or the selection (PLN-1). */
	entries: readonly PlanEntry[];
	/**
	 * One read per entry, keyed by entry id. Required for every entry `needsRead` says yes to.
	 * A read that failed is not a read: the caller stops before planning (PLN-3).
	 */
	reads: ReadonlyMap<string, LiveFieldRead>;
	/**
	 * Left out when the caller plans before the scope is known: the install screen's scope follows
	 * the picker with no new plan (VIS-11). The plan then carries null.
	 */
	scope?: PlanScope | null;
}

/** The caller broke the contract: a read or a field listing the plan needs was not supplied. */
export class PlanInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PlanInputError';
	}
}

/* What comes out. */

export const PLAN_CLASSES = ['type-conflict', 'refused', 'blocked', 'create', 'update', 'already-matches'] as const;

/** `refused` covers PLN-14 to PLN-16 and the creates the server would refuse. It shows with the conflicts (RUN-2). */
export type PlanClass = (typeof PLAN_CLASSES)[number];

/** A property name of the schema endpoints, spelled as the corpus cards spell it. */
export type PropertyName = 'name' | 'description' | 'valid_values' | 'default_value' | 'valid_types' | 'unique';

/** One `{property_name, value}` of a schema write. A checkbox default is a boolean, never text. */
export interface PropertyWrite {
	property_name: PropertyName;
	value: string | boolean | string[];
}

/** The body of `POST /schema/<Type>/fields`, complete: one request creates the field with every setting. */
export interface CreatePayload {
	data_type: string;
	properties: PropertyWrite[];
}

/**
 * The body of one `PUT /schema/<Type>/fields/<field>`: every property that differs, in the order of
 * `UPDATE_ORDER`. Never empty. The site applies it whole or not at all (corpus finding 121).
 */
export interface UpdateRequest {
	properties: PropertyWrite[];
}

/**
 * The order of the properties in an update's request. The site does not care (finding 121). It is
 * fixed so that the same differences always give the same request. `updateRequest` builds from it.
 */
export const UPDATE_ORDER = ['name', 'description', 'valid_values', 'default_value', 'valid_types'] as const;

/** A difference the API cannot write, and why. */
export interface BlockedDifference extends Difference {
	why: ReasonCode;
}

export interface PlanItem {
	entryId: string;
	/** The entry's values, cleaned: what the row shows (RUN-3). */
	entityType: string;
	programmaticName: string;
	displayName: string;
	dataType: string;
	class: PlanClass;
	/** Why it is refused: the code of its first reason. Null unless the class is `refused`. */
	refusal: ReasonCode | null;
	/** The live field's data type when the field is present, else null. Differs from `dataType` on a type conflict. */
	liveDataType: string | null;
	/**
	 * `update`: every difference, each one written. `blocked`: the differences that would have
	 * been fine (PLN-9); none of them is written. Empty for every other class.
	 */
	differences: Difference[];
	/** `blocked`: the differences the API cannot write. Empty for every other class. */
	blocked: BlockedDifference[];
	/** Why nothing is applied, ready to show. At least one for `type-conflict`, `refused` and `blocked`; else empty. */
	reasons: PlanReason[];
	/** `create`: the request to send. Null for every other class. */
	create: CreatePayload | null;
	/** `update`: the one request to send. Null for every other class. */
	update: UpdateRequest | null;
	/**
	 * The entity types on which applying this item makes a reverse field, each one a field name
	 * taken on that type for good (corpus findings 116 and 121). `create` of an entity or a
	 * multi-entity link: its valid types. `update` of an entity link: the valid types it adds.
	 * Empty for everything else. Information only: `reverseFieldsText` renders it.
	 */
	reverseFieldTypes: string[];
}

export interface Plan {
	siteUrl: string;
	/** One item per planned entry, in the order the entries were given (RUN-6). Mirrors are left out. */
	items: PlanItem[];
	/** How many items each class has (PLN-17). */
	counts: Record<PlanClass, number>;
	/** How many mirror entries were left out (PLN-10). */
	mirrorsLeftOut: number;
	/** Why `items` is empty, or null when it is not. */
	empty: 'no-entries' | 'only-mirrors' | null;
	/** The scope the plan was made for (PLN-17), or null when none was given. */
	scope: PlanScope | null;
}

/* Planning. */

/**
 * Whether the planner needs this entry's field read from the site: not for a mirror, an
 * incomplete entry or one whose target type the site lacks. Reading a field of a type the site
 * lacks fails, and that failure would abort the plan (PLN-3).
 */
export function needsRead(entry: EntryDefinition, entityTypes: readonly LiveEntityType[]): boolean {
	const cleaned = cleanEntry(entry);
	return !isMirror(cleaned) && !isIncomplete(cleaned) && hasEntityType(entityTypes, cleaned.targetEntityType);
}

function liveDefaultText(live: LiveField): string | null {
	return typeof live.defaultValue === 'string' && live.defaultValue.trim() !== '' ? live.defaultValue : null;
}

function isEmpty(value: WantedValue): boolean {
	return value === null || (Array.isArray(value) && value.length === 0);
}

/**
 * The API name a valid type that is no entity type probably stands for: the one type whose API name
 * differs only by case, else the one type that has it as display name, trimmed and without case.
 * Null when the site has no such type, or more than one.
 */
function meantType(name: string, entityTypes: readonly LiveEntityType[]): string | null {
	const lower = name.trim().toLowerCase();
	const one = (matches: LiveEntityType[]) => (matches.length === 1 ? matches[0].name : null);
	return (
		one(entityTypes.filter((type) => type.name.toLowerCase() === lower)) ??
		one(entityTypes.filter((type) => type.displayName.trim().toLowerCase() === lower))
	);
}

/**
 * The valid types that are no entity type of the site, by exact name (corpus finding 121), each
 * with the API name probably meant. Empty when every one can be sent.
 */
export function unknownValidTypes(validTypes: readonly string[], entityTypes: readonly LiveEntityType[]): ReasonType[] {
	return validTypes
		.filter((name) => !hasEntityType(entityTypes, name))
		.map((name) => ({ name, meant: meantType(name, entityTypes) }));
}

interface Block {
	why: ReasonCode;
	/** `status-values-need-default`: the default the field would hold. */
	other: string | null;
	/** The entity types the block is about (`PlanReason.types`). */
	types: ReasonType[];
}

/** Why a difference cannot be written, or null when it can. */
function blockOf(
	difference: Difference,
	entry: EntryDefinition,
	live: LiveField,
	differences: readonly Difference[],
	site: PlanSite
): Block | null {
	const listType = entry.dataType === 'list' || entry.dataType === 'status_list';
	const blocked = (why: ReasonCode, more: Partial<Block> = {}): Block => ({ why, other: null, types: [], ...more });
	switch (difference.setting) {
		case 'displayName':
			return null;
		case 'description':
			return isEmpty(difference.wanted) ? blocked('cannot-be-emptied') : null;
		case 'unique':
			return blocked('unique-cannot-change');
		case 'validTypes': {
			if (entry.dataType === 'multi_entity') return blocked('multi-entity-valid-types');
			if (isEmpty(difference.wanted)) return blocked('cannot-be-emptied');
			// The name first: a wrong name must never be sent, and "shot" over "Shot" is no removal.
			const unknown = unknownValidTypes(entry.validTypes, site.entityTypes);
			if (unknown.length > 0) return blocked('valid-type-not-on-site', { types: unknown });
			const removed = live.validTypes.filter((type) => !entry.validTypes.includes(type));
			return removed.length > 0 ? blocked('valid-type-removed', { types: removed.map((name) => ({ name, meant: null })) }) : null;
		}
		case 'defaultValue':
			if (!listType) return null;
			if (difference.wanted === null) return blocked('default-cannot-be-cleared');
			return entry.validValues.includes(difference.wanted as string) ? null : blocked('default-not-in-values');
		case 'validValues': {
			if (isEmpty(difference.wanted)) return blocked('cannot-be-emptied');
			if (entry.dataType !== 'status_list') return null;
			// The default the field would hold: the wanted one, or the live one when the entry has
			// none, since a default cannot be cleared.
			const wantedValue = wantedDefault(entry);
			const stays = wantedValue ?? liveDefaultText(live);
			if (typeof stays !== 'string' || entry.validValues.includes(stays)) return null;
			// A wanted default that differs from the live one has its own block: `default-not-in-values`.
			const defaultDiffers = differences.some((other) => other.setting === 'defaultValue');
			return wantedValue !== null && defaultDiffers ? null : blocked('status-values-need-default', { other: stays });
		}
	}
}

function write(property_name: PropertyName, value: PropertyWrite['value']): PropertyWrite {
	return { property_name, value };
}

/**
 * The one request of an update: a property per difference, in the order of `UPDATE_ORDER`. Every
 * difference given is writable. The site checks the request as a whole (finding 121), so no order
 * is needed between valid values and a default.
 */
function updateRequest(entry: EntryDefinition, differences: readonly Difference[]): UpdateRequest {
	const has = (setting: DiffSetting) => differences.some((difference) => difference.setting === setting);
	const wanted = wantedDefault(entry);
	const values: Partial<Record<(typeof UPDATE_ORDER)[number], PropertyWrite['value']>> = {};
	if (has('displayName')) values.name = entry.displayName;
	if (has('description') && entry.description !== null) values.description = entry.description;
	if (has('validValues')) values.valid_values = [...entry.validValues];
	if (has('defaultValue') && wanted !== null) values.default_value = wanted;
	if (has('validTypes')) values.valid_types = [...entry.validTypes];
	return {
		properties: UPDATE_ORDER.flatMap((name) => {
			const value = values[name];
			return value === undefined ? [] : [write(name, value)];
		})
	};
}

/** What a create sends (PLN-13): every setting in one request (corpus finding 116). */
function createPayload(entry: EntryDefinition): CreatePayload {
	const properties: PropertyWrite[] = [write('name', entry.displayName)];
	if (entry.description !== null) properties.push(write('description', entry.description));
	if (entry.validValues.length > 0) properties.push(write('valid_values', [...entry.validValues]));
	const wanted = wantedDefault(entry);
	if (wanted !== null) properties.push(write('default_value', wanted));
	if (entry.validTypes.length > 0) properties.push(write('valid_types', [...entry.validTypes]));
	if (entry.uniquePerProject) properties.push(write('unique', true));
	return { data_type: entry.dataType, properties };
}

/**
 * The plan for one entry, or null for a mirror entry, which is never planned (PLN-10).
 *
 * `read` is the entry's field as read from the site. It may be null only when `needsRead` says
 * no. Throws `PlanInputError` when a needed read is missing, or when the field is absent and
 * `site.fieldsByType` has no listing for its type: the plan never guesses that a field is absent
 * or that a label is free.
 *
 * Also what a run calls after re-reading or reviving a field (RUN-7, RUN-10): a `present` read
 * gives `update`, `blocked`, `already-matches` or `type-conflict`.
 */
export function planEntry(entry: PlanEntry, read: LiveFieldRead | null, site: PlanSite): PlanItem | null {
	// Cleaned, and with no repeated valid value or valid type: what is compared is what is sent.
	const wanted = wantedEntry(entry);
	if (isMirror(wanted)) return null;

	const item: PlanItem = {
		entryId: entry.id,
		entityType: wanted.targetEntityType,
		programmaticName: wanted.programmaticName,
		displayName: wanted.displayName,
		dataType: wanted.dataType,
		class: 'refused',
		refusal: null,
		liveDataType: null,
		differences: [],
		blocked: [],
		reasons: [],
		create: null,
		update: null,
		reverseFieldTypes: []
	};
	const reason = (code: ReasonCode, more: Partial<PlanReason> = {}): PlanReason => ({
		code,
		entityType: item.entityType,
		programmaticName: item.programmaticName,
		displayName: item.displayName,
		dataType: item.dataType,
		setting: null,
		live: null,
		wanted: null,
		other: null,
		types: [],
		needsTrash: false,
		trashPageUrl: null,
		...more
	});
	const refused = (reasons: PlanReason[]): PlanItem => ({ ...item, class: 'refused', refusal: reasons[0].code, reasons });

	if (isIncomplete(wanted)) return refused([reason('incomplete')]);
	if (!hasEntityType(site.entityTypes, wanted.targetEntityType)) return refused([reason('type-not-on-site')]);
	if (read === null) {
		throw new PlanInputError(`No read of ${wanted.targetEntityType}.${wanted.programmaticName} was given to the plan.`);
	}

	if (read.kind === 'absent') {
		if (read.reason === 'undeclared') return refused([reason('undeclared')]);
		if (read.reason === 'no-data-type') return refused([reason('no-data-type')]);

		const reasons: PlanReason[] = [];
		// The name the server would give: with the data type, for a non-ASCII display name (G11).
		const serverName = predictFieldName(wanted.displayName, wanted.dataType);
		if (hasNonAscii(wanted.displayName)) reasons.push(reason('non-ascii-name', { other: serverName }));
		else if (serverName !== wanted.programmaticName) reasons.push(reason('unreachable-name', { other: serverName }));

		const fields = site.fieldsByType.get(wanted.targetEntityType);
		if (fields === undefined) {
			throw new PlanInputError(`No field listing of ${wanted.targetEntityType} was given to the plan.`);
		}
		const label = wanted.displayName.toLowerCase();
		const namesake = fields.find(
			(field) => field.name !== wanted.programmaticName && field.displayName.trim().toLowerCase() === label
		);
		if (namesake) reasons.push(reason('label-taken', { other: namesake.name }));

		if (wanted.dataType === 'status_list' && wanted.validValues.length === 0) {
			reasons.push(reason('status-list-needs-values', { setting: 'validValues', wanted: [] }));
		}
		if (wanted.dataType === 'entity' && wanted.validTypes.length === 0) {
			reasons.push(reason('entity-needs-valid-types', { setting: 'validTypes', wanted: [] }));
		}
		if (wanted.dataType === 'multi_entity' && wanted.validTypes.length !== 1) {
			reasons.push(reason('multi-entity-needs-one-valid-type', { setting: 'validTypes', wanted: wanted.validTypes }));
		}
		const unknown = unknownValidTypes(wanted.validTypes, site.entityTypes);
		if (unknown.length > 0) {
			reasons.push(reason('valid-type-not-on-site', { setting: 'validTypes', wanted: wanted.validTypes, types: unknown }));
		}
		const wantedValue = wantedDefault(wanted);
		if (typeof wantedValue === 'string' && !wanted.validValues.includes(wantedValue)) {
			reasons.push(reason('default-not-in-values', { setting: 'defaultValue', wanted: wantedValue }));
		}

		if (reasons.length > 0) return refused(reasons);
		// A link makes a field on each of its valid types (findings 116 and 121).
		return { ...item, class: 'create', create: createPayload(wanted), reverseFieldTypes: [...wanted.validTypes] };
	}

	const live = read.field;
	item.liveDataType = live.dataType;
	if (live.dataType !== wanted.dataType) {
		return { ...item, class: 'type-conflict', reasons: [reason('type-conflict', { other: live.dataType })] };
	}

	const differences = diffEntry(wanted, live);
	if (differences.length === 0) return { ...item, class: 'already-matches' };

	const fine: Difference[] = [];
	const blocked: BlockedDifference[] = [];
	const reasons: PlanReason[] = [];
	for (const difference of differences) {
		const block = blockOf(difference, wanted, live, differences, site);
		if (block === null) {
			fine.push(difference);
			continue;
		}
		blocked.push({ ...difference, why: block.why });
		const needsTrash = block.why === 'multi-entity-valid-types';
		reasons.push(
			reason(block.why, {
				setting: difference.setting,
				live: difference.live,
				wanted: difference.wanted,
				other: block.other,
				types: block.types,
				needsTrash,
				trashPageUrl: needsTrash ? site.trashPageUrl : null
			})
		);
	}
	if (blocked.length > 0) return { ...item, class: 'blocked', differences: fine, blocked, reasons };

	// An entity link gains a field on each type added. No type is removed: that is blocked above.
	const added = differences.some((difference) => difference.setting === 'validTypes')
		? wanted.validTypes.filter((type) => !live.validTypes.includes(type))
		: [];
	return { ...item, class: 'update', differences, update: updateRequest(wanted, differences), reverseFieldTypes: added };
}

/**
 * The plan for a set or a selection: one item per entry that is not a mirror, in the order given,
 * with the count per class and the scope carried through. A plan with no items says why in `empty`.
 * Throws `PlanInputError` as `planEntry` does.
 */
export function planSet(input: PlanInput): Plan {
	const counts = Object.fromEntries(PLAN_CLASSES.map((planClass) => [planClass, 0])) as Record<PlanClass, number>;
	const items: PlanItem[] = [];
	let mirrorsLeftOut = 0;
	for (const entry of input.entries) {
		const item = planEntry(entry, input.reads.get(entry.id) ?? null, input);
		if (item === null) {
			mirrorsLeftOut += 1;
			continue;
		}
		items.push(item);
		counts[item.class] += 1;
	}
	const empty = items.length > 0 ? null : mirrorsLeftOut > 0 ? 'only-mirrors' : 'no-entries';
	return { siteUrl: input.siteUrl, items, counts, mirrorsLeftOut, empty, scope: input.scope ?? null };
}

/** Why a plan has nothing in it, ready to show. Null when it has items. */
export function emptyPlanText(plan: Pick<Plan, 'empty' | 'mirrorsLeftOut'>): string | null {
	if (plan.empty === 'no-entries') return 'Nothing to install. No field is selected.';
	if (plan.empty === 'only-mirrors') {
		return plan.mirrorsLeftOut === 1
			? 'Nothing to install. The selected field has a data type the API cannot create.'
			: 'Nothing to install. The selected fields have data types the API cannot create.';
	}
	return null;
}
