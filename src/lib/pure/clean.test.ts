import { describe, expect, it } from 'vitest';
import { cleanDescription, cleanEntry, withSnapshotTime } from './clean';
import type { Entry } from './model';

const T0 = '2026-11-10T09:00:00.000Z';
const T1 = '2026-11-10T10:30:00.000Z';

function entry(overrides: Partial<Entry> = {}): Entry {
	return {
		id: 'e1',
		setId: 's1',
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
		snapshotTime: null,
		createdAt: T0,
		changedAt: T0,
		...overrides
	};
}

describe('cleanEntry', () => {
	it('MOD-7: trims the text attributes', () => {
		const cleaned = cleanEntry(
			entry({
				targetEntityType: ' Shot ',
				programmaticName: '\tsg_lens ',
				displayName: '  Lens  ',
				dataType: ' text ',
				description: '  Focal length.  '
			})
		);
		expect(cleaned).toMatchObject({
			targetEntityType: 'Shot',
			programmaticName: 'sg_lens',
			displayName: 'Lens',
			dataType: 'text',
			description: 'Focal length.'
		});
	});

	it('MOD-7: stores a blank description as none', () => {
		expect(cleanEntry(entry({ description: '   ' })).description).toBeNull();
		expect(cleanEntry(entry({ description: '' })).description).toBeNull();
		expect(cleanEntry(entry({ description: null })).description).toBeNull();
	});

	it('MOD-9: a link changed to text loses its valid types', () => {
		const cleaned = cleanEntry(entry({ dataType: 'text', validTypes: ['Shot'] }));
		expect(cleaned.validTypes).toEqual([]);
	});

	it('MOD-9: a list changed to a date loses its valid values and its default', () => {
		const cleaned = cleanEntry(entry({ dataType: 'date', validValues: ['a', 'b'], defaultValue: 'a' }));
		expect(cleaned.validValues).toEqual([]);
		expect(cleaned.defaultValue).toBeNull();
	});

	it('MOD-9: unique per project stays on text and number only', () => {
		expect(cleanEntry(entry({ dataType: 'text', uniquePerProject: true })).uniquePerProject).toBe(true);
		expect(cleanEntry(entry({ dataType: 'number', uniquePerProject: true })).uniquePerProject).toBe(true);
		expect(cleanEntry(entry({ dataType: 'float', uniquePerProject: true })).uniquePerProject).toBe(false);
	});

	it('MOD-9, MOD-12: keeps what the type carries, each item trimmed, blanks dropped, order kept', () => {
		expect(cleanEntry(entry({ dataType: 'entity', validTypes: [' Shot', '', 'CustomEntity19 '] })).validTypes).toEqual([
			'Shot',
			'CustomEntity19'
		]);
		expect(cleanEntry(entry({ dataType: 'list', validValues: [' b ', '  ', 'a'] })).validValues).toEqual(['b', 'a']);
		expect(cleanEntry(entry({ dataType: 'status_list', validValues: ['ip', 'fin'] })).validValues).toEqual(['ip', 'fin']);
	});

	it('MOD-10: a checkbox default is checked, unchecked or none', () => {
		expect(cleanEntry(entry({ dataType: 'checkbox', defaultValue: true })).defaultValue).toBe(true);
		expect(cleanEntry(entry({ dataType: 'checkbox', defaultValue: false })).defaultValue).toBe(false);
		expect(cleanEntry(entry({ dataType: 'checkbox', defaultValue: null })).defaultValue).toBeNull();
		expect(cleanEntry(entry({ dataType: 'checkbox', defaultValue: 'true' })).defaultValue).toBeNull();
	});

	it('MOD-10: a list or status default is trimmed text, blank is none', () => {
		expect(cleanEntry(entry({ dataType: 'list', defaultValue: ' a ' })).defaultValue).toBe('a');
		expect(cleanEntry(entry({ dataType: 'status_list', defaultValue: 'ip' })).defaultValue).toBe('ip');
		expect(cleanEntry(entry({ dataType: 'list', defaultValue: '  ' })).defaultValue).toBeNull();
		expect(cleanEntry(entry({ dataType: 'list', defaultValue: true })).defaultValue).toBeNull();
	});

	it('MOD-9, MOD-14: a mirror keeps its type as read and carries no setting', () => {
		const cleaned = cleanEntry(
			entry({ dataType: 'calculated', validTypes: ['Shot'], validValues: ['a'], defaultValue: 'a', uniquePerProject: true })
		);
		expect(cleaned).toMatchObject({
			dataType: 'calculated',
			validTypes: [],
			validValues: [],
			defaultValue: null,
			uniquePerProject: false
		});
	});

	it('MOD-9: never alters the entry it was given', () => {
		const given = entry({
			displayName: ' Lens ',
			dataType: 'date',
			validTypes: ['Shot'],
			validValues: [' a '],
			defaultValue: 'a',
			description: ' ',
			uniquePerProject: true
		});
		const before = structuredClone(given);
		Object.freeze(given);
		Object.freeze(given.validTypes);
		Object.freeze(given.validValues);
		const cleaned = cleanEntry(given);
		expect(given).toEqual(before);
		expect(cleaned).not.toBe(given);
	});

	it('MOD-9: the copy shares no list with the entry it was given', () => {
		const given = entry({ dataType: 'list', validValues: ['a'] });
		const cleaned = cleanEntry(given);
		expect(cleaned.validValues).toEqual(['a']);
		expect(cleaned.validValues).not.toBe(given.validValues);
	});

	it('EDT-3: cleaning twice changes nothing more', () => {
		const once = cleanEntry(entry({ displayName: ' Lens ', dataType: 'list', validValues: [' a ', ''], defaultValue: ' a ' }));
		expect(cleanEntry(once)).toEqual(once);
	});

	it('EDT-3, SET-19: identity, timestamps and the snapshot pass through untouched', () => {
		const snapshot = { name: { value: ' Lens ', editable: true }, data_type: { value: 'text', editable: false } };
		const given = entry({ snapshot, snapshotSite: 'https://a.shotgrid.autodesk.com', snapshotTime: T1 });
		const cleaned = cleanEntry(given);
		expect(cleaned.snapshot).toBe(snapshot);
		expect(cleaned).toMatchObject({
			id: 'e1',
			setId: 's1',
			snapshotSite: 'https://a.shotgrid.autodesk.com',
			snapshotTime: T1,
			createdAt: T0,
			changedAt: T0
		});
	});

	it('IMP-30, IMP-31: cleans a draft that has no identity yet', () => {
		const { id: _id, setId: _setId, createdAt: _c, changedAt: _u, ...draft } = entry({ displayName: ' Lens ' });
		const cleaned = cleanEntry(draft);
		expect(cleaned.displayName).toBe('Lens');
		expect(Object.keys(cleaned).sort()).toEqual(Object.keys(draft).sort());
	});
});

describe('cleanDescription', () => {
	it('MOD-7: trimmed, and null when nothing is left', () => {
		expect(cleanDescription('  Camera data ')).toBe('Camera data');
		expect(cleanDescription('   ')).toBeNull();
		expect(cleanDescription(null)).toBeNull();
		expect(cleanDescription(undefined)).toBeNull();
	});
});

describe('withSnapshotTime', () => {
	const snapshot = { data_type: { value: 'text', editable: false } };

	it('MOD-8: a snapshot with no time gets the time of storing', () => {
		const given = entry({ snapshot, snapshotTime: null });
		const stamped = withSnapshotTime(given, T1);
		expect(stamped.snapshotTime).toBe(T1);
		expect(given.snapshotTime).toBeNull();
	});

	it('MOD-8: a snapshot time already there is kept', () => {
		expect(withSnapshotTime(entry({ snapshot, snapshotTime: T0 }), T1).snapshotTime).toBe(T0);
	});

	it('MOD-8: no snapshot, no time', () => {
		expect(withSnapshotTime(entry(), T1).snapshotTime).toBeNull();
	});
});
