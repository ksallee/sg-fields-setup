import { describe, expect, it } from 'vitest';
import type { Entry, FieldSet } from './model';
import { addRow, editRow, openWorkingCopy, setName } from './working-copy';
import { blockText, duplicateBlock, installBlock, saveBlock } from './editor-reasons';

const SET: FieldSet = {
	id: 'set-1',
	name: 'Lens',
	description: null,
	origin: 'manual',
	originDetails: null,
	createdAt: '2026-11-01T09:00:00.000Z',
	changedAt: '2026-11-01T09:00:00.000Z'
};

function storedEntry(id: string): Entry {
	return {
		id,
		setId: 'set-1',
		targetEntityType: 'Shot',
		programmaticName: `sg_${id}`,
		displayName: id,
		dataType: 'text',
		validTypes: [],
		validValues: [],
		defaultValue: null,
		description: null,
		uniquePerProject: false,
		snapshot: null,
		snapshotSite: null,
		snapshotTime: null,
		createdAt: '2026-11-01T09:00:00.000Z',
		changedAt: '2026-11-01T09:00:00.000Z'
	};
}

const open = () => openWorkingCopy(SET, [storedEntry('a'), storedEntry('b')]);
const empty = () => openWorkingCopy(SET, []);
/** Two blank added rows: incomplete; plus b renamed onto a: duplicated. */
const broken = () => editRow(addRow(addRow(open(), 'n1', 'Shot'), 'n2', 'Shot'), 'b', { programmaticName: 'sg_a' });

describe('saveBlock', () => {
	it('EDT-42, EDT-44: no save while a re-sync is on its way, whatever else holds (audit M2)', () => {
		expect(saveBlock(setName(open(), 'Lens data'), { resyncing: true })).toEqual({ reason: 'resyncing' });
		expect(saveBlock(open(), { resyncing: true })).toEqual({ reason: 'nothing_to_save' });
		expect(saveBlock(setName(open(), 'Lens data'), { resyncing: false })).toBe(null);
		expect(blockText({ reason: 'resyncing' })).toBe('Wait for the re-sync to finish.');
	});

	it('EDT-11: a dirty, valid set can be saved', () => {
		expect(saveBlock(setName(open(), 'Lens data'))).toBe(null);
	});

	it('EDT-11: first match of nothing to save, name missing, incomplete, duplicated', () => {
		expect(saveBlock(open())).toEqual({ reason: 'nothing_to_save' });
		expect(saveBlock(setName(broken(), ' '))).toEqual({ reason: 'name_missing' });
		expect(saveBlock(broken())).toEqual({ reason: 'incomplete', count: 2 });
		expect(saveBlock(editRow(open(), 'b', { programmaticName: 'sg_a' }))).toEqual({ reason: 'duplicated' });
	});
});

describe('installBlock', () => {
	it('EDT-10: a clean set with entries and a site can be installed', () => {
		expect(installBlock(open(), true)).toBe(null);
	});

	it('EDT-10: first match of dirty, no entries, no site, incomplete, duplicated', () => {
		expect(installBlock(setName(empty(), 'Other'), false)).toEqual({ reason: 'dirty' });
		expect(installBlock(empty(), false)).toEqual({ reason: 'no_entries' });
		expect(installBlock(open(), false)).toEqual({ reason: 'no_site' });
	});

	it('EDT-10: a stored incomplete or duplicated entry blocks it', () => {
		const incomplete = openWorkingCopy(SET, [{ ...storedEntry('a'), displayName: '' }]);
		expect(installBlock(incomplete, true)).toEqual({ reason: 'incomplete', count: 1 });
		const twice = openWorkingCopy(SET, [storedEntry('a'), { ...storedEntry('b'), programmaticName: 'sg_a' }]);
		expect(installBlock(twice, true)).toEqual({ reason: 'duplicated' });
	});
});

describe('duplicateBlock', () => {
	it('EDT-9: a set with complete, distinct entries can be duplicated, unsaved edits and all', () => {
		expect(duplicateBlock(setName(open(), 'Other'))).toBe(null);
	});

	it('EDT-9: first match of no entries, incomplete, duplicated', () => {
		expect(duplicateBlock(empty())).toEqual({ reason: 'no_entries' });
		expect(duplicateBlock(broken())).toEqual({ reason: 'incomplete', count: 2 });
		expect(duplicateBlock(editRow(open(), 'b', { programmaticName: 'sg_a' }))).toEqual({ reason: 'duplicated' });
	});
});

describe('blockText', () => {
	it.each([
		[{ reason: 'nothing_to_save' }, 'No changes to save.'],
		[{ reason: 'name_missing' }, 'The set needs a name.'],
		[{ reason: 'incomplete', count: 1 }, '1 field is missing required values.'],
		[{ reason: 'incomplete', count: 3 }, '3 fields are missing required values.'],
		[{ reason: 'duplicated' }, 'Two or more fields share an entity type and programmatic name.'],
		[{ reason: 'dirty' }, 'Save your changes first.'],
		[{ reason: 'no_entries' }, 'The set has no fields.'],
		[{ reason: 'no_site' }, 'Connect a site first.']
	] as const)('EDT-9 to EDT-11: %o reads %s', (block, text) => {
		expect(blockText(block)).toBe(text);
	});
});
