import { describe, expect, it } from 'vitest';
import {
	compareWithSite,
	explanationText,
	type CompareRow,
	type Explanation,
	type SiteData
} from './compare';
import { readEntityTypes } from './live-entity-types';
import { readField, type LiveField } from './live-field';

/** A field record shaped as `GET /schema/<Type>/fields` sends it: every value wrapped. */
function record(
	dataType: string,
	displayName: string,
	options: { unique?: boolean; validTypes?: string[] } = {}
): Record<string, unknown> {
	return {
		data_type: { value: dataType, editable: false },
		name: { value: displayName, editable: true },
		description: { value: '', editable: true },
		unique: { value: options.unique ?? false, editable: false },
		visible: { value: true, editable: true },
		properties: {
			default_value: { value: null, editable: false },
			valid_types: { value: options.validTypes ?? null, editable: dataType !== 'multi_entity' }
		}
	};
}

function live(entityType: string, name: string, dataType: string, displayName: string, options = {}): LiveField {
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
	live('Shot', 'sg_notes_label', 'text', ' Director Notes ')
];

function site(fields: Record<string, readonly LiveField[] | null> = { Shot: shotFields }): SiteData {
	return { entityTypes: types, fieldsOf: (type) => fields[type] ?? null };
}

function row(key: string, patch: Partial<CompareRow> = {}): CompareRow {
	return {
		key,
		targetEntityType: 'Shot',
		programmaticName: `sg_${key}`,
		displayName: `Field ${key}`,
		dataType: 'text',
		validTypes: [],
		uniquePerProject: false,
		...patch
	};
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

describe('compareWithSite: label taken (CMP-6)', () => {
	it('CMP-6: another field with the same display name, trimmed and without case, is named', () => {
		const result = one(row('a', { programmaticName: 'sg_director_notes', displayName: 'director notes  ' }));
		expect(result.labelTaken).toEqual({ fieldName: 'sg_notes_label', displayName: ' Director Notes ' });
	});

	it('CMP-6: the field that has the same programmatic name does not count', () => {
		expect(one(row('a', { programmaticName: 'sg_lens', displayName: 'Lens' })).labelTaken).toBeNull();
	});

	it('CMP-6: a field with the same programmatic name is skipped and another with the label is found', () => {
		const fields = [live('Shot', 'sg_lens', 'text', 'Lens'), live('Shot', 'sg_lens_1', 'text', 'Lens')];
		const result = one(row('a', { programmaticName: 'sg_lens', displayName: 'Lens' }), site({ Shot: fields }));
		expect(result.labelTaken?.fieldName).toBe('sg_lens_1');
	});

	it('CMP-6: a blank display name takes no label', () => {
		const fields = [live('Shot', 'sg_blank', 'text', '')];
		expect(one(row('a', { displayName: ' ' }), site({ Shot: fields })).labelTaken).toBeNull();
	});

	it('CMP-6, CMP-8: a label taken is a note and does not change the category', () => {
		const result = one(row('a', { programmaticName: 'sg_lens_2', displayName: 'Lens' }));
		expect(result.category).toBe('new');
		expect(result.markers).toEqual(['label_taken']);
	});
});

describe('compareWithSite: blocked change (CMP-7, PLN-8)', () => {
	it('CMP-7: the unique flag differs on a text field', () => {
		const result = one(row('a', { programmaticName: 'sg_serial', displayName: 'Serial' }));
		expect(result.blocked).toEqual({ unique: { live: true, wanted: false }, validTypes: null });
		expect(result.category).toBe('needs_attention');
	});

	it('CMP-7: asking for unique on a field that is not unique is blocked too', () => {
		const result = one(row('a', { programmaticName: 'sg_lens', displayName: 'Lens', uniquePerProject: true }));
		expect(result.blocked?.unique).toEqual({ live: false, wanted: true });
	});

	it('PLN-8, MOD-9: a unique flag on a type that does not carry it is read as off, as the planner reads the cleaned entry', () => {
		const result = one(
			row('a', { programmaticName: 'sg_cameras', dataType: 'multi_entity', validTypes: ['CustomEntity03'], uniquePerProject: true })
		);
		expect(result.blocked).toBeNull();
		expect(result.category).toBe('on_site');
	});

	it('CMP-7: multi-entity valid types that differ are blocked', () => {
		const result = one(row('a', { programmaticName: 'sg_cameras', dataType: 'multi_entity', validTypes: ['Asset'] }));
		expect(result.blocked).toEqual({ unique: null, validTypes: { live: ['CustomEntity03'], wanted: ['Asset'] } });
		expect(result.category).toBe('needs_attention');
	});

	it('CMP-7: valid types are compared as ordered lists', () => {
		const fields = [live('Shot', 'sg_links', 'multi_entity', 'Links', { validTypes: ['Asset', 'Shot'] })];
		const swapped = row('a', { programmaticName: 'sg_links', dataType: 'multi_entity', validTypes: ['Shot', 'Asset'] });
		expect(one(swapped, site({ Shot: fields })).blocked?.validTypes).not.toBeNull();
		const same = row('a', { programmaticName: 'sg_links', dataType: 'multi_entity', validTypes: [' Asset', 'Shot', ''] });
		expect(one(same, site({ Shot: fields })).blocked).toBeNull();
	});

	it('PLN-8: valid types on a single-entity link are updatable, so never blocked', () => {
		const result = one(row('a', { programmaticName: 'sg_main_asset', dataType: 'entity', validTypes: ['Shot'] }));
		expect(result.blocked).toBeNull();
		expect(result.category).toBe('on_site');
	});

	it('CMP-7: a blocked change needs the same data type', () => {
		const result = one(row('a', { programmaticName: 'sg_serial', dataType: 'number' }));
		expect(result.blocked).toBeNull();
		expect(result.markers).toEqual(['type_mismatch']);
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
	});

	it('CMP-8: a duplicated entry needs attention', () => {
		const result = one(row('a', { programmaticName: 'sg_lens' }), site(), new Set(['a']));
		expect(result.category).toBe('needs_attention');
		expect(result.attention).toEqual(['duplicated']);
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
			blocked: null,
			typeNotOnSite: false
		});
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
		const data = site({ CustomEntity19: [live('CustomEntity19', 'sg_a', 'text', 'Field a')] });
		expect(one(row('a', { targetEntityType: 'CustomEntity19' }), data).nameExists).toBeNull();
	});

	it('CMP-10: no marker while the type list is not loaded', () => {
		const data: SiteData = { entityTypes: null, fieldsOf: () => shotFields };
		const comparison = compareWithSite({ rows: [row('a', { programmaticName: 'sg_lens' })], duplicated: new Set(), site: data });
		expect(comparison.notOnSite).toEqual(new Set());
		expect(comparison.categoryOf('a')).toBe('on_site');
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

	it('CMP-9: a blocked change shows cannot update, with a note per blocked setting', () => {
		const fields = [live('Shot', 'sg_links', 'multi_entity', 'Links', { validTypes: ['Asset'], unique: true })];
		const result = one(row('a', { programmaticName: 'sg_links', displayName: 'Links', dataType: 'multi_entity', validTypes: ['Shot'] }), site({ Shot: fields }));
		expect(result.markers).toEqual(['cannot_update']);
		expect(result.notes).toEqual([
			{ kind: 'unique_differs', entityType: 'Shot', entityTypeLabel: 'Shot', fieldLabel: 'Links', turnOn: false },
			{ kind: 'valid_types_differ', live: ['Asset'], wanted: ['Shot'] }
		]);
	});

	it('CMP-9: the unique note names the type by its site display name', () => {
		const fields = [live('CustomEntity03', 'sg_serial', 'text', ' Serial ')];
		const result = one(
			row('a', { targetEntityType: 'CustomEntity03', programmaticName: 'sg_serial', uniquePerProject: true }),
			site({ CustomEntity03: fields })
		);
		expect(result.notes).toEqual([
			{ kind: 'unique_differs', entityType: 'CustomEntity03', entityTypeLabel: 'Camera', fieldLabel: 'Serial', turnOn: true }
		]);
	});

	it('CMP-9: a label taken comes after the other notes and its marker last', () => {
		const fields = [live('Shot', 'sg_x', 'number', 'X'), live('Shot', 'sg_x_1', 'text', 'Spare')];
		const result = one(row('a', { programmaticName: 'sg_x', displayName: 'spare' }), site({ Shot: fields }));
		expect(result.markers).toEqual(['type_mismatch', 'label_taken']);
		expect(result.notes.map((note) => note.kind)).toEqual(['type_mismatch', 'label_taken']);
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
		[{ kind: 'label_taken', fieldName: 'sg_notes_label', displayName: ' Director Notes ' }, ['sg_notes_label', 'suffix']],
		[{ kind: 'type_not_on_site', entityType: 'CustomEntity19' }, ['CustomEntity19', 'admin', 're-check']]
	];

	it.each(cases)('CMP-9: %o says what the table requires', (explanation, parts) => {
		const text = explanationText(explanation);
		for (const part of parts) expect(text).toContain(part);
	});

	it.each(cases)('Copy: %o has no dashes', (explanation) => {
		expect(explanationText(explanation)).not.toMatch(/[–—]| - /);
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
});
