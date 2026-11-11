import { describe, expect, it } from 'vitest';
import listing from './fixtures/live-schema.json';
import { entityTypeDisplayName, hasEntityType, isCustomEntityName, readEntityTypes } from './live-entity-types';

const types = readEntityTypes(listing.data);

describe('readEntityTypes', () => {
	it('reads every type of the listing, in the listing order, with the display name unwrapped (CMP-1, IMP-21)', () => {
		expect(types.map((type) => type.name)).toEqual(Object.keys(listing.data));
		expect(types[0]).toEqual({ name: 'ActionMenuItem', displayName: 'Action Menu Item', custom: false });
	});

	it('trims a display name, since a site may store a trailing space (IMP-21, corpus 008)', () => {
		expect(types.find((type) => type.name === 'CustomEntity66')?.displayName).toBe('Camera Rig');
	});

	it('marks the custom entity slots, and not their connection types (corpus 008)', () => {
		expect(types.filter((type) => type.custom).map((type) => type.name)).toEqual([
			'CustomEntity01',
			'CustomEntity29',
			'CustomEntity66',
			'CustomNonProjectEntity01'
		]);
	});

	it('falls back to the API name when a type carries no display name (EDT-17)', () => {
		expect(readEntityTypes({ Shot: {}, Asset: { name: { value: '  ', editable: false } }, Task: null })).toEqual([
			{ name: 'Shot', displayName: 'Shot', custom: false },
			{ name: 'Asset', displayName: 'Asset', custom: false },
			{ name: 'Task', displayName: 'Task', custom: false }
		]);
	});

	it('reads a listing that is not an object as no types', () => {
		expect(readEntityTypes(null)).toEqual([]);
		expect(readEntityTypes([])).toEqual([]);
		expect(readEntityTypes('x')).toEqual([]);
	});
});

describe('isCustomEntityName', () => {
	it('knows the three slot families by name (corpus field_types/entity_type)', () => {
		expect(isCustomEntityName('CustomEntity19')).toBe(true);
		expect(isCustomEntityName('CustomNonProjectEntity01')).toBe(true);
		expect(isCustomEntityName('CustomThreadedEntity03')).toBe(true);
		expect(isCustomEntityName('CustomEntity29_sg_scene_Connection')).toBe(false);
		expect(isCustomEntityName('Version')).toBe(false);
	});
});

describe('lookups', () => {
	it('gives the display name for an API name, and null for a type the site does not have (EDT-17, CMP-10)', () => {
		expect(entityTypeDisplayName(types, 'CustomEntity01')).toBe('Lens');
		expect(entityTypeDisplayName(types, 'CustomEntity08')).toBeNull();
	});

	it('tells whether a type is on the site: presence in the listing is the test (CMP-10, PLN-14)', () => {
		expect(hasEntityType(types, 'CustomEntity29')).toBe(true);
		expect(hasEntityType(types, 'CustomEntity08')).toBe(false);
		expect(hasEntityType(types, 'version')).toBe(false);
	});
});
