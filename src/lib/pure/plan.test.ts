import { describe, expect, it } from 'vitest';
import { CREATABLE_DATA_TYPES } from './data-types';
import { predictFieldName } from './field-name';
import listing from './fixtures/live-version-fields.json';
import schema from './fixtures/live-schema.json';
import { readEntityTypes } from './live-entity-types';
import { readField, readFieldReply, readFields, type LiveField, type LiveFieldRead } from './live-field';
import {
	PLAN_CLASSES,
	PlanInputError,
	emptyPlanText,
	hasNonAscii,
	needsRead,
	planEntry,
	planSet,
	serverFieldName,
	type CreatePayload,
	type PlanEntry,
	type PlanItem,
	type PlanSite,
	type PropertyWrite
} from './plan';

/* Fixtures. */

const entityTypes = readEntityTypes(schema.data);
const versionFields = readFields('Version', listing.data);

const site: PlanSite = {
	siteUrl: 'https://studio.shotgrid.autodesk.com',
	trashPageUrl: 'https://studio.shotgrid.autodesk.com/page/1234',
	entityTypes,
	fieldsByType: new Map([['Version', versionFields]])
};

const ABSENT: LiveFieldRead = {
	kind: 'absent',
	reason: 'does-not-exist',
	message: "Field 'Version.sg_lens' does not exist."
};

let nextId = 0;
function entry(overrides: Partial<PlanEntry> = {}): PlanEntry {
	nextId += 1;
	return {
		id: `e${nextId}`,
		targetEntityType: 'Version',
		programmaticName: 'sg_lens',
		displayName: 'Lens',
		dataType: 'text',
		validTypes: [],
		validValues: [],
		defaultValue: null,
		description: null,
		uniquePerProject: false,
		...overrides
	};
}

/** A field's record as `GET /schema/<Type>/fields/<field>` sends it (corpus finding 116). */
function record(settings: {
	dataType: string;
	name: string;
	description?: string;
	unique?: boolean;
	defaultValue?: unknown;
	validValues?: string[];
	validTypes?: string[];
}): Record<string, unknown> {
	const properties: Record<string, unknown> = {
		default_value: { value: settings.defaultValue ?? null, editable: true },
		summary_default: { value: 'none', editable: true }
	};
	if (settings.validValues) properties['valid_values'] = { value: settings.validValues, editable: true };
	if (settings.validTypes) properties['valid_types'] = { value: settings.validTypes, editable: settings.dataType === 'entity' };
	return {
		name: { value: settings.name, editable: true },
		description: { value: settings.description ?? '', editable: true },
		data_type: { value: settings.dataType, editable: false },
		unique: { value: settings.unique ?? false, editable: false },
		visible: { value: true, editable: true },
		properties
	};
}

function liveField(settings: Parameters<typeof record>[0], name = 'sg_lens'): LiveField {
	const field = readField('Version', name, record(settings));
	if (!field) throw new Error('fixture has no data type');
	return field;
}

function present(settings: Parameters<typeof record>[0], name = 'sg_lens'): LiveFieldRead {
	return { kind: 'present', field: liveField(settings, name) };
}

function plan(e: PlanEntry, read: LiveFieldRead | null, at: PlanSite = site): PlanItem {
	const item = planEntry(e, read, at);
	if (!item) throw new Error('a mirror was not planned');
	return item;
}

const writes = (item: PlanItem): PropertyWrite[] => (item.update?.requests ?? []).map((request) => request.properties[0]);

/* The site, as finding 116 measured it. */

/** The field the site reports after a create, or a throw where the site refuses. */
function siteCreate(name: string, payload: CreatePayload): LiveField {
	const value = (property: string) => payload.properties.find((write) => write.property_name === property)?.value;
	const type = payload.data_type;
	if (type === 'color' || type === 'image') throw new Error('data_type is not valid');
	if (type === 'status_list' && value('valid_values') === undefined) throw new Error("missing required 'properties' [\"valid_values\"]");
	if (type === 'checkbox' && typeof value('default_value') !== 'boolean') throw new Error('Only true or false allowed in checkbox');
	if (type === 'entity' || type === 'multi_entity') {
		const types = value('valid_types');
		if (!Array.isArray(types) || types.length === 0) throw new Error("missing required 'properties'");
		if (type === 'multi_entity' && types.length !== 1) throw new Error("'valid_types' value expected Array with one element");
	}
	for (const write of payload.properties) {
		if (write.value === '' || (Array.isArray(write.value) && write.value.length === 0)) throw new Error('value must be filled');
	}
	return liveField(
		{
			dataType: type,
			name: value('name') as string,
			description: value('description') as string | undefined,
			unique: value('unique') === true,
			defaultValue: value('default_value'),
			validValues: value('valid_values') as string[] | undefined,
			validTypes: value('valid_types') as string[] | undefined
		},
		name
	);
}

