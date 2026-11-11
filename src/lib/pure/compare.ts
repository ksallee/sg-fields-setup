/**
 * The advisory comparison of a set's entries with the connected site (specs/06-site-comparison.md,
 * CMP-1 to CMP-11). A heads-up while the user types; it never blocks a save (EDT-14). The install
 * plan (file 07) is the authority at install time.
 *
 * One call compares every row and returns a lookup by row key. It reads only what the caller holds
 * already: the type list and the cached field listings (CMP-11). It runs on every keystroke, so each
 * type's fields are indexed once per call, by programmatic name and by normalised display name.
 *
 * Decisions where the spec leaves room:
 * - Type not on this site (CMP-10, Q1) is a needs-attention reason. The plan refuses those entries
 *   (PLN-14), so counting them as new would make the filter lie. Its fields are not compared.
 * - Label taken (CMP-6) is a note and a marker. It does not change the category: CMP-8 does not list
 *   it.
 * - Blocked change reads the row as cleaning stores it, as the planner reads the saved entry: the
 *   unique flag counts only on a type that carries it, and valid types are trimmed with blanks
 *   dropped (MOD-9, `clean.ts`).
 * - With no site there is no comparison at all (CMP-3). With a site whose type list is not loaded
 *   yet, fields are still compared but no type is marked absent.
 */
import type { EntryCategory } from './category';
import { carries, dataTypeLabel } from './data-types';
import type { LiveEntityType } from './live-entity-types';
import type { LiveField } from './live-field';
import { isIncomplete } from './validity';

/** What the comparison reads from a row of the working copy. Rows keep their own other fields. */
export interface CompareRow {
	/** Stable and unique within the working copy. */
	key: string;
	targetEntityType: string;
	programmaticName: string;
	displayName: string;
	dataType: string;
	validTypes: readonly string[];
	uniquePerProject: boolean;
}

