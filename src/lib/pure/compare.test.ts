import { describe, expect, it } from 'vitest';
import {
	compareWithSite,
	explanationKey,
	explanationText,
	type CompareRow,
	type Explanation,
	type SiteData
} from './compare';
import { readEntityTypes } from './live-entity-types';
import { readField, type LiveField } from './live-field';
import { planEntry, type PlanClass, type PlanItem, type PlanSite } from './plan';
import { reasonText, type ReasonCode } from './plan-reason';

interface RecordOptions {
	unique?: boolean;
	validTypes?: string[];
	validValues?: string[];
	defaultValue?: unknown;
	description?: string;
}

/** A field record shaped as `GET /schema/<Type>/fields` sends it: every value wrapped. */
function record(dataType: string, displayName: string, options: RecordOptions = {}): Record<string, unknown> {
	return {
		data_type: { value: dataType, editable: false },
		name: { value: displayName, editable: true },
		description: { value: options.description ?? '', editable: true },
		unique: { value: options.unique ?? false, editable: false },
		visible: { value: true, editable: true },
		properties: {
			default_value: { value: options.defaultValue ?? null, editable: false },
			valid_values: { value: options.validValues ?? null, editable: true },
			valid_types: { value: options.validTypes ?? null, editable: dataType !== 'multi_entity' }
		}
	};
}

function live(entityType: string, name: string, dataType: string, displayName: string, options: RecordOptions = {}): LiveField {
	const field = readField(entityType, name, record(dataType, displayName, options));
	if (!field) throw new Error('fixture without a data type');
	return field;
}

/** The type list, shaped as `GET /schema` sends it. */
const types = readEntityTypes({
	Shot: { name: { value: 'Shot', editable: false } },
	Asset: { name: { value: 'Asset', editable: false } },
	CustomEntity03: { name: { value: 'Camera ', editable: false } }
});

const shotFields = [
	live('Shot', 'sg_lens', 'text', 'Lens'),
	live('Shot', 'sg_frames', 'number', 'Frames'),
	live('Shot', 'sg_serial', 'text', 'Serial', { unique: true }),
	live('Shot', 'sg_cameras', 'multi_entity', 'Cameras', { validTypes: ['CustomEntity03'] }),
	live('Shot', 'sg_main_asset', 'entity', 'Main asset', { validTypes: ['Asset'] }),
	live('Shot', 'sg_notes_label', 'text', ' Director Notes '),
	live('Shot', 'sg_described', 'text', 'Described', { description: 'What it is for.' }),
	live('Shot', 'sg_grade', 'list', 'Grade', { validValues: ['a', 'b'], defaultValue: 'a' }),
	live('Shot', 'sg_state', 'status_list', 'State', { validValues: ['ip', 'fin'], defaultValue: 'ip' })
];

function site(fields: Record<string, readonly LiveField[] | null> = { Shot: shotFields }): SiteData {
	return { entityTypes: types, fieldsOf: (type) => fields[type] ?? null };
}

function row(key: string, patch: Partial<CompareRow> = {}): CompareRow {
	return {
		key,
		targetEntityType: 'Shot',
		programmaticName: `sg_field_${key}`,
		displayName: `Field ${key}`,
		dataType: 'text',
		validTypes: [],
		validValues: [],
		defaultValue: null,
		description: null,
		uniquePerProject: false,
		...patch
	};
}

/** The site as the planner takes it, with the same listings: what the install screen would plan against. */
function planSite(fields: Record<string, readonly LiveField[]> = { Shot: shotFields }): PlanSite {
	return { siteUrl: '', trashPageUrl: null, entityTypes: types, fieldsByType: new Map(Object.entries(fields)) };
}

/** What the planner gives a row whose field is read from the same listing, whole. */
function plannedItem(r: CompareRow, fields: Record<string, readonly LiveField[]> = { Shot: shotFields }): PlanItem | null {
	const field = (fields[r.targetEntityType.trim()] ?? []).find((candidate) => candidate.name === r.programmaticName.trim());
	const read = field ? ({ kind: 'present', field } as const) : ({ kind: 'absent', reason: 'does-not-exist', message: '' } as const);
	return planEntry({ ...r, id: r.key }, read, planSite(fields));
}

function planned(r: CompareRow, fields?: Record<string, readonly LiveField[]>): PlanClass | null {
	return plannedItem(r, fields)?.class ?? null;
}

