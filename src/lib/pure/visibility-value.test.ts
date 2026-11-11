import { describe, expect, it } from 'vitest';
import listing from './fixtures/live-version-fields.json';
import { readVisibility, readVisibilityListing, visibleWrite } from './visibility-value';

// Shapes from corpus findings/115_field_visibility_per_project.
describe('readVisibility', () => {
	it('reads the value and whether it may be changed', () => {
		expect(readVisibility({ visible: { value: false, editable: true } })).toEqual({ visible: false, editable: true });
		expect(readVisibility({ visible: { value: true, editable: false } })).toEqual({ visible: true, editable: false });
	});

	it('VIS-7: a missing visible value means visible', () => {
		expect(readVisibility({})).toEqual({ visible: true, editable: null });
		expect(readVisibility({ visible: null })).toEqual({ visible: true, editable: null });
		expect(readVisibility({ visible: { editable: true } })).toEqual({ visible: true, editable: true });
		expect(readVisibility({ visible: { value: null, editable: true } })).toEqual({ visible: true, editable: true });
	});

	it('takes a value that came bare', () => {
		expect(readVisibility({ visible: false })).toEqual({ visible: false, editable: null });
	});

	it('answers null for something that is not a record', () => {
		expect(readVisibility(null)).toBeNull();
		expect(readVisibility('visible')).toBeNull();
		expect(readVisibility([])).toBeNull();
	});
});

describe('readVisibilityListing', () => {
	it('VIS-8: reads every field of a listing in one go', () => {
		const fields = readVisibilityListing(listing.data);
		expect(fields.size).toBe(Object.keys(listing.data).length);
		expect(fields.get('sg_uploaded_movie')).toEqual({ visible: true, editable: false });
	});

	it('reads hidden fields, which the listing still returns', () => {
		const fields = readVisibilityListing({
			sg_a: { visible: { value: false, editable: true } },
			sg_b: { visible: { value: true, editable: true } },
			sg_c: 'not a record'
		});
		expect([...fields]).toEqual([
			['sg_a', { visible: false, editable: true }],
			['sg_b', { visible: true, editable: true }]
		]);
	});

	it('reads anything that is not an object as no fields', () => {
		expect(readVisibilityListing(null).size).toBe(0);
		expect(readVisibilityListing([]).size).toBe(0);
	});
});

describe('visibleWrite', () => {
	it('is the one property the measured write sends', () => {
		expect(visibleWrite(false)).toEqual([{ property_name: 'visible', value: false }]);
		expect(visibleWrite(true)).toEqual([{ property_name: 'visible', value: true }]);
	});
});
