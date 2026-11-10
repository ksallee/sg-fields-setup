import { describe, expect, it } from 'vitest';
import notFound from './fixtures/live-field-not-found.json';
import statusList from './fixtures/live-field-status-list.json';
import typeNotFound from './fixtures/live-type-not-found.json';
import listing from './fixtures/live-version-fields.json';
import { isCustomField, isFieldMissing, readField, readFieldReply, readFields, splitFields, type LiveField } from './live-field';

const fields = readFields('Version', listing.data);
const byName = (name: string): LiveField => {
	const found = fields.find((field) => field.name === name);
	if (!found) throw new Error(`no ${name} in the fixture`);
	return found;
};

describe('readField', () => {
	it('unwraps one record: every value is read out of its {value, editable} pair (PLN-6)', () => {
		const field = readField('Version', 'sg_status_list', statusList.data);
		expect(field).toEqual({
			entityType: 'Version',
			name: 'sg_status_list',
			dataType: 'status_list',
			displayName: 'Status',
			description: '',
			defaultValue: 'rev',
			validValues: statusList.data.properties.valid_values.value,
			validTypes: [],
			unique: false,
			hideable: false,
			raw: statusList.data
		});
	});

	it('reads description and unique beside the data type (PLN-6)', () => {
		expect(byName('sg_ai_generated_from').description).toBe('The versions this one was generated from.');
		expect(byName('sg_ai_seed').unique).toBe(true);
		expect(byName('code').unique).toBe(false);
	});

	it('reads default value, valid values and valid types among the properties (PLN-6)', () => {
		expect(byName('sg_version_type').defaultValue).toBe('Type A');
		expect(byName('sg_version_type').validValues).toEqual(['Type A', 'Type B', 'Type C']);
		expect(byName('entity').validTypes).toEqual(['Asset', 'Shot', 'Sequence', 'CustomEntity29', 'CustomEntity19']);
		expect(byName('sg_ai_generated_from').validTypes).toEqual(['Version']);
	});

	it('reads none for what a record does not carry: no default is null, no list is empty (PLN-11)', () => {
		const code = byName('code');
		expect(code.defaultValue).toBeNull();
		expect(code.validValues).toEqual([]);
		expect(code.validTypes).toEqual([]);
	});

	it('keeps a default of false: it is a value, not none (PLN-13)', () => {
		expect(byName('sg_ai_approved').defaultValue).toBe(false);
	});

	it('reads a missing unique flag as off (PLN-6)', () => {
		const { unique: _unique, ...rest } = statusList.data;
		expect(readField('Version', 'sg_status_list', rest)?.unique).toBe(false);
	});

	it('keeps the data type exactly as read, known to the app or not (MOD-16, IMP-30)', () => {
		const record = { ...statusList.data, data_type: { value: 'some_future_type', editable: false } };
		expect(readField('Version', 'x', record)?.dataType).toBe('some_future_type');
	});

	it('keeps the display name as read; comparing trims (CMP-6)', () => {
		expect(byName('sg_ai_seed').displayName).toBe('ai seed ');
	});

	it('keeps the raw record verbatim, the same object, for snapshots (W2, IMP-30)', () => {
		expect(readField('Version', 'sg_status_list', statusList.data)?.raw).toBe(statusList.data);
	});

	it('reads a record with no usable data type as no field (PLN-4, MOD-16)', () => {
		const { data_type: _dataType, ...rest } = statusList.data;
		expect(readField('Version', 'x', rest)).toBeNull();
		expect(readField('Version', 'x', { ...rest, data_type: { value: '', editable: false } })).toBeNull();
		expect(readField('Version', 'x', { ...rest, data_type: { value: '  ', editable: false } })).toBeNull();
		expect(readField('Version', 'x', { ...rest, data_type: { value: null, editable: false } })).toBeNull();
		expect(readField('Version', 'x', null)).toBeNull();
		expect(readField('Version', 'x', 'text')).toBeNull();
	});

	it('reads defensively: a wrong shape is none, never a throw', () => {
		const field = readField('Version', 'x', {
			name: { value: 7 },
			data_type: { value: 'list' },
			description: { value: null },
			unique: { value: 'yes' },
			properties: { valid_values: { value: 'Type A' }, valid_types: { value: ['Shot', 3, null] } }
		});
		expect(field).toMatchObject({
			displayName: '',
			description: '',
			defaultValue: null,
			validValues: [],
			validTypes: ['Shot'],
			unique: false,
			hideable: null
		});
	});

	it('reads a value that came bare, without its wrapper', () => {
		const field = readField('Version', 'x', { name: 'Bare', data_type: 'text', unique: true, properties: { default_value: 'a' } });
		expect(field).toMatchObject({ displayName: 'Bare', dataType: 'text', unique: true, defaultValue: 'a' });
	});
});