function one(r: CompareRow, data: SiteData | null = site(), duplicated: ReadonlySet<string> = new Set()) {
	const result = compareWithSite({ rows: [r], duplicated, site: data }).byKey.get(r.key);
	if (!result) throw new Error('no result');
	return result;
}

describe('compareWithSite: name exists (CMP-5)', () => {
	it('CMP-5: a live field with the exact programmatic name is found, with its type and the match', () => {
		const result = one(row('a', { programmaticName: 'sg_lens', displayName: 'Lens' }));
		expect(result.nameExists).toMatchObject({ liveDataType: 'text', sameType: true });
		expect(result.nameExists?.field.name).toBe('sg_lens');
	});

	it('CMP-5: the name is trimmed before matching', () => {
		expect(one(row('a', { programmaticName: '  sg_lens ' })).nameExists?.sameType).toBe(true);
	});

	it('CMP-5: the match is case-sensitive', () => {
		expect(one(row('a', { programmaticName: 'sg_Lens' })).nameExists).toBeNull();
	});

	it('CMP-5: a different live data type is recorded', () => {
		const result = one(row('a', { programmaticName: 'sg_frames', dataType: 'text' }));
		expect(result.nameExists).toMatchObject({ liveDataType: 'number', sameType: false });
	});

	it('CMP-5: the row data type is trimmed before comparing', () => {
		expect(one(row('a', { programmaticName: 'sg_frames', dataType: ' number ' })).nameExists?.sameType).toBe(true);
	});

	it('CMP-5: a field on another type is not a match', () => {
		expect(one(row('a', { targetEntityType: 'Asset', programmaticName: 'sg_lens' }), site()).nameExists).toBeNull();
	});
});

describe('compareWithSite: label taken (CMP-6, PLN-16)', () => {
	it('CMP-6: another field with the same display name, trimmed and without case, is named', () => {
		const result = one(row('a', { programmaticName: 'sg_director_notes', displayName: 'director notes  ' }));
		expect(result.labelTaken).toEqual({ fieldName: 'sg_notes_label', displayName: ' Director Notes ' });
	});

	it('CMP-6: the field that has the same programmatic name does not count', () => {
		expect(one(row('a', { programmaticName: 'sg_lens', displayName: 'Lens' })).labelTaken).toBeNull();
	});

	// Was: "a field with the same programmatic name is skipped and another with the label is found".
	// The label is the planner's check now, and the planner checks it for a create only (PLN-16):
	// the old note said "the server would create a second field", which is not so for a field that
	// exists.
	it('PLN-16: a label is checked for a field that would be created, not for one that exists', () => {
		const fields = [live('Shot', 'sg_lens', 'text', 'Lens'), live('Shot', 'sg_lens_1', 'text', 'Lens')];
		const result = one(row('a', { programmaticName: 'sg_lens', displayName: 'Lens' }), site({ Shot: fields }));
		expect(result.labelTaken).toBeNull();
		expect(result.category).toBe('on_site');
	});

	it('CMP-6: a blank display name takes no label', () => {
		const fields = [live('Shot', 'sg_blank', 'text', '')];
		expect(one(row('a', { displayName: ' ' }), site({ Shot: fields })).labelTaken).toBeNull();
	});

	// Was: "a label taken is a note and does not change the category". CMP-8 was written before
	// PLN-16: the plan refuses such a create, so the row needs attention.
	it('CMP-6, PLN-16: a label taken needs attention, since install refuses the create', () => {
		const result = one(row('a', { programmaticName: 'sg_director_notes', displayName: 'Director Notes' }));
		expect(result.category).toBe('needs_attention');
		expect(result.attention).toEqual(['cannot_create']);
		expect(result.markers).toEqual(['label_taken']);
		expect(result.planClass).toBe('refused');
	});
});