/** The field after one update request, or a throw where the site refuses. */
function sitePut(field: LiveField, write: PropertyWrite): LiveField {
	const { property_name: property, value } = write;
	if (value === '' || (Array.isArray(value) && value.length === 0)) throw new Error('value must be filled');
	switch (property) {
		case 'name':
			return { ...field, displayName: value as string };
		case 'description':
			return { ...field, description: value as string };
		case 'unique':
			throw new Error("invalid property 'unique'");
		case 'valid_types':
			if (field.dataType !== 'entity') throw new Error("can't update 'valid_types' on this field");
			return { ...field, validTypes: value as string[] };
		case 'valid_values': {
			if (field.dataType !== 'list' && field.dataType !== 'status_list') throw new Error("invalid property 'valid_values'");
			const values = value as string[];
			if (field.dataType === 'status_list' && typeof field.defaultValue === 'string' && !values.includes(field.defaultValue)) {
				throw new Error("'valid_values' must include the 'default_value'");
			}
			return { ...field, validValues: values };
		}
		case 'default_value':
			if (field.dataType === 'checkbox') {
				if (typeof value !== 'boolean') throw new Error('a checkbox default sent as text is stored as text');
				return { ...field, defaultValue: value };
			}
			if (field.dataType !== 'list' && field.dataType !== 'status_list') throw new Error('default value is read-only');
			if (!field.validValues.includes(value as string)) throw new Error("'default_value' not in valid_values");
			return { ...field, defaultValue: value };
	}
}

/* Tests. */

describe('serverFieldName', () => {
	it('MOD-17: follows the ASCII rule measured by finding 117', () => {
		expect(serverFieldName('zzprobe 117 a--b..c!!d  e_f', 'currency')).toBe('sg_zzprobe_117_a__b__c__d__e_f');
		expect(serverFieldName('117 zzprobe digit', 'currency')).toBe('sg_117_zzprobe_digit');
		expect(serverFieldName('zzprobe 117 MiXed CASE', 'currency')).toBe('sg_zzprobe_117_mixed_case');
		expect(serverFieldName('sg_zzprobe_019_already_prefixed', 'text')).toBe('sg_sg_zzprobe_019_already_prefixed');
	});

	it('G11: any non-ASCII character anywhere gives sg_<data_type> (finding 117)', () => {
		expect(serverFieldName('zzprobe 117 Durée Écran ñ', 'currency')).toBe('sg_currency');
		expect(serverFieldName('zzprobe 117 日本語 поле', 'currency')).toBe('sg_currency');
		expect(serverFieldName('Durée', 'text')).toBe('sg_text');
	});

	it('MOD-19: a blank display name has no name', () => {
		expect(serverFieldName('  ', 'text')).toBeNull();
	});

	it('hasNonAscii: true for an accent, a non-Latin letter or an emoji; false for ASCII punctuation', () => {
		for (const text of ['é', 'Lens ñ', '日本語', 'поле', 'a😀', 'a\u00a0b']) expect(hasNonAscii(text)).toBe(true);
		for (const text of ['', 'Lens -- Height (Start)', 'a\tb', '~!@#$%^&*()_+']) expect(hasNonAscii(text)).toBe(false);
	});
});

describe('needsRead', () => {
	it('PLN-3: a complete, creatable entry on a type the site has', () => {
		expect(needsRead(entry(), entityTypes)).toBe(true);
	});

	it('PLN-10, PLN-14: not a mirror, an incomplete entry or a type the site lacks', () => {
		expect(needsRead(entry({ dataType: 'calculated' }), entityTypes)).toBe(false);
		expect(needsRead(entry({ displayName: ' ' }), entityTypes)).toBe(false);
		expect(needsRead(entry({ targetEntityType: 'CustomEntity99' }), entityTypes)).toBe(false);
	});
});