describe('readFields', () => {
	it('maps the listing to live fields, named by their key, in the listing order (CMP-2, IMP-29)', () => {
		expect(fields.map((field) => field.name)).toEqual(Object.keys(listing.data));
		expect(fields.every((field) => field.entityType === 'Version')).toBe(true);
	});

	it('leaves out a field with no data type, as the one-field read does (PLN-4)', () => {
		const data = { code: listing.data.code, broken: { name: { value: 'Broken', editable: true } } };
		expect(readFields('Version', data).map((field) => field.name)).toEqual(['code']);
	});

	it('reads a listing that is not an object as no fields', () => {
		expect(readFields('Version', null)).toEqual([]);
		expect(readFields('Version', [])).toEqual([]);
	});
});

describe('stock versus custom', () => {
	it('follows whether the site may hide the field, not the name prefix (EDT-21, B6, corpus 056)', () => {
		expect(isCustomField(byName('sg_ai_steps'))).toBe(true);
		// Named sg_ and stock.
		expect(isCustomField(byName('sg_status_list'))).toBe(false);
		expect(isCustomField(byName('sg_uploaded_movie'))).toBe(false);
		// Custom under a generated name: the reverse side of a custom link.
		expect(isCustomField(byName('version_sg_ai_generated_from_versions'))).toBe(true);
	});

	it('counts a field with no visible entry as stock', () => {
		const { visible: _visible, ...rest } = statusList.data;
		const field = readField('Version', 'x', rest);
		expect(field?.hideable).toBeNull();
		expect(field && isCustomField(field)).toBe(false);
	});

	it('splits into custom and stock, each sorted by display name, trimmed and without case (EDT-21)', () => {
		const { custom, stock } = splitFields(fields);
		expect(custom.map((field) => field.displayName)).toEqual([
			'AI Approved',
			'AI Generated From',
			'AI Generated From <-> Version',
			'ai seed ',
			'AI Steps',
			'Platform Status'
		]);
		expect(stock.map((field) => field.displayName)).toEqual(['Flagged', 'Link', 'Status', 'Task', 'Type', 'Uploaded Movie', 'Version Name']);
	});

	it('orders fields that share a display name by programmatic name', () => {
		const twin = (name: string): LiveField => ({ ...byName('sg_ai_steps'), name });
		expect(splitFields([twin('sg_b_1'), twin('sg_b')]).custom.map((field) => field.name)).toEqual(['sg_b', 'sg_b_1']);
	});

	it('does not reorder the list it was given', () => {
		const before = fields.map((field) => field.name);
		splitFields(fields);
		expect(fields.map((field) => field.name)).toEqual(before);
	});
});

describe('isFieldMissing', () => {
	it('knows the one refusal that means the field does not exist (PLN-3)', () => {
		expect(isFieldMissing(404, notFound.errors[0].detail)).toBe(true);
	});

	it('does not take any other refusal for it (PLN-3)', () => {
		expect(isFieldMissing(404, typeNotFound.errors[0].detail)).toBe(false);
		expect(isFieldMissing(404, null)).toBe(false);
		expect(isFieldMissing(404, 'Not Found')).toBe(false);
		expect(isFieldMissing(400, notFound.errors[0].detail)).toBe(false);
		expect(isFieldMissing(500, notFound.errors[0].detail)).toBe(false);
	});
});

describe('readFieldReply', () => {
	it('answers present with the field (PLN-3)', () => {
		const read = readFieldReply('Version', 'sg_status_list', { status: 'found', raw: statusList.data });
		expect(read.kind).toBe('present');
		expect(read.kind === 'present' && read.field.dataType).toBe('status_list');
	});

	it('answers absent for a field that does not exist, with what the site said (PLN-3, PLN-5)', () => {
		expect(readFieldReply('Version', 'sg_not_a_field', { status: 'missing', message: notFound.errors[0].detail })).toEqual({
			kind: 'absent',
			reason: 'does-not-exist',
			message: "Field 'Version.sg_not_a_field' does not exist."
		});
	});

	it('answers absent for a record with no usable data type (PLN-4)', () => {
		const read = readFieldReply('Version', 'x', { status: 'found', raw: { name: { value: 'X', editable: true } } });
		expect(read).toMatchObject({ kind: 'absent', reason: 'no-data-type' });
	});

	it('answers absent for a field the schema does not declare, the 200 with no data (PLN-4, corpus get_schema_type_fields_field)', () => {
		expect(readFieldReply('Note', 'read_by_current_user', { status: 'undeclared' })).toMatchObject({ kind: 'absent', reason: 'undeclared' });
	});
});