describe('compareWithSite: blocked change (CMP-7, PLN-8)', () => {
	const codes = (result: ReturnType<typeof one>) => result.reasons.map((reason) => reason.code);

	it('CMP-7: the unique flag differs on a text field', () => {
		const result = one(row('a', { programmaticName: 'sg_serial', displayName: 'Serial' }));
		expect(codes(result)).toEqual(['unique-cannot-change']);
		expect(result.reasons[0]).toMatchObject({ live: true, wanted: false });
		expect(result.category).toBe('needs_attention');
	});

	it('CMP-7: asking for unique on a field that is not unique is blocked too', () => {
		const result = one(row('a', { programmaticName: 'sg_lens', displayName: 'Lens', uniquePerProject: true }));
		expect(result.reasons[0]).toMatchObject({ code: 'unique-cannot-change', live: false, wanted: true });
	});

	it('PLN-8, MOD-9: a unique flag on a type that does not carry it is read as off, as the planner reads the cleaned entry', () => {
		const result = one(
			row('a', { programmaticName: 'sg_cameras', displayName: 'Cameras', dataType: 'multi_entity', validTypes: ['CustomEntity03'], uniquePerProject: true })
		);
		expect(result.reasons).toEqual([]);
		expect(result.category).toBe('on_site');
	});

	it('CMP-7: multi-entity valid types that differ are blocked', () => {
		const result = one(row('a', { programmaticName: 'sg_cameras', dataType: 'multi_entity', validTypes: ['Asset'] }));
		expect(codes(result)).toEqual(['multi-entity-valid-types']);
		expect(result.reasons[0]).toMatchObject({ live: ['CustomEntity03'], wanted: ['Asset'] });
		expect(result.category).toBe('needs_attention');
	});

	it('CMP-7: valid types are compared as ordered lists', () => {
		const fields = [live('Shot', 'sg_links', 'multi_entity', 'Links', { validTypes: ['Asset', 'Shot'] })];
		const swapped = row('a', { programmaticName: 'sg_links', displayName: 'Links', dataType: 'multi_entity', validTypes: ['Shot', 'Asset'] });
		expect(codes(one(swapped, site({ Shot: fields })))).toEqual(['multi-entity-valid-types']);
		const same = row('a', { programmaticName: 'sg_links', displayName: 'Links', dataType: 'multi_entity', validTypes: [' Asset', 'Shot', ''] });
		expect(one(same, site({ Shot: fields })).reasons).toEqual([]);
	});

	// Was: "valid types on a single-entity link are updatable, so never blocked", with the live
	// type replaced. Probe 121 since found that removing a valid type retires a reverse field, and
	// the planner blocks it (PLN-8, note of 2026-11-10). Adding one is still a plain update.
	it('PLN-8: adding a valid type to a single-entity link is an update; removing one is blocked', () => {
		const added = one(row('a', { programmaticName: 'sg_main_asset', displayName: 'Main asset', dataType: 'entity', validTypes: ['Asset', 'Shot'] }));
		expect(added.reasons).toEqual([]);
		expect(added.category).toBe('on_site');
		expect(added.planClass).toBe('update');
		const replaced = one(row('a', { programmaticName: 'sg_main_asset', displayName: 'Main asset', dataType: 'entity', validTypes: ['Shot'] }));
		expect(codes(replaced)).toEqual(['valid-type-removed']);
		expect(replaced.category).toBe('needs_attention');
	});

	it('CMP-7: a blocked change needs the same data type', () => {
		const result = one(row('a', { programmaticName: 'sg_serial', dataType: 'number' }));
		expect(codes(result)).toEqual(['type-conflict']);
		expect(result.markers).toEqual(['type_mismatch']);
	});
});

/*
 * The heart of audit finding 2: whatever the planner would not apply, the editor says needs
 * attention, with the reason. One case per reason code. The record is typed by `ReasonCode`, so
 * a code added to the planner does not compile until it has a case here.
 */
interface ReasonCase {
	row: CompareRow;
	fields?: Record<string, readonly LiveField[]>;
	/** A piece of the note the open row shows. */
	says: string;
}