describe('planEntry: create', () => {
	it('PLN-7: an absent field is a create', () => {
		const item = plan(entry(), ABSENT);
		expect(item).toMatchObject({
			class: 'create',
			entityType: 'Version',
			programmaticName: 'sg_lens',
			displayName: 'Lens',
			dataType: 'text',
			refusal: null,
			liveDataType: null,
			differences: [],
			blocked: [],
			reasons: [],
			update: null
		});
		expect(item.create).toEqual({ data_type: 'text', properties: [{ property_name: 'name', value: 'Lens' }] });
	});

	it('PLN-13, G8: carries every setting in the one request, spelled as the corpus cards spell them', () => {
		const item = plan(
			entry({
				dataType: 'list',
				description: ' Which lens. ',
				validValues: ['alpha', 'beta', 'gamma'],
				defaultValue: 'beta'
			}),
			ABSENT
		);
		expect(item.create).toEqual({
			data_type: 'list',
			properties: [
				{ property_name: 'name', value: 'Lens' },
				{ property_name: 'description', value: 'Which lens.' },
				{ property_name: 'valid_values', value: ['alpha', 'beta', 'gamma'] },
				{ property_name: 'default_value', value: 'beta' }
			]
		});
	});

	it('PLN-13: unique is sent only when on, description only when not blank', () => {
		expect(plan(entry({ uniquePerProject: true, description: '  ' }), ABSENT).create?.properties).toEqual([
			{ property_name: 'name', value: 'Lens' },
			{ property_name: 'unique', value: true }
		]);
	});

	it('PLN-13: a checkbox always sends a boolean default, true only for exactly true', () => {
		const sent = (defaultValue: PlanEntry['defaultValue']) =>
			plan(entry({ dataType: 'checkbox', defaultValue }), ABSENT).create?.properties.find(
				(write) => write.property_name === 'default_value'
			)?.value;
		expect(sent(true)).toBe(true);
		expect(sent(false)).toBe(false);
		expect(sent(null)).toBe(false);
		expect(sent('true')).toBe(false);
	});

	it('PLN-13: valid types are sent for a link; an entity link takes several (G4)', () => {
		expect(plan(entry({ dataType: 'entity', validTypes: ['Shot', 'Asset'] }), ABSENT).create?.properties).toEqual([
			{ property_name: 'name', value: 'Lens' },
			{ property_name: 'valid_types', value: ['Shot', 'Asset'] }
		]);
		expect(plan(entry({ dataType: 'multi_entity', validTypes: ['Shot'] }), ABSENT).class).toBe('create');
	});

	it('PLN-12, MOD-9: a setting the type does not carry is never sent', () => {
		const item = plan(entry({ dataType: 'date', validValues: ['a'], validTypes: ['Shot'], defaultValue: 'a', uniquePerProject: true }), ABSENT);
		expect(item.create).toEqual({ data_type: 'date', properties: [{ property_name: 'name', value: 'Lens' }] });
	});

	it('G3: currency, timecode and footage create with a name alone; a status list with its values', () => {
		for (const dataType of ['currency', 'timecode', 'footage']) {
			expect(plan(entry({ dataType }), ABSENT).create).toEqual({ data_type: dataType, properties: [{ property_name: 'name', value: 'Lens' }] });
		}
		expect(plan(entry({ dataType: 'status_list', validValues: ['na', 'rev', 'vwd'], defaultValue: 'rev' }), ABSENT).create).toEqual({
			data_type: 'status_list',
			properties: [
				{ property_name: 'name', value: 'Lens' },
				{ property_name: 'valid_values', value: ['na', 'rev', 'vwd'] },
				{ property_name: 'default_value', value: 'rev' }
			]
		});
	});
});

