import { describe, expect, it } from 'vitest';
import statusList from './fixtures/live-field-status-list.json';
import { makeLiveField } from './fixtures/make-live-field';
import { readField, type LiveField } from './live-field';
import {
	definitionFromLiveField,
	draftFromLiveField,
	findLiveField,
	liveDefaultValue,
	resyncDefinition,
	resyncRows,
	snapshotFromLiveField
} from './live-to-entry';
import type { EntryDefinition } from './model';

const SITE = 'https://studio.shotgrid.autodesk.com';

const lensType = makeLiveField('Shot', 'sg_lens_type', {
	displayName: '  Lens Type ',
	dataType: 'list',
	description: ' Which lens. ',
	defaultValue: 'Spherical',
	validValues: ['Spherical', 'Anamorphic'],
	unique: false
});

describe('liveDefaultValue (IMP-30, MOD-10)', () => {
	it('a checkbox default is a boolean', () => {
		expect(liveDefaultValue(makeLiveField('Shot', 'sg_x', { dataType: 'checkbox', defaultValue: true }))).toBe(true);
		expect(liveDefaultValue(makeLiveField('Shot', 'sg_x', { dataType: 'checkbox', defaultValue: false }))).toBe(false);
	});

	it('a list or status list default is text', () => {
		expect(liveDefaultValue(lensType)).toBe('Spherical');
		expect(liveDefaultValue(makeLiveField('Shot', 'sg_s', { dataType: 'status_list', defaultValue: 'wtg' }))).toBe('wtg');
	});

	it('a default of another kind is dropped, never coerced', () => {
		expect(liveDefaultValue(makeLiveField('Shot', 'sg_x', { dataType: 'checkbox', defaultValue: 'true' }))).toBeNull();
		expect(liveDefaultValue(makeLiveField('Shot', 'sg_x', { dataType: 'list', defaultValue: 3 }))).toBeNull();
		expect(liveDefaultValue(makeLiveField('Shot', 'sg_x', { dataType: 'list', defaultValue: '  ' }))).toBeNull();
	});

	it('a type that carries no default has none', () => {
		expect(liveDefaultValue(makeLiveField('Shot', 'sg_x', { dataType: 'number', defaultValue: 5 }))).toBeNull();
		expect(liveDefaultValue(makeLiveField('Shot', 'sg_x', { dataType: 'text', defaultValue: 'x' }))).toBeNull();
	});

	it('no default is none', () => {
		expect(liveDefaultValue(makeLiveField('Shot', 'sg_x', { dataType: 'checkbox' }))).toBeNull();
	});
});

describe('definitionFromLiveField (IMP-30)', () => {
	it('IMP-30: mirrors the live field, display name trimmed as the site has it (Q8)', () => {
		expect(definitionFromLiveField(lensType)).toEqual({
			targetEntityType: 'Shot',
			programmaticName: 'sg_lens_type',
			displayName: 'Lens Type',
			dataType: 'list',
			validTypes: [],
			validValues: ['Spherical', 'Anamorphic'],
			defaultValue: 'Spherical',
			description: 'Which lens.',
			uniquePerProject: false
		});
	});

	it('MOD-14, MOD-16: keeps a data type exactly as read, mirror or unknown', () => {
		expect(definitionFromLiveField(makeLiveField('Shot', 'sg_c', { dataType: 'calculated' })).dataType).toBe('calculated');
		expect(definitionFromLiveField(makeLiveField('Shot', 'sg_n', { dataType: 'never_heard_of' })).dataType).toBe('never_heard_of');
	});

	it('IMP-30: copies valid types, the unique flag, and drops a blank description', () => {
		const link = makeLiveField('Shot', 'sg_lens', { displayName: 'Lens', dataType: 'entity', validTypes: ['CustomEntity19'] });
		const code = makeLiveField('Shot', 'sg_slate_id', { displayName: 'Slate ID', unique: true, description: '   ' });
		expect(definitionFromLiveField(link).validTypes).toEqual(['CustomEntity19']);
		expect(definitionFromLiveField(code).uniquePerProject).toBe(true);
		expect(definitionFromLiveField(code).description).toBeNull();
	});

	it('shares no list with the live field', () => {
		const definition = definitionFromLiveField(lensType);
		definition.validValues.push('x');
		expect(lensType.validValues).toEqual(['Spherical', 'Anamorphic']);
	});

	it('reads a status list record from the corpus', () => {
		const field = readField('Version', 'sg_status_list', statusList.data) as LiveField;
		const definition = definitionFromLiveField(field);
		expect(definition.dataType).toBe('status_list');
		expect(definition.displayName).toBe('Status');
		expect(definition.validValues).toEqual(field.validValues);
		expect(definition.defaultValue).toBe(typeof field.defaultValue === 'string' ? field.defaultValue : null);
	});
});