const REASON_CASES: Record<ReasonCode, ReasonCase | { notFromAListing: string }> = {
	'type-conflict': { row: row('a', { programmaticName: 'sg_frames', displayName: 'Frames' }), says: 'The field on the site is Number. The set wants Text.' },
	incomplete: { row: row('a', { displayName: ' ' }), says: '' },
	'type-not-on-site': { row: row('a', { targetEntityType: 'CustomEntity19' }), says: 'CustomEntity19 is not on this site.' },
	undeclared: { notFromAListing: 'A listing holds only the fields the schema declares. Only the plan\'s one-field read can find a name the site answers for and does not declare.' },
	'no-data-type': { notFromAListing: 'A record with no data type is not a field (PLN-4), so the listing leaves it out. Only the plan\'s one-field read sees it.' },
	'non-ascii-name': { row: row('a', { programmaticName: 'sg_text', displayName: 'Durée' }), says: 'The display name holds a character outside ASCII.' },
	'unreachable-name': { row: row('a', { programmaticName: 'sg_kit', displayName: 'Lens kit' }), says: 'The site names a new field from its display name: sg_lens_kit.' },
	'label-taken': {
		row: row('a', { programmaticName: 'sg_director_notes', displayName: 'Director Notes' }),
		says: 'Shot.sg_notes_label already has the display name "Director Notes".'
	},
	'status-list-needs-values': { row: row('a', { dataType: 'status_list' }), says: 'A status list needs at least one valid value.' },
	'entity-needs-valid-types': { row: row('a', { dataType: 'entity' }), says: 'An entity link needs at least one valid type.' },
	'multi-entity-needs-one-valid-type': {
		row: row('a', { dataType: 'multi_entity', validTypes: ['Asset', 'Shot'] }),
		says: 'A multi-entity link takes exactly one valid type. The field has 2.'
	},
	'default-not-in-values': {
		row: row('a', { programmaticName: 'sg_grade', displayName: 'Grade', dataType: 'list', validValues: ['a', 'b'], defaultValue: 'z' }),
		says: 'The site refuses a default that is missing from the valid values.'
	},
	'unique-cannot-change': { row: row('a', { programmaticName: 'sg_serial', displayName: 'Serial' }), says: 'The API cannot change unique per project.' },
	'multi-entity-valid-types': {
		row: row('a', { programmaticName: 'sg_cameras', displayName: 'Cameras', dataType: 'multi_entity', validTypes: ['Asset'] }),
		says: 'The API cannot change them.'
	},
	'default-cannot-be-cleared': {
		row: row('a', { programmaticName: 'sg_grade', displayName: 'Grade', dataType: 'list', validValues: ['a', 'b'] }),
		says: 'The API cannot clear a default.'
	},
	'cannot-be-emptied': { row: row('a', { programmaticName: 'sg_described', displayName: 'Described' }), says: 'The API refuses an empty value.' },
	'status-values-need-default': {
		row: row('a', { programmaticName: 'sg_state', displayName: 'State', dataType: 'status_list', validValues: ['fin'] }),
		says: 'A status list\'s valid values must include its default, "ip".'
	},
	'valid-type-not-on-site': {
		row: row('a', { dataType: 'entity', validTypes: ['asset'] }),
		says: 'This site has no entity type named "asset". "asset" is probably Asset.'
	},
	'valid-type-removed': {
		row: row('a', { programmaticName: 'sg_main_asset', displayName: 'Main asset', dataType: 'entity', validTypes: ['Shot'] }),
		says: 'Removing Asset retires the reverse field of this link on Asset.'
	}
};

describe('compareWithSite: every reason the planner can give needs attention, with the reason (PLN-7, PLN-8, PLN-14 to PLN-16)', () => {
	const cases = Object.entries(REASON_CASES).flatMap(([code, entry]) => ('row' in entry ? [[code as ReasonCode, entry] as const] : []));

	it.each(cases)('%s: needs attention, and the open row says why', (code, entry) => {
		const result = one(entry.row, site(entry.fields ?? { Shot: shotFields }));
		expect(result.category).toBe('needs_attention');
		expect(result.attention.length).toBeGreaterThan(0);
		// The planner agrees: it gives this reason for the same row and the same listing.
		if (code === 'incomplete' || code === 'type-not-on-site') {
			expect(result.planClass).toBeNull();
		} else {
			expect(result.reasons.map((reason) => reason.code)).toContain(code);
			expect(['refused', 'blocked', 'type-conflict']).toContain(result.planClass);
			expect(result.planClass).toBe(planned(entry.row, entry.fields));
			// Reason for reason: the comparison hands the planner a narrowed listing, and that changes nothing.
			expect(result.reasons).toEqual(plannedItem(entry.row, entry.fields)?.reasons);
		}
		const said = result.notes.map(explanationText).join(' ');
		expect(said).toContain(entry.says);
	});

	it.each(cases)('%s: is no longer marked on site or left unmarked', (_code, entry) => {
		const result = one(entry.row, site(entry.fields ?? { Shot: shotFields }));
		expect(result.markers).not.toContain('on_site');
		if (!isIncompleteCase(entry.row) && !result.typeNotOnSite) expect(result.markers.length).toBeGreaterThan(0);
	});

	it('two reasons cannot come from a cached listing, and say why', () => {
		const out = Object.entries(REASON_CASES).filter(([, entry]) => 'notFromAListing' in entry);
		expect(out.map(([code]) => code)).toEqual(['undeclared', 'no-data-type']);
	});

	it('a reason the CMP-9 table does not cover is shown in the planner\'s own words, as the install screen shows it', () => {
		const result = one(row('a', { programmaticName: 'sg_described', displayName: 'Described' }));
		expect(result.notes).toEqual([{ kind: 'plan', reason: result.reasons[0] }]);
		expect(explanationText(result.notes[0])).toBe(reasonText(result.reasons[0]));
		expect(explanationText(result.notes[0])).toBe(
			'"Described" (Shot.sg_described), description: "What it is for." on the site, none in the set. The API refuses an empty value. Clear it by hand in Flow PT, or fill it in the set.'
		);
	});

	it('the example of the audit: a blank description over a live one is not "On site"', () => {
		const result = one(row('a', { programmaticName: 'sg_described', displayName: 'Described', description: '  ' }));
		expect(result.category).toBe('needs_attention');
		expect(result.attention).toEqual(['cannot_update']);
		expect(result.markers).toEqual(['cannot_update']);
	});

	it('a create that would go wrong is marked "cannot create"', () => {
		const result = one(row('a', { dataType: 'status_list' }));
		expect(result.attention).toEqual(['cannot_create']);
		expect(result.markers).toEqual(['cannot_create']);
	});

	it('several reasons each get a note, in the plan\'s order, and each note has its own key', () => {
		const result = one(row('a', { programmaticName: 'sg_grade', displayName: 'Grade', dataType: 'list', validValues: [], description: null, uniquePerProject: false }));
		expect(result.reasons.map((reason) => `${reason.code}:${reason.setting}`)).toEqual(['default-cannot-be-cleared:defaultValue', 'cannot-be-emptied:validValues']);
		const keys = result.notes.map(explanationKey);
		expect(new Set(keys).size).toBe(keys.length);
	});
});