describe('planEntry: refusals', () => {
	const refusal = (item: PlanItem) => {
		expect(item.class).toBe('refused');
		expect(item.create).toBeNull();
		expect(item.update).toBeNull();
		expect(item.reasons.length).toBeGreaterThan(0);
		expect(item.reasons[0].code).toBe(item.refusal);
		return item.reasons.map((reason) => reason.code);
	};

	it('PLN-14: the target type is absent from the site; no read is needed', () => {
		const item = plan(entry({ targetEntityType: 'CustomEntity99' }), null);
		expect(refusal(item)).toEqual(['type-not-on-site']);
	});

	it('PLN-2: an incomplete entry is refused, never created', () => {
		expect(refusal(plan(entry({ displayName: '  ' }), ABSENT))).toEqual(['incomplete']);
		expect(refusal(plan(entry({ dataType: '' }), null))).toEqual(['incomplete']);
	});

	it('PLN-15: the name the site would derive differs from the entry name', () => {
		const item = plan(entry({ displayName: 'Lens Height', programmaticName: 'sg_lensheight' }), ABSENT);
		expect(refusal(item)).toEqual(['unreachable-name']);
		expect(item.reasons[0].other).toBe('sg_lens_height');
	});

	it('PLN-15, B1: punctuation is one underscore each, so a collapsed name is unreachable', () => {
		const display = 'Lens -- Height (Start)';
		expect(refusal(plan(entry({ displayName: display, programmaticName: 'sg_lens_height_start' }), ABSENT))).toEqual(['unreachable-name']);
		expect(plan(entry({ displayName: display, programmaticName: 'sg_lens____height__start_' }), ABSENT).class).toBe('create');
	});

	it('PLN-15, MOD-18: a display name that starts with the prefix needs the doubled prefix', () => {
		expect(refusal(plan(entry({ displayName: 'sg_lens', programmaticName: 'sg_lens' }), ABSENT))).toEqual(['unreachable-name']);
		expect(plan(entry({ displayName: 'sg_lens', programmaticName: 'sg_sg_lens' }), ABSENT).class).toBe('create');
	});

	it('PLN-15, G11: a non-ASCII display name is refused, with the name the site would give', () => {
		const item = plan(entry({ displayName: 'Durée', programmaticName: 'sg_dur_e', dataType: 'currency' }), ABSENT);
		expect(refusal(item)).toEqual(['non-ascii-name']);
		expect(item.reasons[0].other).toBe('sg_currency');
	});

	it('PLN-15, G11: refused as a trap even when the entry asks for sg_<data_type>', () => {
		const item = plan(entry({ displayName: 'Monnaie é', programmaticName: 'sg_currency', dataType: 'currency' }), ABSENT);
		expect(refusal(item)).toEqual(['non-ascii-name']);
	});

	it('PLN-16: a different live field has the display name, trimmed and without case', () => {
		// The fixture's sg_ai_seed reads "ai seed " with a trailing space.
		const item = plan(entry({ displayName: 'AI Seed', programmaticName: 'sg_ai_seed' }), ABSENT, {
			...site,
			fieldsByType: new Map([['Version', versionFields.map((field) => (field.name === 'sg_ai_seed' ? { ...field, name: 'sg_ai_seed_1' } : field))]])
		});
		expect(refusal(item)).toEqual(['label-taken']);
		expect(item.reasons[0].other).toBe('sg_ai_seed_1');
	});

	it('PLN-16: a create with a free label is not refused', () => {
		expect(plan(entry({ displayName: 'zz free label', programmaticName: 'sg_zz_free_label' }), ABSENT).class).toBe('create');
	});

	it('PLN-3: the name answers but the schema does not declare it: refused, never created', () => {
		const read = readFieldReply('Version', 'sg_lens', { status: 'undeclared' });
		expect(refusal(plan(entry(), read))).toEqual(['undeclared']);
	});

	it('PLN-4: a record with no data type holds the name: refused, never created', () => {
		const read = readFieldReply('Version', 'sg_lens', { status: 'found', raw: { name: { value: 'Lens' } } });
		expect(read).toMatchObject({ kind: 'absent', reason: 'no-data-type' });
		expect(refusal(plan(entry(), read))).toEqual(['no-data-type']);
	});

	it('G3: a status list with no valid values', () => {
		expect(refusal(plan(entry({ dataType: 'status_list' }), ABSENT))).toEqual(['status-list-needs-values']);
	});

	it('G4, MOD-11: an entity link with no valid type', () => {
		expect(refusal(plan(entry({ dataType: 'entity' }), ABSENT))).toEqual(['entity-needs-valid-types']);
	});

	it('G4, MOD-11: a multi-entity link with none or several valid types', () => {
		expect(refusal(plan(entry({ dataType: 'multi_entity' }), ABSENT))).toEqual(['multi-entity-needs-one-valid-type']);
		expect(refusal(plan(entry({ dataType: 'multi_entity', validTypes: ['Shot', 'Asset'] }), ABSENT))).toEqual([
			'multi-entity-needs-one-valid-type'
		]);
	});

	it('a default that is missing from the valid values', () => {
		expect(refusal(plan(entry({ dataType: 'list', validValues: ['a'], defaultValue: 'zzz' }), ABSENT))).toEqual(['default-not-in-values']);
		expect(refusal(plan(entry({ dataType: 'list', defaultValue: 'zzz' }), ABSENT))).toEqual(['default-not-in-values']);
	});

	it('lists every reason, the name first', () => {
		const item = plan(entry({ displayName: 'Étape', programmaticName: 'sg_etape', dataType: 'status_list' }), ABSENT);
		expect(refusal(item)).toEqual(['non-ascii-name', 'status-list-needs-values']);
	});

	it('PLN-3: a missing read or listing is an error, never "absent"', () => {
		expect(() => planEntry(entry(), null, site)).toThrow(PlanInputError);
		expect(() => planEntry(entry(), ABSENT, { ...site, fieldsByType: new Map() })).toThrow(PlanInputError);
	});
});

