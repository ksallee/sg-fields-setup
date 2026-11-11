/**
 * The advisory comparison of a set's entries with the connected site (specs/06-site-comparison.md,
 * CMP-1 to CMP-11). A heads-up while the user types; it never blocks a save (EDT-14). The install
 * plan (file 07) is the authority at install time.
 *
 * The comparison has no rule of its own about what an install can do. It asks the planner
 * (`planEntry`), with the row as it stands and the field as the cached listing holds it, and maps
 * the class and the reasons to a category, markers and notes. So the editor and the install
 * screen cannot disagree about a row, and a reason reads the same on both.
 *
 * | the plan's class            | category        | marker                          |
 * |-----------------------------|-----------------|---------------------------------|
 * | `create`                    | new             | none                            |
 * | `update`, `already-matches` | on site         | On site                         |
 * | `type-conflict`             | needs attention | Type mismatch                   |
 * | `blocked`                   | needs attention | Cannot update                   |
 * | `refused`                   | needs attention | Cannot create, and Label taken  |
 *
 * When the planner is not asked, and what the row reads as then:
 *
 * - No site: no comparison at all (CMP-3). New, unless incomplete or duplicated.
 * - An incomplete row: needs attention, and the form says what is missing. A duplicated row needs
 *   attention whatever the planner says; it is asked all the same, for the notes.
 * - A target type the loaded list lacks (CMP-10, Q1, PLN-14): needs attention, with the group's
 *   note. Its fields are not compared.
 * - A type whose fields are not cached yet, or could not be read: new (CMP-2). Judging a row
 *   against a listing that is still on its way would call every stock field a create.
 * - A mirror row: never planned (MOD-15, PLN-10). On site or new by its name; a type mismatch when
 *   the live field has another type.
 *
 * One call compares every row and returns a lookup by row key. It reads only what the caller holds
 * already: the type list and the cached field listings (CMP-11). It runs on every keystroke, so
 * each type's fields are indexed once per call, by programmatic name and by label. Measured at 500
 * rows: about 1.3 ms against 12 types of 300 fields, under 1 ms when every row is a create on one
 * type. No row's verdict is kept between calls: there is nothing to save.
 *
 * What the cached listing cannot show: a name the site answers for and does not declare, and a
 * field with no data type (`undeclared`, `no-data-type`). Only the plan's one-field read finds
 * those. With a site whose type list is not loaded yet, fields are still compared, no type is
 * marked absent, and no valid type is called unknown.
 */
import type { EntryCategory } from './category';
import { dataTypeLabel, isMirror } from './data-types';
import type { LiveEntityType } from './live-entity-types';
import type { LiveField, LiveFieldRead } from './live-field';
import type { EntryDefinition } from './model';
import { labelKey, planEntry, type PlanClass, type PlanSite } from './plan';
import { reasonText, type PlanReason } from './plan-reason';
import { isIncomplete } from './validity';

/** What the comparison reads from a row of the working copy: its definition, as the planner takes it. */
export type CompareRow = EntryDefinition & {
	/** Stable and unique within the working copy. */
	key: string;
};

/** What the caller holds of the connected site. Plain values: nothing here reads the site. */
export interface SiteData {
	/** The site's entity types; null while the list is not loaded (CMP-1). */
	entityTypes: readonly LiveEntityType[] | null;
	/** A type's cached field listing; null when not held (CMP-2, CMP-11). */
	fieldsOf: (entityType: string) => readonly LiveField[] | null;
}

export interface CompareInput {
	/** The working copy's rows, in its order. */
	rows: readonly CompareRow[];
	/** Keys of the rows in a duplicated pair (`duplicatedIds` over the rows, keyed by row key). */
	duplicated: ReadonlySet<string>;
	/** Null when no site is connected (CMP-3). */
	site: SiteData | null;
}

/** CMP-5: a live field on the target type has the row's programmatic name. */
export interface NameExists {
	field: LiveField;
	liveDataType: string;
	/** The live data type equals the row's, trimmed. */
	sameType: boolean;
}