function isIncompleteCase(r: CompareRow): boolean {
	return [r.targetEntityType, r.programmaticName, r.displayName, r.dataType].some((value) => value.trim() === '');
}

describe('compareWithSite: the category is the plan\'s class (CMP-8, PLN-7)', () => {
	const table: [string, CompareRow, PlanClass, string][] = [
		['absent and creatable', row('a'), 'create', 'new'],
		['present and the same', row('a', { programmaticName: 'sg_lens', displayName: 'Lens' }), 'already-matches', 'on_site'],
		['present with a writable difference', row('a', { programmaticName: 'sg_lens', displayName: 'Lens 2' }), 'update', 'on_site'],
		['present with a blocked difference', row('a', { programmaticName: 'sg_serial', displayName: 'Serial' }), 'blocked', 'needs_attention'],
		['present with another type', row('a', { programmaticName: 'sg_frames', displayName: 'Frames' }), 'type-conflict', 'needs_attention'],
		['absent and refused', row('a', { programmaticName: 'sg_kit', displayName: 'Lens kit' }), 'refused', 'needs_attention']
	];

	it.each(table)('%s', (_name, r, planClass, category) => {
		const result = one(r);
		expect(planned(r)).toBe(planClass);
		expect(result.planClass).toBe(planClass);
		expect(result.category).toBe(category);
	});
});