describe('planEntry: present fields', () => {
	it('PLN-7: another live data type is a type conflict, whatever else differs', () => {
		const item = plan(entry({ dataType: 'number', uniquePerProject: true }), present({ dataType: 'text', name: 'Other' }));
		expect(item).toMatchObject({ class: 'type-conflict', liveDataType: 'text', dataType: 'number', create: null, update: null });
		expect(item.reasons.map((reason) => reason.code)).toEqual(['type-conflict']);
	});

	it('PLN-7: no difference is already matches', () => {
		const item = plan(entry({ description: 'Which lens.' }), present({ dataType: 'text', name: 'Lens', description: 'Which lens.' }));
		expect(item).toMatchObject({ class: 'already-matches', differences: [], blocked: [], reasons: [], create: null, update: null });
	});

	it('PLN-7: writable differences are an update, one property per request', () => {
		const item = plan(entry({ displayName: 'Lens B', description: 'New.' }), present({ dataType: 'text', name: 'Lens', description: 'Old.' }));
		expect(item.class).toBe('update');
		expect(item.differences.map((difference) => difference.setting)).toEqual(['displayName', 'description']);
		expect(item.update).toEqual({
			requests: [
				{ properties: [{ property_name: 'name', value: 'Lens B' }] },
				{ properties: [{ property_name: 'description', value: 'New.' }] }
			]
		});
		expect(item.reasons).toEqual([]);
	});

	it('PLN-8, G5: list values, an entity link valid types and a default are plain updates', () => {
		expect(
			writes(plan(entry({ dataType: 'list', validValues: ['a', 'b'] }), present({ dataType: 'list', name: 'Lens', validValues: ['a'] })))
		).toEqual([{ property_name: 'valid_values', value: ['a', 'b'] }]);
		expect(
			writes(
				plan(entry({ dataType: 'entity', validTypes: ['Shot', 'Asset'] }), present({ dataType: 'entity', name: 'Lens', validTypes: ['Shot'] }))
			)
		).toEqual([{ property_name: 'valid_types', value: ['Shot', 'Asset'] }]);
		expect(
			writes(
				plan(
					entry({ dataType: 'list', validValues: ['a', 'b'], defaultValue: 'b' }),
					present({ dataType: 'list', name: 'Lens', validValues: ['a', 'b'], defaultValue: 'a' })
				)
			)
		).toEqual([{ property_name: 'default_value', value: 'b' }]);
	});

	it('G5: a checkbox default is written as a boolean, also over one stored as text', () => {
		expect(writes(plan(entry({ dataType: 'checkbox', defaultValue: true }), present({ dataType: 'checkbox', name: 'Lens', defaultValue: false })))).toEqual([
			{ property_name: 'default_value', value: true }
		]);
		expect(writes(plan(entry({ dataType: 'checkbox', defaultValue: null }), present({ dataType: 'checkbox', name: 'Lens', defaultValue: 'false' })))).toEqual([
			{ property_name: 'default_value', value: false }
		]);
	});

	it('a list writes its values before a default that is one of the new values', () => {
		const item = plan(
			entry({ dataType: 'list', validValues: ['b', 'c'], defaultValue: 'c' }),
			present({ dataType: 'list', name: 'Lens', validValues: ['a', 'b'], defaultValue: 'a' })
		);
		expect(writes(item)).toEqual([
			{ property_name: 'valid_values', value: ['b', 'c'] },
			{ property_name: 'default_value', value: 'c' }
		]);
	});

	describe('status list: the values must include the default in force (finding 116)', () => {
		const status = (validValues: string[], defaultValue: string | null) => entry({ dataType: 'status_list', validValues, defaultValue });
		const liveStatus = (validValues: string[], defaultValue: string | null) =>
			present({ dataType: 'status_list', name: 'Lens', validValues, defaultValue });

		it('the new default is already a live value: default first, then the values', () => {
			expect(writes(plan(status(['rev', 'vwd'], 'rev'), liveStatus(['na', 'rev'], 'na')))).toEqual([
				{ property_name: 'default_value', value: 'rev' },
				{ property_name: 'valid_values', value: ['rev', 'vwd'] }
			]);
		});

		it('the new default is a new value and the old one stays valid: values first', () => {
			expect(writes(plan(status(['na', 'vwd'], 'vwd'), liveStatus(['na', 'rev'], 'na')))).toEqual([
				{ property_name: 'valid_values', value: ['na', 'vwd'] },
				{ property_name: 'default_value', value: 'vwd' }
			]);
		});

		it('no live default: values first', () => {
			expect(writes(plan(status(['vwd'], 'vwd'), liveStatus(['na', 'rev'], null)))).toEqual([
				{ property_name: 'valid_values', value: ['vwd'] },
				{ property_name: 'default_value', value: 'vwd' }
			]);
		});

		it('neither order works: the old default is kept as a value until the new default is in', () => {
			expect(writes(plan(status(['vwd', 'fin'], 'vwd'), liveStatus(['na', 'rev'], 'na')))).toEqual([
				{ property_name: 'valid_values', value: ['vwd', 'fin', 'na'] },
				{ property_name: 'default_value', value: 'vwd' },
				{ property_name: 'valid_values', value: ['vwd', 'fin'] }
			]);
		});

		it('values that drop the default without changing it are blocked', () => {
			const item = plan(status(['rev'], 'na'), liveStatus(['na', 'rev'], 'na'));
			expect(item.class).toBe('blocked');
			expect(item.blocked).toEqual([{ setting: 'validValues', live: ['na', 'rev'], wanted: ['rev'], why: 'status-values-need-default' }]);
			expect(item.reasons[0]).toMatchObject({ code: 'status-values-need-default', other: 'na' });
		});

		it('values that drop a default the entry cannot clear are blocked with it', () => {
			const item = plan(status(['rev'], null), liveStatus(['na', 'rev'], 'na'));
			expect(item.class).toBe('blocked');
			expect(item.blocked.map((difference) => [difference.setting, difference.why])).toEqual([
				['defaultValue', 'default-cannot-be-cleared'],
				['validValues', 'status-values-need-default']
			]);
			expect(item.differences).toEqual([]);
		});
	});

	describe('blocked', () => {
		it('PLN-8: the unique flag, on any type', () => {
			const item = plan(entry({ uniquePerProject: true }), present({ dataType: 'text', name: 'Lens' }));
			expect(item.class).toBe('blocked');
			expect(item.blocked).toEqual([{ setting: 'unique', live: false, wanted: true, why: 'unique-cannot-change' }]);
			expect(plan(entry({ dataType: 'list' }), present({ dataType: 'list', name: 'Lens', unique: true })).class).toBe('blocked');
		});

		it('PLN-8: valid types on a multi-entity link, with the trash page', () => {
			const item = plan(
				entry({ dataType: 'multi_entity', validTypes: ['Asset'] }),
				present({ dataType: 'multi_entity', name: 'Lens', validTypes: ['Shot'] })
			);
			expect(item.class).toBe('blocked');
			expect(item.reasons[0]).toMatchObject({
				code: 'multi-entity-valid-types',
				setting: 'validTypes',
				live: ['Shot'],
				wanted: ['Asset'],
				needsTrash: true,
				trashPageUrl: site.trashPageUrl
			});
		});

		it('PLN-9: keeps the blocked and the fine differences apart, and writes neither', () => {
			const item = plan(
				entry({ displayName: 'Lens B', description: 'New.', uniquePerProject: true }),
				present({ dataType: 'text', name: 'Lens', description: 'Old.' })
			);
			expect(item.class).toBe('blocked');
			expect(item.blocked.map((difference) => difference.setting)).toEqual(['unique']);
			expect(item.differences.map((difference) => difference.setting)).toEqual(['displayName', 'description']);
			expect(item.update).toBeNull();
			expect(item.create).toBeNull();
			expect(item.reasons).toHaveLength(1);
		});

		it('G5: a default cannot be cleared, on a list or a status list', () => {
			for (const dataType of ['list', 'status_list']) {
				const item = plan(entry({ dataType, validValues: ['a', 'b'] }), present({ dataType, name: 'Lens', validValues: ['a', 'b'], defaultValue: 'a' }));
				expect(item.class).toBe('blocked');
				expect(item.blocked).toEqual([{ setting: 'defaultValue', live: 'a', wanted: null, why: 'default-cannot-be-cleared' }]);
			}
		});

		it('G5: a default that is missing from the valid values is never planned as a write', () => {
			const item = plan(
				entry({ dataType: 'list', validValues: ['a', 'b'], defaultValue: 'zzz' }),
				present({ dataType: 'list', name: 'Lens', validValues: ['a', 'b'], defaultValue: 'a' })
			);
			expect(item.class).toBe('blocked');
			expect(item.blocked.map((difference) => difference.why)).toEqual(['default-not-in-values']);
		});

		it('an empty value is never planned as a write: description, valid values, valid types', () => {
			const description = plan(entry(), present({ dataType: 'text', name: 'Lens', description: 'Old.' }));
			expect(description.blocked).toEqual([{ setting: 'description', live: 'Old.', wanted: null, why: 'cannot-be-emptied' }]);
			const values = plan(entry({ dataType: 'list' }), present({ dataType: 'list', name: 'Lens', validValues: ['a'] }));
			expect(values.blocked.map((difference) => [difference.setting, difference.why])).toEqual([['validValues', 'cannot-be-emptied']]);
			const types = plan(entry({ dataType: 'entity' }), present({ dataType: 'entity', name: 'Lens', validTypes: ['Shot'] }));
			expect(types.blocked.map((difference) => [difference.setting, difference.why])).toEqual([['validTypes', 'cannot-be-emptied']]);
		});

		it('a reason for every blocked difference, in difference order', () => {
			const item = plan(entry({ uniquePerProject: true }), present({ dataType: 'text', name: 'Lens', description: 'Old.' }));
			expect(item.reasons.map((reason) => [reason.code, reason.setting])).toEqual([
				['cannot-be-emptied', 'description'],
				['unique-cannot-change', 'unique']
			]);
		});
	});

	it('reads the live fixture: an entry that describes a live field already matches', () => {
		const field = versionFields.find((candidate) => candidate.name === 'sg_ai_generated_from')!;
		const item = plan(
			entry({
				programmaticName: 'sg_ai_generated_from',
				displayName: 'AI Generated From',
				dataType: 'multi_entity',
				validTypes: ['Version'],
				description: 'The versions this one was generated from.'
			}),
			{ kind: 'present', field }
		);
		expect(item.class).toBe('already-matches');
	});
});

