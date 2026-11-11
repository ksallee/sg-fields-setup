import { describe, expect, it } from 'vitest';
import { keysAfterSave, remapKeys, remapSelection, targetTypes } from './editor-session';
import type { Entry, FieldSet } from './model';
import { addRow, openWorkingCopy, removeRow } from './working-copy';

const SET: FieldSet = {
	id: 'set-1',
	name: 'Lens',
	description: null,
	origin: 'manual',
	originDetails: null,
	createdAt: '2026-11-01T09:00:00.000Z',
	changedAt: '2026-11-01T09:00:00.000Z'
};

function storedEntry(id: string, overrides: Partial<Entry> = {}): Entry {
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
		changedAt: '2026-11-01T09:00:00.000Z',
		...overrides
	};
}

describe('keysAfterSave (EDT-46)', () => {
	it('EDT-46: stored rows keep their key; added rows take the id of the entry stored for them, in order', () => {
		let wc = openWorkingCopy(SET, [storedEntry('a'), storedEntry('b')]);
		wc = addRow(addRow(wc, 'new-1', 'Shot'), 'new-2', 'Asset');
		wc = removeRow(wc, 'b');
		const map = keysAfterSave(wc, [storedEntry('e7'), storedEntry('e8')]);
		expect([...map]).toEqual([
			['a', 'a'],
			['new-1', 'e7'],
			['new-2', 'e8']
		]);
	});

	it('EDT-46: an added row the store answered nothing for has no new key', () => {
		const wc = addRow(openWorkingCopy(SET, []), 'new-1', 'Shot');
		expect(keysAfterSave(wc, []).has('new-1')).toBe(false);
	});
});

describe('remapKeys, remapSelection (EDT-46)', () => {
	const map = new Map([
		['a', 'a'],
		['new-1', 'e7']
	]);

	it('EDT-46: expanded rows follow their rows; keys with no row are dropped', () => {
		expect([...remapKeys(new Set(['a', 'new-1', 'gone']), map)]).toEqual(['a', 'e7']);
	});

	it('EDT-46, EDT-39: the selection and its anchor follow their rows', () => {
		expect(remapSelection({ selected: new Set(['new-1', 'gone']), anchor: 'new-1' }, map)).toEqual({
			selected: new Set(['e7']),
			anchor: 'e7'
		});
		expect(remapSelection({ selected: new Set(['a']), anchor: 'gone' }, map).anchor).toBeNull();
	});
});

describe('targetTypes (CMP-2)', () => {
	it('CMP-2: the distinct target types among the rows, trimmed, blanks left out, in first-seen order', () => {
		const rows = [{ targetEntityType: 'Shot' }, { targetEntityType: ' Asset ' }, { targetEntityType: '' }, { targetEntityType: 'Shot ' }];
		expect(targetTypes(rows)).toEqual(['Shot', 'Asset']);
	});
});