describe('compareWithSite: category (CMP-8)', () => {
	it('CMP-8: name exists with the same type and nothing blocked is on site', () => {
		const result = one(row('a', { programmaticName: 'sg_lens', displayName: 'A new label' }));
		expect(result.category).toBe('on_site');
		expect(result.markers).toEqual(['on_site']);
		expect(result.attention).toEqual([]);
	});

	it('CMP-8: no live field with the name is new', () => {
		const result = one(row('a'));
		expect(result.category).toBe('new');
		expect(result.markers).toEqual([]);
		expect(result.planClass).toBe('create');
	});

	it('CMP-8: a different data type needs attention', () => {
		const result = one(row('a', { programmaticName: 'sg_frames' }));
		expect(result.category).toBe('needs_attention');
		expect(result.attention).toEqual(['type_mismatch']);
	});

	it('CMP-8: an incomplete entry needs attention first, even when it matches a live field', () => {
		const result = one(row('a', { programmaticName: 'sg_lens', displayName: ' ' }));
		expect(result.category).toBe('needs_attention');
		expect(result.attention).toEqual(['incomplete']);
		expect(result.nameExists).not.toBeNull();
		expect(result.markers).toEqual([]);
		expect(result.notes).toEqual([]);
		// The planner is not asked about a row that cannot be saved as it is.
		expect(result.planClass).toBeNull();
	});

	it('CMP-8: a duplicated entry needs attention', () => {
		const result = one(row('a', { programmaticName: 'sg_lens' }), site(), new Set(['a']));
		expect(result.category).toBe('needs_attention');
		expect(result.attention).toEqual(['duplicated']);
		expect(result.markers).toEqual([]);
	});

	it('CMP-8: a duplicated entry that the plan would refuse too keeps both reasons', () => {
		const result = one(row('a', { programmaticName: 'sg_kit', displayName: 'Lens kit' }), site(), new Set(['a']));
		expect(result.attention).toEqual(['duplicated', 'cannot_create']);
	});

	it('CMP-8: every reason is listed, in table order', () => {
		const result = one(row('a', { programmaticName: 'sg_frames', displayName: '' }), site(), new Set(['a']));
		expect(result.attention).toEqual(['incomplete', 'duplicated', 'type_mismatch']);
	});

	it('CMP-2: a type whose fields are not cached counts as having no fields, so its entries read as new', () => {
		const result = one(row('a', { targetEntityType: 'Asset', programmaticName: 'sg_lens' }), site({}));
		expect(result.category).toBe('new');
		expect(result.nameExists).toBeNull();
	});

	it('CMP-2: while a type\'s fields are not cached its rows are not judged: a stock name does not flash "cannot create"', () => {
		const result = one(row('a', { targetEntityType: 'Asset', programmaticName: 'code', displayName: 'Asset Name' }), site({}));
		expect(result).toMatchObject({ category: 'new', markers: [], notes: [], planClass: null, reasons: [] });
	});

	it('MOD-15: a mirror row is never planned: it is on site or new by its name alone', () => {
		const fields = [live('Shot', 'sg_total', 'summary', 'Total')];
		const there = one(row('a', { programmaticName: 'sg_total', displayName: 'Other label', dataType: 'summary' }), site({ Shot: fields }));
		expect(there).toMatchObject({ category: 'on_site', markers: ['on_site'], planClass: null });
		const other = one(row('a', { programmaticName: 'sg_total', dataType: 'pivot_column' }), site({ Shot: fields }));
		expect(other).toMatchObject({ category: 'needs_attention', attention: ['type_mismatch'], planClass: null });
		expect(one(row('a', { programmaticName: 'sg_else', dataType: 'summary' }), site({ Shot: fields }))).toMatchObject({ category: 'new', markers: [] });
	});
});

describe('compareWithSite: no site (CMP-3)', () => {
	it('CMP-3: no markers and every complete unique entry is new', () => {
		const result = one(row('a', { programmaticName: 'sg_frames', displayName: 'Lens' }), null);
		expect(result).toMatchObject({
			category: 'new',
			markers: [],
			notes: [],
			nameExists: null,
			labelTaken: null,
			planClass: null,
			reasons: [],
			typeNotOnSite: false
		});
	});

	it('CMP-3: with no site the planner is not asked, even for a create that would go wrong', () => {
		expect(one(row('a', { dataType: 'status_list' }), null).category).toBe('new');
	});

	it('CMP-3, EDT-13: incomplete and duplicated entries still need attention', () => {
		const comparison = compareWithSite({
			rows: [row('a', { dataType: '' }), row('b'), row('c')],
			duplicated: new Set(['b']),
			site: null
		});
		expect(['a', 'b', 'c'].map(comparison.categoryOf)).toEqual(['needs_attention', 'needs_attention', 'new']);
		expect(comparison.notOnSite).toEqual(new Set());
	});
});