describe('planSet', () => {
	const scope = { kind: 'chosen' as const, projects: [{ id: 70, name: 'Sandbox' }] };

	it('PLN-7, RUN-6: one item per entry, in the order given, each with one class', () => {
		const entries = [
			entry({ id: 'match' }),
			entry({ id: 'create', programmaticName: 'sg_new', displayName: 'New' }),
			entry({ id: 'conflict', programmaticName: 'sg_num', displayName: 'Num', dataType: 'number' }),
			entry({ id: 'update', programmaticName: 'sg_upd', displayName: 'Upd B' }),
			entry({ id: 'blocked', programmaticName: 'sg_blk', displayName: 'Blk', uniquePerProject: true }),
			entry({ id: 'refused', targetEntityType: 'CustomEntity99' })
		];
		const reads = new Map<string, LiveFieldRead>([
			['match', present({ dataType: 'text', name: 'Lens' })],
			['create', ABSENT],
			['conflict', present({ dataType: 'text', name: 'Num' }, 'sg_num')],
			['update', present({ dataType: 'text', name: 'Upd' }, 'sg_upd')],
			['blocked', present({ dataType: 'text', name: 'Blk' }, 'sg_blk')]
		]);
		const result = planSet({ ...site, entries, reads, scope });
		expect(result.items.map((item) => [item.entryId, item.class])).toEqual([
			['match', 'already-matches'],
			['create', 'create'],
			['conflict', 'type-conflict'],
			['update', 'update'],
			['blocked', 'blocked'],
			['refused', 'refused']
		]);
		expect(result.counts).toEqual({ 'type-conflict': 1, refused: 1, blocked: 1, create: 1, update: 1, 'already-matches': 1 });
		expect(Object.keys(result.counts).sort()).toEqual([...PLAN_CLASSES].sort());
		expect(result.empty).toBeNull();
		expect(emptyPlanText(result)).toBeNull();
	});

	it('PLN-17: carries the site and the scope through', () => {
		const result = planSet({ ...site, entries: [], reads: new Map(), scope });
		expect(result.siteUrl).toBe(site.siteUrl);
		expect(result.scope).toEqual(scope);
	});

	it('PLN-10, B4: a mirror entry is left out, even when its field is absent', () => {
		const entries = [entry({ id: 'mirror', dataType: 'calculated' }), entry({ id: 'kept' })];
		const result = planSet({ ...site, entries, reads: new Map([['mirror', ABSENT], ['kept', ABSENT]]), scope });
		expect(result.items.map((item) => item.entryId)).toEqual(['kept']);
		expect(result.mirrorsLeftOut).toBe(1);
		expect(planEntry(entries[0], ABSENT, site)).toBeNull();
	});

	it('PLN-10: only mirror entries give an empty plan that says why', () => {
		const entries = [entry({ dataType: 'calculated' }), entry({ dataType: 'color', programmaticName: 'sg_c' })];
		const result = planSet({ ...site, entries, reads: new Map(), scope });
		expect(result.items).toEqual([]);
		expect(result.empty).toBe('only-mirrors');
		expect(result.mirrorsLeftOut).toBe(2);
		expect(emptyPlanText(result)).toBe('Nothing to install. The selected fields have data types the API cannot create.');
		expect(result.counts.create).toBe(0);
	});

	it('PLN-1: no entries give an empty plan that says so', () => {
		const result = planSet({ ...site, entries: [], reads: new Map(), scope });
		expect(result.empty).toBe('no-entries');
		expect(emptyPlanText(result)).toBe('Nothing to install. No field is selected.');
	});

	it('PLN-3: an entry with no read is an error', () => {
		expect(() => planSet({ ...site, entries: [entry()], reads: new Map(), scope })).toThrow(PlanInputError);
	});

	it('PLN-19: alters nothing it is given', () => {
		const entries = [entry({ id: 'a', displayName: ' Lens ' })];
		const before = structuredClone(entries);
		planSet({ ...site, entries, reads: new Map([['a', ABSENT]]), scope });
		expect(entries).toEqual(before);
	});
});

