import { describe, expect, it } from 'vitest';
import { focusAfterRemoval, keysAfterSave, pruneKeys, remapKeys, remapSelection, targetTypes } from './editor-session';
import type { Entry, FieldSet } from './model';
import { addRow, editRow, openWorkingCopy, removeRow } from './working-copy';
import { saveRequest } from './working-copy-save';

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

	it('EDT-46: the pair holds: `saveRequest` emits its added drafts in the row order `keysAfterSave` walks', () => {
		// The store answers `added` in the order of the request's `added`. This pins that order to
		// the rows', so an expanded or selected new row follows its own entry and not a sibling's.
		let wc = openWorkingCopy(SET, [storedEntry('a'), storedEntry('b')]);
		wc = addRow(wc, 'new-1', 'Shot');
		wc = editRow(wc, 'new-1', { displayName: 'Zebra', dataType: 'text' });
		wc = addRow(wc, 'new-2', 'Asset');
		wc = editRow(wc, 'new-2', { displayName: 'Apple', dataType: 'number' });
		wc = editRow(wc, 'a', { displayName: 'A changed' });
		wc = addRow(wc, 'new-3', 'Shot');
		wc = editRow(wc, 'new-3', { displayName: 'Mango', dataType: 'checkbox' });
		const added = saveRequest(wc).added;
		expect(added.map((draft) => draft.displayName)).toEqual(['Zebra', 'Apple', 'Mango']);
		// What the store does with them: one entry each, in that order.
		const stored = added.map((draft, index) => storedEntry(`e${index}`, draft));
		const map = keysAfterSave(wc, stored);
		const nameOf = new Map(stored.map((entry) => [entry.id, entry.displayName]));
		expect(['new-1', 'new-2', 'new-3'].map((key) => nameOf.get(map.get(key) ?? ''))).toEqual(['Zebra', 'Apple', 'Mango']);
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

describe('pruneKeys (EDT-33)', () => {
	it('EDT-33: keeps the keys that still have a row, in their order', () => {
		expect([...pruneKeys(new Set(['a', 'gone', 'b']), ['b', 'a', 'c'])]).toEqual(['a', 'b']);
	});

	it('gives an empty set when nothing is left', () => {
		expect(pruneKeys(new Set(['a']), []).size).toBe(0);
	});
});

describe('focusAfterRemoval (M8: where focus goes when the focused row is deleted)', () => {
	const group = (type: string, keys: string[]) => ({ type, keys });

	it('EDT-33: the next row of the group', () => {
		const before = [group('Shot', ['a', 'b', 'c'])];
		const after = [group('Shot', ['a', 'c'])];
		expect(focusAfterRemoval(before, after, ['b'])).toEqual({ kind: 'row', key: 'c' });
	});

	it('EDT-33: with no next row, the previous one', () => {
		expect(focusAfterRemoval([group('Shot', ['a', 'b'])], [group('Shot', ['a'])], ['b'])).toEqual({ kind: 'row', key: 'a' });
	});

	it('EDT-33: with no row left in a group that stays, its "Add field"', () => {
		// An entity type added this session keeps its header when its last row goes (EDT-19).
		expect(focusAfterRemoval([group('Asset', ['x']), group('Shot', ['a'])], [group('Asset', ['x']), group('Shot', [])], ['a'])).toEqual({
			kind: 'add-field',
			type: 'Shot'
		});
	});

	it('EDT-33: the group went with its last row: the next row on screen, else the previous', () => {
		const before = [group('Asset', ['x']), group('Shot', ['a']), group('Task', ['t'])];
		expect(focusAfterRemoval(before, [group('Asset', ['x']), group('Task', ['t'])], ['a'])).toEqual({ kind: 'row', key: 't' });
		expect(focusAfterRemoval([group('Asset', ['x']), group('Shot', ['a'])], [group('Asset', ['x'])], ['a'])).toEqual({ kind: 'row', key: 'x' });
	});

	it('EDT-33: nothing left at all: "Add entity type"', () => {
		expect(focusAfterRemoval([group('Shot', ['a'])], [], ['a'])).toEqual({ kind: 'add-entity-type' });
	});

	it('EDT-43: a bulk delete goes by its first removed row, past the other removed ones', () => {
		const before = [group('Shot', ['a', 'b', 'c', 'd'])];
		expect(focusAfterRemoval(before, [group('Shot', ['a', 'd'])], ['b', 'c'])).toEqual({ kind: 'row', key: 'd' });
		expect(focusAfterRemoval(before, [group('Shot', ['a'])], ['d', 'b', 'c'])).toEqual({ kind: 'row', key: 'a' });
	});

	it('a removed row that was not on screen moves nothing', () => {
		expect(focusAfterRemoval([group('Shot', ['a'])], [group('Shot', ['a'])], ['hidden'])).toBeNull();
		expect(focusAfterRemoval([group('Shot', ['a'])], [group('Shot', ['a'])], [])).toBeNull();
	});
});