describe('compareWithSite: type not on this site (CMP-10, Q1, PLN-14)', () => {
	it('CMP-10: a target type absent from the loaded list is marked, per row and per type', () => {
		const comparison = compareWithSite({
			rows: [row('a', { targetEntityType: 'CustomEntity19' }), row('b', { targetEntityType: ' CustomEntity19 ' }), row('c')],
			duplicated: new Set(),
			site: site()
		});
		expect(comparison.notOnSite).toEqual(new Set(['CustomEntity19']));
		expect(comparison.byKey.get('a')?.typeNotOnSite).toBe(true);
		expect(comparison.byKey.get('c')?.typeNotOnSite).toBe(false);
	});

	it('CMP-10: its entries need attention, since install refuses them (PLN-14)', () => {
		const result = one(row('a', { targetEntityType: 'CustomEntity19' }));
		expect(result.category).toBe('needs_attention');
		expect(result.attention).toEqual(['type_not_on_site']);
		expect(result.notes).toEqual([{ kind: 'type_not_on_site', entityType: 'CustomEntity19' }]);
	});

	it('CMP-10: the API name is matched exactly, case included', () => {
		expect(one(row('a', { targetEntityType: 'shot' })).typeNotOnSite).toBe(true);
	});

	it('CMP-10: fields cached for a type the list lacks are not compared', () => {
		const data = site({ CustomEntity19: [live('CustomEntity19', 'sg_field_a', 'text', 'Field a')] });
		expect(one(row('a', { targetEntityType: 'CustomEntity19' }), data).nameExists).toBeNull();
	});

	it('CMP-10: no marker while the type list is not loaded', () => {
		const data: SiteData = { entityTypes: null, fieldsOf: () => shotFields };
		const comparison = compareWithSite({ rows: [row('a', { programmaticName: 'sg_lens' })], duplicated: new Set(), site: data });
		expect(comparison.notOnSite).toEqual(new Set());
		expect(comparison.categoryOf('a')).toBe('on_site');
	});

	it('CMP-10: while the type list is not loaded no valid type is called unknown, and fields are still compared', () => {
		const data: SiteData = { entityTypes: null, fieldsOf: () => shotFields };
		const link = row('a', { dataType: 'entity', validTypes: ['Whatever'] });
		expect(compareWithSite({ rows: [link], duplicated: new Set(), site: data }).categoryOf('a')).toBe('new');
		const serial = row('b', { programmaticName: 'sg_serial', displayName: 'Serial' });
		expect(compareWithSite({ rows: [serial], duplicated: new Set(), site: data }).categoryOf('b')).toBe('needs_attention');
	});

	it('CMP-10: an entry with no target type is never marked', () => {
		const result = one(row('a', { targetEntityType: '' }));
		expect(result.typeNotOnSite).toBe(false);
		expect(result.attention).toEqual(['incomplete']);
	});
});

describe('compareWithSite: markers and notes (CMP-9, EDT-20)', () => {
	it('CMP-9: on site, same type explains the field exists', () => {
		const result = one(row('a', { programmaticName: 'sg_lens', displayName: 'Lens' }));
		expect(result.notes).toEqual([{ kind: 'on_site', fieldName: 'sg_lens' }]);
	});

	it('CMP-9: a different type names the live type and the wanted one', () => {
		const result = one(row('a', { programmaticName: 'sg_frames', displayName: 'Frames', dataType: 'float' }));
		expect(result.markers).toEqual(['type_mismatch']);
		expect(result.notes).toEqual([{ kind: 'type_mismatch', liveDataType: 'number', wantedDataType: 'float' }]);
	});

	// The two notes changed places: they follow the plan's order of differences now, valid types
	// before unique, as the install screen lists them.
	it('CMP-9: a blocked change shows cannot update, with a note per blocked setting, in the plan\'s order', () => {
		const fields = [live('Shot', 'sg_links', 'multi_entity', 'Links', { validTypes: ['Asset'], unique: true })];
		const result = one(row('a', { programmaticName: 'sg_links', displayName: 'Links', dataType: 'multi_entity', validTypes: ['Shot'] }), site({ Shot: fields }));
		expect(result.markers).toEqual(['cannot_update']);
		expect(result.notes).toEqual([
			{ kind: 'valid_types_differ', live: ['Asset'], wanted: ['Shot'] },
			{ kind: 'unique_differs', entityType: 'Shot', entityTypeLabel: 'Shot', fieldLabel: 'Links', turnOn: false }
		]);
	});

	it('CMP-9: the unique note names the type by its site display name', () => {
		const fields = [live('CustomEntity03', 'sg_serial', 'text', ' Serial ')];
		const result = one(
			row('a', { targetEntityType: 'CustomEntity03', programmaticName: 'sg_serial', displayName: 'Serial', uniquePerProject: true }),
			site({ CustomEntity03: fields })
		);
		expect(result.notes).toEqual([
			{ kind: 'unique_differs', entityType: 'CustomEntity03', entityTypeLabel: 'Camera', fieldLabel: 'Serial', turnOn: true }
		]);
	});

	// Was a type mismatch with a label taken beside it. A label is checked for a create only now
	// (PLN-16), so the two meet on a row that would be created under a name the site would not give.
	it('CMP-9: a label taken comes after the other notes and its marker last', () => {
		const result = one(row('a', { programmaticName: 'sg_dn', displayName: 'Director Notes' }));
		expect(result.markers).toEqual(['cannot_create', 'label_taken']);
		expect(result.reasons.map((reason) => reason.code)).toEqual(['unreachable-name', 'label-taken']);
		expect(result.notes.map((note) => note.kind)).toEqual(['plan', 'plan']);
	});
});