/** What the caller holds of the connected site. Plain values: nothing here reads the site. */
export interface SiteData {
	/** The site's entity types; null while the list is not loaded (CMP-1). */
	entityTypes: readonly Pick<LiveEntityType, 'name' | 'displayName'>[] | null;
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

/** CMP-6: another live field already has the row's display name. */
export interface LabelTaken {
	/** That field's programmatic name. */
	fieldName: string;
	/** Its display name as read, untrimmed. */
	displayName: string;
}

/** CMP-7, PLN-8: a difference in a setting the API cannot change. Null where that setting agrees. */
export interface BlockedChange {
	unique: { live: boolean; wanted: boolean } | null;
	/** Multi-entity links only. */
	validTypes: { live: string[]; wanted: string[] } | null;
}

/** Why a row needs attention, in the order of the CMP-8 table. */
export type AttentionReason = 'incomplete' | 'duplicated' | 'type_not_on_site' | 'type_mismatch' | 'cannot_update';

/** A marker on a collapsed row (CMP-9, EDT-20), in display order. */
export type RowMarker = 'on_site' | 'type_mismatch' | 'cannot_update' | 'label_taken';

/** One explanation in the expanded row (CMP-9, CMP-10). `explanationText` words it. */
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
	| { kind: 'label_taken'; fieldName: string; displayName: string }
	| { kind: 'type_not_on_site'; entityType: string };

/** Everything the comparison found for one row. */
export interface RowComparison {
	category: EntryCategory;
	/** Empty unless the category is needs attention. */
	attention: AttentionReason[];
	nameExists: NameExists | null;
	labelTaken: LabelTaken | null;
	blocked: BlockedChange | null;
	/** CMP-10: a site is connected, its type list is loaded and lacks the row's target type. */
	typeNotOnSite: boolean;
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

/** One type's fields, indexed for the per-row lookups. */
interface FieldIndex {
	byName: Map<string, LiveField>;
	/** Normalised display name to the fields that carry it, in listing order. */
	byLabel: Map<string, LiveField[]>;
}

const NO_FIELDS: FieldIndex = { byName: new Map(), byLabel: new Map() };

function normaliseLabel(label: string): string {
	return label.trim().toLowerCase();
}

function indexFields(fields: readonly LiveField[]): FieldIndex {
	const index: FieldIndex = { byName: new Map(), byLabel: new Map() };
	for (const field of fields) {
		if (!index.byName.has(field.name)) index.byName.set(field.name, field);
		const label = normaliseLabel(field.displayName);
		if (label === '') continue;
		const same = index.byLabel.get(label);
		if (same) same.push(field);
		else index.byLabel.set(label, [field]);
	}
	return index;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((item, i) => item === b[i]);
}

function cleanList(items: readonly string[]): string[] {
	return items.map((item) => item.trim()).filter((item) => item !== '');
}

function blockedChange(row: CompareRow, dataType: string, field: LiveField): BlockedChange | null {
	const wantedUnique = carries(dataType, 'uniquePerProject') && row.uniquePerProject;
	const unique = wantedUnique !== field.unique ? { live: field.unique, wanted: wantedUnique } : null;
	let validTypes: BlockedChange['validTypes'] = null;
	if (dataType === 'multi_entity') {
		const wanted = cleanList(row.validTypes);
		if (!sameList(wanted, field.validTypes)) validTypes = { live: [...field.validTypes], wanted };
	}
	return unique || validTypes ? { unique, validTypes } : null;
}

function offSite(attention: AttentionReason[]): RowComparison {
	return {
		category: attention.length > 0 ? 'needs_attention' : 'new',
		attention,
		nameExists: null,
		labelTaken: null,
		blocked: null,
		typeNotOnSite: false,
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
	const indexes = new Map<string, FieldIndex>();

	function fieldsOf(type: string): FieldIndex {
		let index = indexes.get(type);
		if (!index) {
			// A type whose fields are not cached yet counts as having none (CMP-2): its rows read as
			// new until the listing arrives and the next call compares them.
			const fields = site?.fieldsOf(type) ?? null;
			index = fields ? indexFields(fields) : NO_FIELDS;
			indexes.set(type, index);
		}
		return index;
	}

	for (const row of rows) {
		const attention: AttentionReason[] = [];
		if (isIncomplete(row)) attention.push('incomplete');
		if (duplicated.has(row.key)) attention.push('duplicated');
		if (!site) {
			byKey.set(row.key, offSite(attention));
			continue;
		}

		const type = row.targetEntityType.trim();
		const name = row.programmaticName.trim();
		const dataType = row.dataType.trim();
		const label = normaliseLabel(row.displayName);
		const markers: RowMarker[] = [];
		const notes: Explanation[] = [];
		let nameExists: NameExists | null = null;
		let labelTaken: LabelTaken | null = null;
		let blocked: BlockedChange | null = null;

		const typeNotOnSite = typeLabels !== null && type !== '' && !typeLabels.has(type);
		if (typeNotOnSite) {
			notOnSite.add(type);
			attention.push('type_not_on_site');
			notes.push({ kind: 'type_not_on_site', entityType: type });
		} else if (type !== '') {
			const index = fieldsOf(type);
			const field = name === '' ? undefined : index.byName.get(name);
			if (field) {
				nameExists = { field, liveDataType: field.dataType, sameType: field.dataType === dataType };
				if (!nameExists.sameType) {
					attention.push('type_mismatch');
					markers.push('type_mismatch');
					notes.push({ kind: 'type_mismatch', liveDataType: field.dataType, wantedDataType: dataType });
				} else {
					blocked = blockedChange(row, dataType, field);
					if (blocked) {
						attention.push('cannot_update');
						markers.push('cannot_update');
						if (blocked.unique) {
							notes.push({
								kind: 'unique_differs',
								entityType: type,
								entityTypeLabel: typeLabels?.get(type) ?? type,
								fieldLabel: field.displayName.trim() || field.name,
								turnOn: blocked.unique.wanted
							});
						}
						if (blocked.validTypes) notes.push({ kind: 'valid_types_differ', ...blocked.validTypes });
					}
				}
			}
			const other = label === '' ? undefined : index.byLabel.get(label)?.find((live) => live.name !== name);
			if (other) {
				labelTaken = { fieldName: other.name, displayName: other.displayName };
				markers.push('label_taken');
				notes.push({ kind: 'label_taken', ...labelTaken });
			}
		}

		const category: EntryCategory = attention.length > 0 ? 'needs_attention' : nameExists ? 'on_site' : 'new';
		// An incomplete or duplicated row keeps what was found, but not the on-site marker and note:
		// they would contradict its category.
		if (category === 'on_site' && nameExists) {
			markers.unshift('on_site');
			notes.unshift({ kind: 'on_site', fieldName: nameExists.field.name });
		}
		byKey.set(row.key, { category, attention, nameExists, labelTaken, blocked, typeNotOnSite, markers, notes });
	}

	return {
		byKey,
		notOnSite,
		categoryOf: (key) => byKey.get(key)?.category ?? 'new'
	};
}

function typeList(types: readonly string[]): string {
	return types.length === 0 ? 'no type' : types.join(', ');
}

/** The words for one explanation, in the app's voice (CLAUDE.md, Copy). */
export function explanationText(explanation: Explanation): string {
	switch (explanation.kind) {
		case 'on_site':
			return 'This field already exists on the site. Install will leave it or update it.';
		case 'type_mismatch':
			return (
				`The field on the site is ${dataTypeLabel(explanation.liveDataType)}, not ` +
				`${dataTypeLabel(explanation.wantedDataType)}. A field's type cannot be changed. Install will skip it.`
			);
		case 'unique_differs':
			return (
				`The API cannot change unique per project. To change it by hand in FPT, open a ` +
				`${explanation.entityTypeLabel} page, configure the ${explanation.fieldLabel} column and ` +
				`turn it ${explanation.turnOn ? 'on' : 'off'}.`
			);
		case 'valid_types_differ':
			return (
				`On the site this field links to ${typeList(explanation.live)}. This entry links to ` +
				`${typeList(explanation.wanted)}. The API cannot change them. Install will skip this field. ` +
				`To reinstall it, delete the field on the site, then remove it from the site's trash for good.`
			);
		case 'label_taken':
			return (
				`The field ${explanation.fieldName} on the site already has this display name. ` +
				`The server would create a second field with a suffix on its name.`
			);
		case 'type_not_on_site':
			return `${explanation.entityType} is not on this site. Enable it in FPT's admin screens, then re-check.`;
	}
}