/** CMP-6, PLN-16: another live field already has the display name of a row that would be created. */
export interface LabelTaken {
	/** That field's programmatic name. */
	fieldName: string;
	/** Its display name as read, untrimmed. */
	displayName: string;
}

/**
 * Why a row needs attention, in the order of the CMP-8 table. `cannot_update` is the plan's
 * `blocked`, `cannot_create` its `refused`.
 */
export type AttentionReason = 'incomplete' | 'duplicated' | 'type_not_on_site' | 'type_mismatch' | 'cannot_update' | 'cannot_create';

/** A marker on a collapsed row (CMP-9, EDT-20), in display order. */
export type RowMarker = 'on_site' | 'type_mismatch' | 'cannot_update' | 'cannot_create' | 'label_taken';

/**
 * One explanation in the expanded row (CMP-9, CMP-10). `explanationText` words it. The CMP-9
 * table has its own words for four cases. Every other reason the planner gives is a `plan` note
 * and reads as it does on the install screen.
 */
export type Explanation =
	| { kind: 'on_site'; fieldName: string }
	| { kind: 'type_mismatch'; liveDataType: string; wantedDataType: string }
	| {
			kind: 'unique_differs';
			entityType: string;
			/** The type's display name on the site, else its API name. */
			entityTypeLabel: string;
			/** The live field's display name, trimmed, else its programmatic name: the column's header. */
			fieldLabel: string;
			/** The entry wants unique on and the site has it off. */
			turnOn: boolean;
	  }
	| { kind: 'valid_types_differ'; live: string[]; wanted: string[] }
	| { kind: 'type_not_on_site'; entityType: string }
	| { kind: 'plan'; reason: PlanReason };

/** Everything the comparison found for one row. */
export interface RowComparison {
	category: EntryCategory;
	/** Empty unless the category is needs attention. */
	attention: AttentionReason[];
	nameExists: NameExists | null;
	labelTaken: LabelTaken | null;
	/** CMP-10: a site is connected, its type list is loaded and lacks the row's target type. */
	typeNotOnSite: boolean;
	/** The class the plan would give the row as it stands. Null when the planner was not asked. */
	planClass: PlanClass | null;
	/** Why the plan would not apply the row, as the planner gives them. Empty when it would, or was not asked. */
	reasons: PlanReason[];
	markers: RowMarker[];
	notes: Explanation[];
}

export interface SiteComparison {
	byKey: ReadonlyMap<string, RowComparison>;
	/** Trimmed target types the loaded list lacks, for the group marker (CMP-10). */
	notOnSite: ReadonlySet<string>;
	/** The row's category, for `buildEditorView`. A key not compared reads as `new`. */
	categoryOf: (key: string) => EntryCategory;
}

/** One type's cached fields, as the planner and the per-row lookup take them. */
interface TypeFields {
	byName: Map<string, LiveField>;
	/** The fields by `labelKey` of their display name, in listing order. */
	byLabel: Map<string, LiveField[]>;
	/** The planner's site for a row of this type: the loaded type list and this type's listing. */
	planSite: PlanSite;
}

const ABSENT: LiveFieldRead = { kind: 'absent', reason: 'does-not-exist', message: '' };
const NO_FIELDS: readonly LiveField[] = [];

function indexFields(type: string, fields: readonly LiveField[], entityTypes: readonly LiveEntityType[]): TypeFields {
	const byName = new Map<string, LiveField>();
	const byLabel = new Map<string, LiveField[]>();
	for (const field of fields) {
		if (!byName.has(field.name)) byName.set(field.name, field);
		const label = labelKey(field.displayName);
		const same = byLabel.get(label);
		if (same) same.push(field);
		else byLabel.set(label, [field]);
	}
	// The editor has no trash page to link to: a reason that needs one gives the menu path in words.
	return { byName, byLabel, planSite: { siteUrl: '', trashPageUrl: null, entityTypes, fieldsByType: new Map([[type, fields]]) } };
}