describe('explanationText (CMP-9, CMP-10)', () => {
	const cases: [Explanation, string[]][] = [
		[{ kind: 'on_site', fieldName: 'sg_lens' }, ['already exists', 'leave it', 'update it']],
		[{ kind: 'type_mismatch', liveDataType: 'number', wantedDataType: 'float' }, ['Number', 'Float', 'cannot be changed', 'skip']],
		[
			{ kind: 'unique_differs', entityType: 'Shot', entityTypeLabel: 'Shot', fieldLabel: 'Serial', turnOn: true },
			['API cannot change', 'Shot page', 'Serial column', 'turn it on']
		],
		[
			{ kind: 'unique_differs', entityType: 'Shot', entityTypeLabel: 'Shot', fieldLabel: 'Serial', turnOn: false },
			['turn it off']
		],
		[
			{ kind: 'valid_types_differ', live: ['Asset'], wanted: ['Shot'] },
			['Asset', 'Shot', 'API cannot change', 'skip', 'delete the field', 'trash for good']
		],
		[{ kind: 'valid_types_differ', live: [], wanted: ['Shot'] }, ['no type']],
		[{ kind: 'type_not_on_site', entityType: 'CustomEntity19' }, ['CustomEntity19', 'admin', 're-check']]
	];

	it.each(cases)('CMP-9: %o says what the table requires', (explanation, parts) => {
		const text = explanationText(explanation);
		for (const part of parts) expect(text).toContain(part);
	});

	it.each(cases)('Copy: %o has no dashes', (explanation) => {
		expect(explanationText(explanation)).not.toMatch(/[–—]| - /);
	});

	// The label-taken case left this table: its words are the planner's now (PLN-16), tested with
	// the reasons above and in plan-reason.test.ts.
	it('CMP-6: a label taken names the field that has it, in the planner\'s words', () => {
		const result = one(row('a', { programmaticName: 'sg_director_notes', displayName: 'Director Notes' }));
		expect(explanationText(result.notes[0])).toContain('Shot.sg_notes_label already has the display name');
		expect(explanationText(result.notes[0])).toContain('suffix');
	});
});

describe('compareWithSite: speed (CMP-11)', () => {
	it('CMP-11: 500 rows against 12 types of 300 live fields each computes well under a frame', () => {
		const typeNames = Array.from({ length: 12 }, (_, i) => `CustomEntity${i + 1}`);
		const entityTypes = typeNames.map((name) => ({ name, displayName: name, custom: true }));
		const fieldsByType = new Map(
			typeNames.map((type) => [
				type,
				Array.from({ length: 300 }, (_, i) => live(type, `sg_f${i}`, i % 2 ? 'text' : 'number', `Field ${i}`))
			])
		);
		const rows = Array.from({ length: 500 }, (_, i) =>
			row(`r${i}`, { targetEntityType: typeNames[i % 12], programmaticName: `sg_f${i % 400}`, displayName: `Field ${(i * 7) % 300}` })
		);
		const input = { rows, duplicated: new Set<string>(), site: { entityTypes, fieldsOf: (type: string) => fieldsByType.get(type) ?? null } };
		let best = Infinity;
		for (let run = 0; run < 5; run++) {
			const start = performance.now();
			compareWithSite(input);
			best = Math.min(best, performance.now() - start);
		}
		expect(best).toBeLessThan(8);
	});

	it('CMP-11: 500 rows that would all be created on one type of 300 live fields: the planner checks each label', () => {
		const entityTypes = [{ name: 'Shot', displayName: 'Shot', custom: false }];
		const fields = Array.from({ length: 300 }, (_, i) => live('Shot', `sg_f${i}`, 'text', `Field ${i}`));
		const rows = Array.from({ length: 500 }, (_, i) => row(`r${i}`, { programmaticName: `sg_new_field_${i}`, displayName: `New field ${i}` }));
		const input = { rows, duplicated: new Set<string>(), site: { entityTypes, fieldsOf: () => fields } };
		expect(compareWithSite(input).categoryOf('r0')).toBe('new');
		let best = Infinity;
		for (let run = 0; run < 5; run++) {
			const start = performance.now();
			compareWithSite(input);
			best = Math.min(best, performance.now() - start);
		}
		expect(best).toBeLessThan(8);
	});
});
