import { describe, expect, it } from 'vitest';
import { asRefusal, isRetiredNameRefusal, readRevive, retiredNameIn } from './run-port';

describe('asRefusal', () => {
	it('reads any thrown value with a numeric status as the site refusing, class or not', () => {
		const error = Object.assign(new Error('No.'), { status: 403, source: { a: 1 } });
		expect(asRefusal(error)).toEqual({ status: 403, message: 'No.', source: { a: 1 } });
		expect(asRefusal({ status: 500, message: 'Shotgun Server Error' })).toMatchObject({ status: 500, message: 'Shotgun Server Error' });
	});

	it('RUN-17: reads anything without a status as no answer', () => {
		expect(asRefusal(new TypeError('Failed to fetch'))).toBeNull();
		expect(asRefusal({ status: '500', message: 'x' })).toBeNull();
		expect(asRefusal('boom')).toBeNull();
		expect(asRefusal(null)).toBeNull();
	});
});

describe('the retired-name refusal (corpus finding 119)', () => {
	const said = 'there is a retired field with the same field_name: sg_lens';
	const title = `API schema_field_create() failed, ${said}. Delete the retired field forever from the Trash Page in Shotgun and try again.`;

	it('is known by source.field_name, and names the programmatic name', () => {
		const refusal = { status: 400, message: 'Something else.', source: { field_name: said } };
		expect(isRetiredNameRefusal(refusal)).toBe(true);
		expect(retiredNameIn(refusal)).toBe('sg_lens');
	});

	it('is known by its words when a proxy dropped the source', () => {
		const refusal = { status: 400, message: title, source: null };
		expect(isRetiredNameRefusal(refusal)).toBe(true);
		expect(retiredNameIn(refusal)).toBe('sg_lens');
	});

	it('is no other create refusal', () => {
		const refusal = { status: 400, message: `API schema_field_create() missing required 'properties' ["valid_values"]`, source: { data_type: ['x'] } };
		expect(isRetiredNameRefusal(refusal)).toBe(false);
		expect(retiredNameIn(refusal)).toBeNull();
	});
});

describe('readRevive (corpus finding 119)', () => {
	it('reads the three measured answers', () => {
		expect(readRevive({ revived: true }, 'sg_lens')).toBe('revived');
		expect(readRevive({ revived: false, status: 404, message: 'Retired field Version.sg_lens does not exist.' }, 'sg_lens')).toBe('nothing-retired');
		expect(readRevive({ revived: false, status: 400, message: 'Field Version.sg_lens is not retired.' }, 'sg_lens')).toBe('already-live');
	});

	it('takes the type as the server spells it', () => {
		expect(readRevive({ revived: false, status: 404, message: 'Retired field custom_entity03.sg_lens does not exist.' }, 'sg_lens')).toBe(
			'nothing-retired'
		);
	});

	it.each([
		[404, 'Not Found'],
		[404, "Entity type 'Version' does not exist."],
		[404, "Field 'Version.sg_lens' does not exist."],
		[404, 'Retired field Version.sg_other does not exist.'],
		[400, 'Retired field Version.sg_lens does not exist.'],
		[403, 'Retired field Version.sg_lens does not exist.'],
		[400, "revive is missing"],
		[404, ''],
		[500, 'Shotgun Server Error']
	])('reads %i "%s" as unknown: nothing to build a create on', (status, message) => {
		expect(readRevive({ revived: false, status, message }, 'sg_lens')).toBe('unknown');
	});
});
