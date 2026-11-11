import { describe, expect, it } from 'vitest';
import type { Entry, FieldSet } from './model';
import { openWorkingCopy, rowByKey, validity } from './working-copy';
import { bulkAssignType, bulkChangeDataType, bulkDelete } from './working-copy-bulk';

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

function open() {
	return openWorkingCopy(SET, [
		storedEntry('a'),
		storedEntry('b', { dataType: 'list', validValues: ['x'] }),
		storedEntry('calc', { dataType: 'calculated' }),
		storedEntry('c', { targetEntityType: 'Asset', programmaticName: 'sg_a' })
	]);
}

describe('bulkAssignType', () => {
	it('EDT-41: sets the target type of every listed row', () => {
		const { workingCopy, skipped } = bulkAssignType(open(), ['a', 'b'], 'Sequence');
		expect(rowByKey(workingCopy, 'a')?.targetEntityType).toBe('Sequence');
		expect(rowByKey(workingCopy, 'b')?.targetEntityType).toBe('Sequence');
		expect(rowByKey(workingCopy, 'c')?.targetEntityType).toBe('Asset');
		expect(skipped).toBe(0);
	});

	it('MOD-15, EDT-32: mirror rows are skipped and counted', () => {
		const { workingCopy, skipped } = bulkAssignType(open(), ['a', 'calc'], 'Sequence');
		expect(rowByKey(workingCopy, 'calc')?.targetEntityType).toBe('Shot');
		expect(skipped).toBe(1);
	});

	it('EDT-43: moving a row onto a type with the same name makes both duplicates', () => {
		const { workingCopy } = bulkAssignType(open(), ['c'], 'Shot');
		expect(validity(workingCopy).duplicateIds).toEqual(['c', 'a']);
	});

	it('unknown keys are ignored and change nothing', () => {
		const wc = open();
		expect(bulkAssignType(wc, ['nope'], 'Shot')).toEqual({ workingCopy: wc, skipped: 0 });
	});
});

describe('bulkChangeDataType', () => {
	it('EDT-41: sets the data type of every listed row except mirrors, and counts the skipped', () => {
		const { workingCopy, skipped } = bulkChangeDataType(open(), ['a', 'b', 'calc'], 'number');
		expect(rowByKey(workingCopy, 'a')?.dataType).toBe('number');
		expect(rowByKey(workingCopy, 'b')?.dataType).toBe('number');
		expect(rowByKey(workingCopy, 'calc')?.dataType).toBe('calculated');
		expect(skipped).toBe(1);
	});

	it('MOD-9: settings stay in the working copy; cleaning drops them on save', () => {
		const { workingCopy } = bulkChangeDataType(open(), ['b'], 'text');
		expect(rowByKey(workingCopy, 'b')?.validValues).toEqual(['x']);
	});
});

describe('bulkDelete', () => {
	it('EDT-41: removes every listed row, mirrors included', () => {
		const wc = bulkDelete(open(), ['a', 'calc']);
		expect(wc.rows.map((row) => row.key)).toEqual(['c', 'b']);
	});
});