/* PLN-20: plan, apply as the site would, plan again. */

/** A range of entries per creatable type: every setting the type carries, set and unset. */
function variants(dataType: string): PlanEntry[] {
	const names = ['Lens', 'Lens -- Height (Start)', '9 lives_x'];
	const base = names.map((displayName) => entry({ dataType, displayName, programmaticName: predictFieldName(displayName)! }));
	const each = (settings: Partial<PlanEntry>[]) => base.flatMap((one) => settings.map((more) => ({ ...one, ...more, id: `${one.id}.${JSON.stringify(more)}` })));
	const described: Partial<PlanEntry>[] = [{}, { description: 'What it is for.' }];
	switch (dataType) {
		case 'text':
		case 'number':
			return each(described.flatMap((more) => [more, { ...more, uniquePerProject: true }]));
		case 'checkbox':
			return each(described.flatMap((more) => [more, { ...more, defaultValue: true }, { ...more, defaultValue: false }]));
		case 'list':
			return each([
				{},
				{ validValues: ['alpha', 'beta', 'gamma'] },
				{ validValues: ['gamma', 'beta'], defaultValue: 'beta', description: 'Pick one.' },
				{ validValues: ['alpha', 'beta', 'gamma'], defaultValue: 'alpha' },
				{ validValues: ['delta'], defaultValue: 'delta' }
			]);
		case 'status_list':
			return each([
				{ validValues: ['na', 'rev', 'vwd'] },
				{ validValues: ['na', 'rev'], defaultValue: 'na' },
				{ validValues: ['rev', 'na', 'vwd'], defaultValue: 'rev', description: 'Where it stands.' },
				{ validValues: ['vwd', 'fin'], defaultValue: 'vwd' },
				{ validValues: ['fin', 'na'], defaultValue: 'fin' }
			]);
		case 'entity':
			return each([{ validTypes: ['Shot'] }, { validTypes: ['Shot', 'Asset'] }, { validTypes: ['Asset', 'Shot'], description: 'Source.' }]);
		case 'multi_entity':
			return each([{ validTypes: ['Shot'] }, { validTypes: ['Version'], description: 'Source.' }]);
		default:
			return each(described);
	}
}