describe('draftFromLiveField (IMP-30, MOD-8)', () => {
	it('IMP-30: sets the snapshot to the raw record and the site given; the store sets the time', () => {
		const draft = draftFromLiveField(lensType, SITE);
		expect(draft.snapshot).toBe(lensType.raw);
		expect(draft.snapshotSite).toBe(SITE);
		expect(draft.snapshotTime).toBeNull();
		expect(draft.displayName).toBe('Lens Type');
	});
});

const row = (key: string, definition: Partial<EntryDefinition>) => ({
	key,
	targetEntityType: 'Shot',
	programmaticName: 'sg_lens_type',
	displayName: 'Old',
	dataType: 'text',
	validTypes: [],
	validValues: [],
	defaultValue: null,
	description: 'old',
	uniquePerProject: true,
	...definition
});

describe('resyncDefinition (EDT-42)', () => {
	it('EDT-42: overwrites the seven live attributes and keeps target type and programmatic name', () => {
		const before = row('a', { targetEntityType: ' Shot ', programmaticName: 'sg_lens_type ' });
		expect(resyncDefinition(before, lensType)).toEqual({
			targetEntityType: ' Shot ',
			programmaticName: 'sg_lens_type ',
			displayName: 'Lens Type',
			dataType: 'list',
			validTypes: [],
			validValues: ['Spherical', 'Anamorphic'],
			defaultValue: 'Spherical',
			description: 'Which lens.',
			uniquePerProject: false
		});
	});

	it('returns a plain definition: no key, the row left as it was', () => {
		const before = row('a', {});
		const after = resyncDefinition(before, lensType);
		expect('key' in after).toBe(false);
		expect(before.displayName).toBe('Old');
	});

	it('EDT-42: refreshes the snapshot from the live field, time left to the store', () => {
		expect(snapshotFromLiveField(lensType, SITE)).toEqual({ snapshot: lensType.raw, snapshotSite: SITE, snapshotTime: null });
	});
});

describe('findLiveField (EDT-42)', () => {
	const fieldsByType = new Map([['Shot', [lensType]]]);

	it('EDT-42: matches the programmatic name exactly on the row target type, trimmed', () => {
		expect(findLiveField(fieldsByType, ' Shot ', ' sg_lens_type ')).toBe(lensType);
		expect(findLiveField(fieldsByType, 'Shot', 'SG_LENS_TYPE')).toBeNull();
		expect(findLiveField(fieldsByType, 'Shot', 'Lens Type')).toBeNull();
		expect(findLiveField(fieldsByType, 'Asset', 'sg_lens_type')).toBeNull();
		expect(findLiveField(fieldsByType, '', 'sg_lens_type')).toBeNull();
	});
});

describe('resyncRows (EDT-42)', () => {
	const fps = makeLiveField('Shot', 'sg_fps', { displayName: 'FPS', dataType: 'float' });
	const fieldsByType = new Map([
		['Shot', [lensType, fps]],
		['Asset', []]
	]);

	it('EDT-42: re-syncs each matching row, in row order, and counts them', () => {
		const rows = [
			row('a', {}),
			row('b', { programmaticName: 'sg_unknown' }),
			row('c', { programmaticName: 'sg_fps' }),
			row('d', { targetEntityType: 'Asset', programmaticName: 'sg_fps' })
		];
		const result = resyncRows(rows, fieldsByType, SITE);
		expect(result.count).toBe(2);
		expect(result.updates.map((update) => update.key)).toEqual(['a', 'c']);
		expect(result.updates[1].definition.displayName).toBe('FPS');
		expect(result.updates[1].definition.dataType).toBe('float');
		expect(result.updates[1].snapshot).toEqual({ snapshot: fps.raw, snapshotSite: SITE, snapshotTime: null });
	});

	it('EDT-42: zero matches gives an empty result for the screen to warn about', () => {
		const result = resyncRows([row('b', { programmaticName: 'sg_unknown' })], fieldsByType, SITE);
		expect(result).toEqual({ updates: [], count: 0 });
	});

	it('no rows gives zero', () => {
		expect(resyncRows([], fieldsByType, SITE).count).toBe(0);
	});
});
