import { describe, expect, it } from 'vitest';
import type { Entry, FieldSet } from './model';
import {
	addRow,
	editRow,
	isDirty,
	openWorkingCopy,
	removeRow,
	replaceDefinition,
	rowByKey,
	setDescription,
	setName
} from './working-copy';
import { addedKeys, adoptStored, afterSave, draftsOf, installEntries, saveRequest } from './working-copy-save';

const SET: FieldSet = {
	id: 'set-1',
	name: 'Lens',
	description: 'Camera data',
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

const snapshotted = storedEntry('b', {
	snapshot: { data_type: { value: 'text', editable: false } },
	snapshotSite: 'https://example.shotgrid.autodesk.com',
	snapshotTime: '2026-11-01T08:00:00.000Z'
});

function open() {
	return openWorkingCopy(SET, [storedEntry('a'), snapshotted, storedEntry('c')]);
}

describe('saveRequest', () => {
	it('EDT-44: a clean working copy asks for nothing', () => {
		expect(saveRequest(open())).toEqual({
			details: null,
			removedIds: [],
			changed: [],
			added: [],
			loaded: { setChangedAt: SET.changedAt, name: 'Lens', description: 'Camera data', entryChangedAt: {} }
		});
	});

	it('H1: carries what the set and each changed or removed field read when loaded, never what was typed since', () => {
		const loadedAt = '2026-11-02T10:00:00.000Z';
		let wc = openWorkingCopy({ ...SET, changedAt: loadedAt }, [storedEntry('a', { changedAt: loadedAt }), snapshotted, storedEntry('c')]);
		const key = (id: string) => wc.rows.find((row) => row.entryId === id)!.key;
		wc = setName(wc, 'Lens kit');
		wc = editRow(wc, key('a'), { description: 'Edited.' });
		wc = removeRow(wc, key('c'));
		wc = addRow(wc, 'new-1', 'Shot');
		expect(saveRequest(wc).loaded).toEqual({
			setChangedAt: loadedAt,
			name: 'Lens',
			description: 'Camera data',
			// The changed one and the removed one. Not the untouched one, not the added one.
			entryChangedAt: { a: loadedAt, c: '2026-11-01T09:00:00.000Z' }
		});
	});

	it('EDT-44, MOD-1, MOD-7: a changed name or description sends both, cleaned', () => {
		expect(saveRequest(setName(open(), ' Lens data ')).details).toEqual({
			name: 'Lens data',
			description: 'Camera data'
		});
		expect(saveRequest(setDescription(open(), '  ')).details).toEqual({ name: 'Lens', description: null });
	});

	it('EDT-44: name and description cleaned back to the saved ones send nothing', () => {
		expect(saveRequest(setName(open(), 'Lens ')).details).toBe(null);
	});

	it('EDT-44: removed stored rows are sent by entry id', () => {
		const wc = removeRow(removeRow(open(), 'a'), 'c');
		expect(saveRequest(wc).removedIds).toEqual(['a', 'c']);
	});

	it('EDT-45: only entries whose cleaned form changed are written, cleaned, with their stored fields', () => {
		let wc = editRow(open(), 'b', { displayName: ' Lens B ', validValues: ['dropped'] });
		wc = editRow(wc, 'c', { description: '  ' });
		expect(saveRequest(wc).changed).toEqual([{ ...snapshotted, displayName: 'Lens B' }]);
	});

	it('EDT-42, EDT-45: a re-synced row that changed is sent with its refreshed snapshot, not the saved one', () => {
		const fresh = { snapshot: { data_type: { value: 'list', editable: false } }, snapshotSite: 'https://site.example', snapshotTime: null };
		const wc = replaceDefinition(open(), 'b', { ...snapshotted, displayName: 'Lens B', dataType: 'list', validValues: ['x'] }, fresh);
		expect(saveRequest(wc).changed).toEqual([{ ...snapshotted, displayName: 'Lens B', dataType: 'list', validValues: ['x'], ...fresh }]);
	});

	it('EDT-42, EDT-45: a re-synced row whose definition did not move is not written', () => {
		const wc = replaceDefinition(open(), 'b', snapshotted, { snapshot: { other: true }, snapshotSite: 'https://site.example', snapshotTime: null });
		expect(saveRequest(wc).changed).toEqual([]);
	});

	it('EDT-44, EDT-18: added rows are sent as cleaned drafts, in row order', () => {
		let wc = addRow(addRow(open(), 'new-1', 'Shot'), 'new-2', 'Asset');
		wc = editRow(wc, 'new-2', { displayName: 'Focal ', dataType: 'list', validValues: [' 35 ', ''] });
		wc = editRow(wc, 'new-1', { displayName: 'Lens' });
		expect(saveRequest(wc).added).toEqual([
			{
				targetEntityType: 'Shot',
				programmaticName: 'sg_lens',
				displayName: 'Lens',
				dataType: 'text',
				validTypes: [],
				validValues: [],
				defaultValue: null,
				description: null,
				uniquePerProject: false,
				snapshot: null,
				snapshotSite: null,
				snapshotTime: null
			},
			{
				targetEntityType: 'Asset',
				programmaticName: 'sg_focal',
				displayName: 'Focal',
				dataType: 'list',
				validTypes: [],
				validValues: ['35'],
				defaultValue: null,
				description: null,
				uniquePerProject: false,
				snapshot: null,
				snapshotSite: null,
				snapshotTime: null
			}
		]);
		expect(addedKeys(wc)).toEqual(['new-1', 'new-2']);
	});

	it('EDT-44: deleting an entry and adding one with the same pair sends both', () => {
		let wc = removeRow(open(), 'a');
		wc = editRow(addRow(wc, 'new-1', 'Shot'), 'new-1', { displayName: 'a' });
		const request = saveRequest(wc);
		expect(request.removedIds).toEqual(['a']);
		expect(request.added.map((draft) => draft.programmaticName)).toEqual(['sg_a']);
	});
});

describe('afterSave', () => {
	it('EDT-46: returns a clean working copy on the reloaded state', () => {
		const stored = [storedEntry('a', { displayName: 'Lens A' }), storedEntry('n1', { programmaticName: 'sg_lens' })];
		const wc = afterSave(open(), { ...SET, name: 'Lens data' }, stored);
		expect(isDirty(wc)).toBe(false);
		expect(wc.name).toBe('Lens data');
		expect(wc.rows.map((row) => [row.key, row.nameMode])).toEqual([
			['a', 'manual'],
			['n1', 'manual']
		]);
	});
});

describe('adoptStored', () => {
	it('EDT-47: an added row once stored is treated as existing, so a retry does not create it twice', () => {
		let wc = editRow(addRow(open(), 'new-1', 'Shot'), 'new-1', { displayName: 'Lens' });
		wc = setName(wc, 'Lens data');
		const draft = saveRequest(wc).added[0];
		const created: Entry = {
			...draft,
			id: 'e9',
			setId: 'set-1',
			createdAt: '2026-11-10T09:00:00.000Z',
			changedAt: '2026-11-10T09:00:00.000Z'
		};
		const adopted = adoptStored(wc, new Map([['new-1', created]]));
		const row = rowByKey(adopted, 'new-1');
		expect(row).toMatchObject({ key: 'new-1', entryId: 'e9', isNew: false, nameMode: 'derived' });
		const retry = saveRequest(adopted);
		expect(retry.added).toEqual([]);
		expect(retry.changed).toEqual([]);
		expect(retry.details).toEqual({ name: 'Lens data', description: 'Camera data' });
	});

	it('EDT-47: an adopted row edited after is sent as a change', () => {
		const wc = addRow(open(), 'new-1', 'Shot');
		const created = { ...saveRequest(wc).added[0], id: 'e9', setId: 'set-1', createdAt: 't', changedAt: 't' };
		const edited = editRow(adoptStored(wc, new Map([['new-1', created]])), 'new-1', { displayName: 'Lens' });
		expect(saveRequest(edited).changed.map((entry) => entry.id)).toEqual(['e9']);
		expect(saveRequest(edited).added).toEqual([]);
	});

	it('keys that are not added rows are ignored', () => {
		const wc = open();
		expect(adoptStored(wc, new Map([['a', storedEntry('zz')]]))).toBe(wc);
	});
});

describe('entries for Duplicate and Install', () => {
	it('EDT-9: drafts of every row, unsaved edits included, cleaned, snapshots kept', () => {
		let wc = editRow(open(), 'b', { displayName: ' B2 ' });
		wc = addRow(wc, 'new-1', 'Asset');
		const drafts = draftsOf(wc);
		expect(drafts).toHaveLength(4);
		expect(drafts[1]).toEqual({
			targetEntityType: 'Shot',
			programmaticName: 'sg_b',
			displayName: 'B2',
			dataType: 'text',
			validTypes: [],
			validValues: [],
			defaultValue: null,
			description: null,
			uniquePerProject: false,
			snapshot: snapshotted.snapshot,
			snapshotSite: snapshotted.snapshotSite,
			snapshotTime: snapshotted.snapshotTime
		});
	});

	it('EDT-9: only the selected rows, in row order', () => {
		const drafts = draftsOf(open(), ['c', 'a', 'nope']);
		expect(drafts.map((draft) => draft.programmaticName)).toEqual(['sg_a', 'sg_c']);
	});

	it('EDT-10, PLN-1: the stored entries of every row, or of the selected rows', () => {
		const wc = open();
		expect(installEntries(wc)).toEqual([storedEntry('a'), snapshotted, storedEntry('c')]);
		expect(installEntries(wc, ['c'])).toEqual([storedEntry('c')]);
	});

	it('PLN-2: rows not stored are never offered to Install', () => {
		expect(installEntries(addRow(open(), 'new-1', 'Shot')).map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
	});
});