/**
 * The planner's site for a row whose field is absent. The planner looks through the type's
 * listing for a field with the row's display name (PLN-16), which at 500 rows and 300 fields is
 * 150,000 labels a keystroke. It is handed the fields that have that label, by the planner's own
 * `labelKey`, and no others: every field it could name is there, and the verdict is still its own.
 */
function absentSite(index: TypeFields, type: string, row: CompareRow): PlanSite {
	return { ...index.planSite, fieldsByType: new Map([[type, index.byLabel.get(labelKey(row.displayName)) ?? NO_FIELDS]]) };
}

/**
 * The types to plan against while the site's list is not loaded: the row's own target and valid
 * types and the live field's, so that nothing is called absent on no evidence (CMP-10).
 */
function assumedTypes(row: CompareRow, field: LiveField | undefined): LiveEntityType[] {
	const names = new Set([row.targetEntityType, ...row.validTypes, ...(field?.validTypes ?? [])].map((name) => name.trim()));
	return [...names].map((name) => ({ name, displayName: name, custom: false }));
}

function unplanned(attention: AttentionReason[]): RowComparison {
	return {
		category: attention.length > 0 ? 'needs_attention' : 'new',
		attention,
		nameExists: null,
		labelTaken: null,
		typeNotOnSite: false,
		planClass: null,
		reasons: [],
		markers: [],
		notes: []
	};
}

/**
 * Compares every row with the site in one pass (CMP-5 to CMP-10). Each row gets exactly one
 * category, first match wins (CMP-8): needs attention, on site, new.
 */
export function compareWithSite(input: CompareInput): SiteComparison {
	const { rows, duplicated, site } = input;
	const byKey = new Map<string, RowComparison>();
	const notOnSite = new Set<string>();
	const typeLabels = site?.entityTypes ? new Map(site.entityTypes.map((type) => [type.name, type.displayName])) : null;
	const indexes = new Map<string, TypeFields | null>();

	/** A type's fields, indexed once per call. Null while they are not cached (CMP-2). */
	function fieldsOf(type: string): TypeFields | null {
		let index = indexes.get(type);
		if (index === undefined) {
			const fields = site?.fieldsOf(type) ?? null;
			index = fields ? indexFields(type, fields, site?.entityTypes ?? []) : null;
			indexes.set(type, index);
		}
		return index;
	}

	for (const row of rows) {
		const attention: AttentionReason[] = [];
		const incomplete = isIncomplete(row);
		if (incomplete) attention.push('incomplete');
		if (duplicated.has(row.key)) attention.push('duplicated');
		if (!site) {
			byKey.set(row.key, unplanned(attention));
			continue;
		}

		const type = row.targetEntityType.trim();
		const name = row.programmaticName.trim();
		const dataType = row.dataType.trim();
		const result = unplanned(attention);
		const { markers, notes } = result;
		let onSite = false;

		if (typeLabels !== null && type !== '' && !typeLabels.has(type)) {
			result.typeNotOnSite = true;
			notOnSite.add(type);
			attention.push('type_not_on_site');
			notes.push({ kind: 'type_not_on_site', entityType: type });
		} else if (type !== '') {
			// A type whose fields are not cached yet counts as having none, and its rows are not
			// judged (CMP-2): they read as new until the listing arrives and the next call compares.
			const index = fieldsOf(type);
			const field = index === null || name === '' ? undefined : index.byName.get(name);
			if (field) result.nameExists = { field, liveDataType: field.dataType, sameType: field.dataType === dataType };
			const mismatch = (): void => {
				attention.push('type_mismatch');
				markers.push('type_mismatch');
				notes.push({ kind: 'type_mismatch', liveDataType: field?.dataType ?? '', wantedDataType: dataType });
			};

			if (index === null) {
				// Not judged.
			} else if (incomplete || isMirror(row)) {
				// Not planned: an incomplete row cannot be saved, a mirror row is never installed.
				if (result.nameExists && !result.nameExists.sameType) mismatch();
				else onSite = result.nameExists !== null;
			} else {
				const listed = field ? index.planSite : absentSite(index, type, row);
				const planSite = typeLabels === null ? { ...listed, entityTypes: assumedTypes(row, field) } : listed;
				const item = planEntry({ ...row, id: row.key }, field ? { kind: 'present', field } : ABSENT, planSite);
				if (item !== null) {
					result.planClass = item.class;
					result.reasons = item.reasons;
					const note = (reason: PlanReason): Explanation => {
						if (field && reason.code === 'unique-cannot-change') {
							return {
								kind: 'unique_differs',
								entityType: type,
								entityTypeLabel: typeLabels?.get(type) ?? type,
								fieldLabel: field.displayName.trim() || field.name,
								turnOn: reason.wanted === true
							};
						}
						if (reason.code === 'multi-entity-valid-types') {
							return { kind: 'valid_types_differ', live: [...(reason.live as string[])], wanted: [...(reason.wanted as string[])] };
						}
						return { kind: 'plan', reason };
					};
					switch (item.class) {
						case 'create':
							break;
						case 'update':
						case 'already-matches':
							onSite = true;
							break;
						case 'type-conflict':
							mismatch();
							break;
						case 'blocked':
							attention.push('cannot_update');
							markers.push('cannot_update');
							notes.push(...item.reasons.map(note));
							break;
						case 'refused': {
							attention.push('cannot_create');
							if (item.reasons.some((reason) => reason.code !== 'label-taken')) markers.push('cannot_create');
							const taken = item.reasons.find((reason) => reason.code === 'label-taken');
							const namesake = taken?.other ? index.byName.get(taken.other) : undefined;
							if (namesake) {
								result.labelTaken = { fieldName: namesake.name, displayName: namesake.displayName };
								markers.push('label_taken');
							}
							notes.push(...item.reasons.map(note));
							break;
						}
					}
				}
			}
		}

		result.category = attention.length > 0 ? 'needs_attention' : onSite ? 'on_site' : 'new';
		// An incomplete or duplicated row keeps what was found, but not the on-site marker and note:
		// they would contradict its category.
		if (result.category === 'on_site' && result.nameExists) {
			markers.unshift('on_site');
			notes.unshift({ kind: 'on_site', fieldName: result.nameExists.field.name });
		}
		byKey.set(row.key, result);
	}

	return {
		byKey,
		notOnSite,
		categoryOf: (key) => byKey.get(key)?.category ?? 'new'
	};
}