describe('PLN-20: idempotency', () => {
	const replan = (e: PlanEntry, field: LiveField) => plan(e, { kind: 'present', field });

	it('after a create, the entry already matches, for every creatable type and setting', () => {
		let checked = 0;
		for (const dataType of CREATABLE_DATA_TYPES) {
			for (const wanted of variants(dataType)) {
				const first = plan(wanted, ABSENT);
				expect(first.class, `${dataType} ${wanted.id}`).toBe('create');
				const created = siteCreate(wanted.programmaticName, first.create!);
				// The name the site derives is the one the entry asked for (PLN-15).
				expect(serverFieldName(created.displayName, dataType)).toBe(wanted.programmaticName);
				expect(replan(wanted, created).class, `${dataType} ${wanted.id}`).toBe('already-matches');
				checked += 1;
			}
		}
		expect(checked).toBeGreaterThan(100);
	});

	it('after an update, sent in order to a site that refuses what finding 116 saw refused, the entry already matches', () => {
		const classes = { update: 0, blocked: 0, 'already-matches': 0 };
		for (const dataType of CREATABLE_DATA_TYPES) {
			const all = variants(dataType);
			for (const from of all) {
				const live = siteCreate(from.programmaticName, plan(from, ABSENT).create!);
				for (const to of all) {
					// The same field, wanted another way. The second variant may rename it.
					const wanted = { ...to, programmaticName: from.programmaticName };
					const item = replan(wanted, live);
					const label = `${dataType}: ${from.id} -> ${to.id}`;
					expect(['update', 'blocked', 'already-matches'], label).toContain(item.class);
					classes[item.class as keyof typeof classes] += 1;
					if (item.class === 'blocked') {
						expect(item.update, label).toBeNull();
						expect(item.reasons.length, label).toBe(item.blocked.length);
						continue;
					}
					if (item.class !== 'update') continue;
					expect(item.update!.requests.length, label).toBeGreaterThan(0);
					let field = live;
					for (const request of item.update!.requests) {
						expect(request.properties, label).toHaveLength(1);
						// Throws where the site would refuse: a wrong order fails here.
						field = sitePut(field, request.properties[0]);
					}
					expect(replan(wanted, field).class, label).toBe('already-matches');
				}
			}
		}
		expect(classes.update).toBeGreaterThan(100);
		expect(classes.blocked).toBeGreaterThan(20);
	});

	it('a blocked entry stays blocked: nothing was written', () => {
		const wanted = entry({ uniquePerProject: true });
		const live = liveField({ dataType: 'text', name: 'Lens' });
		expect(replan(wanted, live).class).toBe('blocked');
		expect(replan(wanted, live)).toEqual(replan(wanted, live));
	});
});