/** A key for one explanation among a row's: two plan notes of a row differ by code or by setting. */
export function explanationKey(explanation: Explanation): string {
	return explanation.kind === 'plan' ? `plan:${explanation.reason.code}:${explanation.reason.setting ?? ''}` : explanation.kind;
}

function typeList(types: readonly string[]): string {
	return types.length === 0 ? 'no type' : types.join(', ');
}

/** The words for one explanation, in the app's voice (CLAUDE.md, Copy). Plain text, never HTML. */
export function explanationText(explanation: Explanation): string {
	switch (explanation.kind) {
		case 'on_site':
			return 'This field already exists on the site. Install will leave it or update it.';
		case 'type_mismatch':
			return (
				`The field on the site is ${dataTypeLabel(explanation.liveDataType)}. The set wants ` +
				`${dataTypeLabel(explanation.wantedDataType)}. A field's type cannot be changed. Install will skip it.`
			);
		case 'unique_differs':
			return (
				`The API cannot change unique per project. To change it by hand in Flow PT, open a ` +
				`${explanation.entityTypeLabel} page, configure the ${explanation.fieldLabel} column and ` +
				`turn it ${explanation.turnOn ? 'on' : 'off'}.`
			);
		case 'valid_types_differ':
			return (
				`On the site this field links to ${typeList(explanation.live)}. The set wants ` +
				`${typeList(explanation.wanted)}. The API cannot change them. Install will skip this field. ` +
				`To reinstall it, delete the field on the site, then remove it from the site's trash for good.`
			);
		case 'type_not_on_site':
			return `${explanation.entityType} is not on this site. Enable it in Flow PT's admin screens, then re-check.`;
		case 'plan':
			// The planner's own words: the same on the install screen (PLN-18, RUN-21).
			return reasonText(explanation.reason);
	}
}
