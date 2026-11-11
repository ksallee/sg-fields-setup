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
	setName,
	setNameMode,
	validity
} from './working-copy';

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

const mirror = storedEntry('calc', {
	dataType: 'calculated',
	snapshot: { data_type: { value: 'calculated', editable: false } },
	snapshotSite: 'https://example.shotgrid.autodesk.com',
	snapshotTime: '2026-11-01T08:00:00.000Z'
});

function open(entries: Entry[] = [storedEntry('a'), storedEntry('b')]) {
	return openWorkingCopy(SET, entries);
}

describe('openWorkingCopy', () => {
	it('EDT-1: loads name, description and entries', () => {
		const wc = open();
		expect(wc.setId).toBe('set-1');
		expect(wc.name).toBe('Lens');
		expect(wc.description).toBe('Camera data');
		expect(wc.rows.map((row) => row.key)).toEqual(['a', 'b']);
	});

	it('EDT-1: a set with no description edits as empty text', () => {
		expect(openWorkingCopy({ ...SET, description: null }, []).description).toBe('');
	});

	it('EDT-1: entries come ordered by target entity type, then programmatic name', () => {
		const wc = open([
			storedEntry('s2', { programmaticName: 'sg_b' }),
			storedEntry('a1', { targetEntityType: 'Asset', programmaticName: 'sg_z' }),
			storedEntry('s1', { programmaticName: 'sg_a' }),
			storedEntry('a2', { targetEntityType: 'Asset', programmaticName: 'sg_a' })
		]);
		expect(wc.rows.map((row) => row.key)).toEqual(['a2', 'a1', 's1', 's2']);
	});

	it('EDT-25: stored rows start in manual mode and are not new', () => {
		const row = open().rows[0];
		expect(row.nameMode).toBe('manual');
		expect(row.entryId).toBe('a');
		expect(row.isNew).toBe(false);
	});

	it('carries the snapshot fields through untouched', () => {
		const row = open([mirror]).rows[0];
		expect(row.snapshot).toBe(mirror.snapshot);
		expect(row.snapshotSite).toBe(mirror.snapshotSite);
		expect(row.snapshotTime).toBe(mirror.snapshotTime);
	});

	it('never alters the entries it was given', () => {
		const entries = [storedEntry('b'), storedEntry('a')];
		const before = structuredClone(entries);
		const wc = open(entries);
		editRow(wc, 'a', { validValues: ['x'] });
		expect(entries).toEqual(before);
	});
});

describe('set details', () => {
	it('EDT-15: name and description are edited without touching the source', () => {
		const wc = open();
		const named = setDescription(setName(wc, 'Lens data'), 'More');
		expect(named.name).toBe('Lens data');
		expect(named.description).toBe('More');
		expect(wc.name).toBe('Lens');
	});
});

describe('editRow', () => {
	it('edits one field of one row and returns a new working copy', () => {
		const wc = open();
		const next = editRow(wc, 'a', { description: 'Serial' });
		expect(rowByKey(next, 'a')?.description).toBe('Serial');
		expect(rowByKey(wc, 'a')?.description).toBe(null);
		expect(rowByKey(next, 'b')).toBe(rowByKey(wc, 'b'));
	});

	it('an unknown row key changes nothing', () => {
		const wc = open();
		expect(editRow(wc, 'nope', { description: 'x' })).toBe(wc);
	});

	it('EDT-25: in manual mode the programmatic name is edited directly and the display name leaves it alone', () => {
		const wc = editRow(editRow(open(), 'a', { programmaticName: 'sg_lens' }), 'a', { displayName: 'Lens Serial' });
		expect(rowByKey(wc, 'a')?.programmaticName).toBe('sg_lens');
	});

	it('EDT-25, MOD-17: in derived mode a display name edit re-derives the programmatic name', () => {
		const wc = editRow(addRow(open(), 'new-1', 'Shot'), 'new-1', { displayName: 'Lens Serial #' });
		expect(rowByKey(wc, 'new-1')?.programmaticName).toBe('sg_lens_serial__');
	});

	it('MOD-18: the derived name shows a doubled prefix', () => {
		const wc = editRow(addRow(open(), 'new-1', 'Shot'), 'new-1', { displayName: 'sg_lens' });
		expect(rowByKey(wc, 'new-1')?.programmaticName).toBe('sg_sg_lens');
	});

	it('MOD-19: a blank display name gives a blank derived name', () => {
		let wc = editRow(addRow(open(), 'new-1', 'Shot'), 'new-1', { displayName: 'Lens' });
		wc = editRow(wc, 'new-1', { displayName: '  ' });
		expect(rowByKey(wc, 'new-1')?.programmaticName).toBe('');
	});

	it('EDT-25: in derived mode the programmatic name is read-only', () => {
		const wc = editRow(addRow(open(), 'new-1', 'Shot'), 'new-1', { displayName: 'Lens' });
		const next = editRow(wc, 'new-1', { programmaticName: 'sg_other', description: 'kept' });
		expect(rowByKey(next, 'new-1')?.programmaticName).toBe('sg_lens');
		expect(rowByKey(next, 'new-1')?.description).toBe('kept');
	});

	it('EDT-32, MOD-15: a mirror row refuses every edit', () => {
		const wc = open([mirror]);
		expect(editRow(wc, 'calc', { displayName: 'Other' })).toBe(wc);
		expect(editRow(wc, 'calc', { dataType: 'text' })).toBe(wc);
		expect(setNameMode(wc, 'calc', 'derived')).toBe(wc);
	});
});

describe('setNameMode', () => {
	it('EDT-25: toggling to manual keeps the current name, now editable', () => {
		let wc = editRow(addRow(open(), 'new-1', 'Shot'), 'new-1', { displayName: 'Lens' });
		wc = setNameMode(wc, 'new-1', 'manual');
		expect(rowByKey(wc, 'new-1')?.programmaticName).toBe('sg_lens');
		wc = editRow(wc, 'new-1', { programmaticName: 'sg_lens_id' });
		expect(rowByKey(wc, 'new-1')?.programmaticName).toBe('sg_lens_id');
	});

	it('EDT-25: toggling back to derived takes effect at the next display name edit, not at once', () => {
		let wc = setNameMode(open(), 'a', 'derived');
		expect(rowByKey(wc, 'a')?.programmaticName).toBe('sg_a');
		wc = editRow(wc, 'a', { displayName: 'Focal Length' });
		expect(rowByKey(wc, 'a')?.programmaticName).toBe('sg_focal_length');
	});
});

describe('addRow', () => {
	it('EDT-18: appends a blank text row assigned to the type, derived and new', () => {
		const wc = addRow(open(), 'new-1', 'Asset');
		const row = wc.rows.at(-1);
		expect(row).toEqual({
			key: 'new-1',
			entryId: null,
			isNew: true,
			nameMode: 'derived',
			targetEntityType: 'Asset',
			programmaticName: '',
			displayName: '',
			dataType: 'text',
			validTypes: [],
			validValues: [],
			defaultValue: null,
			description: null,
			uniquePerProject: false,
			snapshot: null,
			snapshotSite: null,
			snapshotTime: null
		});
	});

	it('refuses a row key already in use', () => {
		expect(() => addRow(open(), 'a', 'Shot')).toThrow(/a/);
	});
});

describe('removeRow', () => {
	it('EDT-33: removes the row at once', () => {
		const wc = removeRow(open(), 'a');
		expect(wc.rows.map((row) => row.key)).toEqual(['b']);
	});

	it('EDT-32: a mirror row can be removed', () => {
		expect(removeRow(open([mirror]), 'calc').rows).toEqual([]);
	});

	it('an unknown row key changes nothing', () => {
		const wc = open();
		expect(removeRow(wc, 'nope')).toBe(wc);
	});
});

describe('replaceDefinition', () => {
	it('EDT-42 seam: replaces the nine definition keys and nothing else', () => {
		const wc = open([storedEntry('a', { snapshot: { x: 1 } })]);
		const definition = {
			targetEntityType: 'Shot',
			programmaticName: 'sg_a',
			displayName: 'Lens A',
			dataType: 'list',
			validTypes: [],
			validValues: ['x', 'y'],
			defaultValue: 'x',
			description: 'From the site',
			uniquePerProject: false
		};
		const row = rowByKey(replaceDefinition(wc, 'a', definition), 'a');
		expect(row).toMatchObject({ ...definition, key: 'a', entryId: 'a', nameMode: 'manual', snapshot: { x: 1 } });
	});

	it('EDT-42 seam: works on a mirror row, which is how it catches up with the site', () => {
		const wc = replaceDefinition(open([mirror]), 'calc', { ...mirror, displayName: 'Calc' });
		expect(rowByKey(wc, 'calc')?.displayName).toBe('Calc');
	});

	it('EDT-42 seam: an unknown row key changes nothing', () => {
		const wc = open();
		expect(replaceDefinition(wc, 'nope', storedEntry('x'))).toBe(wc);
	});

	it('EDT-42 seam: a snapshot given beside the definition replaces the row\'s three snapshot fields', () => {
		const wc = open([storedEntry('a', { snapshot: { x: 1 }, snapshotSite: 'https://old.example', snapshotTime: '2026-11-01T08:00:00.000Z' })]);
		const fresh = { snapshot: { x: 2 }, snapshotSite: 'https://site.example', snapshotTime: null };
		const row = rowByKey(replaceDefinition(wc, 'a', storedEntry('a', { displayName: 'Lens A' }), fresh), 'a');
		expect(row).toMatchObject({ displayName: 'Lens A', key: 'a', entryId: 'a', nameMode: 'manual', ...fresh });
	});

	it('EDT-42 seam, EDT-3: a refreshed snapshot alone does not make the set dirty', () => {
		const wc = open([storedEntry('a', { snapshot: { x: 1 } })]);
		const next = replaceDefinition(wc, 'a', storedEntry('a'), { snapshot: { x: 2 }, snapshotSite: 'https://site.example', snapshotTime: null });
		expect(rowByKey(next, 'a')?.snapshot).toEqual({ x: 2 });
		expect(isDirty(next)).toBe(false);
	});
});

describe('isDirty', () => {
	it('EDT-3: a freshly opened set is clean', () => {
		expect(isDirty(open())).toBe(false);
	});

	it('EDT-3: a changed name or description is dirty', () => {
		expect(isDirty(setName(open(), 'Other'))).toBe(true);
		expect(isDirty(setDescription(open(), 'Other'))).toBe(true);
	});

	it('EDT-3, MOD-7: name and description are compared trimmed, blank description as none', () => {
		expect(isDirty(setName(open(), ' Lens '))).toBe(false);
		expect(isDirty(setDescription(open(), ' Camera data\n'))).toBe(false);
		const none = openWorkingCopy({ ...SET, description: null }, []);
		expect(isDirty(setDescription(none, '  '))).toBe(false);
	});

	it('EDT-3: an edited entry is dirty; edited back, it is clean', () => {
		const edited = editRow(open(), 'a', { displayName: 'Lens' });
		expect(isDirty(edited)).toBe(true);
		expect(isDirty(editRow(edited, 'a', { displayName: 'a' }))).toBe(false);
	});

	it('EDT-3, MOD-9: an edit the cleaned form drops is not dirty', () => {
		expect(isDirty(editRow(open(), 'a', { validValues: ['x'] }))).toBe(false);
		expect(isDirty(editRow(open(), 'a', { displayName: ' a ', description: '  ' }))).toBe(false);
	});

	it('EDT-3: settings follow the data type through a round trip', () => {
		const list = open([storedEntry('a', { dataType: 'list', validValues: ['x'] })]);
		const asText = editRow(list, 'a', { dataType: 'text' });
		expect(isDirty(asText)).toBe(true);
		expect(isDirty(editRow(asText, 'a', { dataType: 'list' }))).toBe(false);
	});

	it('EDT-3: a list order change is dirty', () => {
		const list = open([storedEntry('a', { dataType: 'list', validValues: ['x', 'y'] })]);
		expect(isDirty(editRow(list, 'a', { validValues: ['y', 'x'] }))).toBe(true);
	});

	it('EDT-3: an added or removed row is dirty; added then removed, clean', () => {
		const added = addRow(open(), 'new-1', 'Shot');
		expect(isDirty(added)).toBe(true);
		expect(isDirty(removeRow(added, 'new-1'))).toBe(false);
		expect(isDirty(removeRow(open(), 'a'))).toBe(true);
	});

	it('EDT-3: snapshots are not compared', () => {
		const wc = open([storedEntry('a', { snapshot: { x: 1 } })]);
		const rows = wc.rows.map((row) => ({ ...row, snapshot: { x: 2 }, snapshotTime: 'later' }));
		expect(isDirty({ ...wc, rows })).toBe(false);
	});

	it('EDT-3: the row order is not compared', () => {
		const wc = open();
		expect(isDirty({ ...wc, rows: [...wc.rows].reverse() })).toBe(false);
	});

	it('EDT-1: the name mode is not compared', () => {
		expect(isDirty(setNameMode(open(), 'a', 'derived'))).toBe(false);
	});
});

describe('validity', () => {
	it('EDT-12: a loaded valid set is valid', () => {
		expect(validity(open()).valid).toBe(true);
	});

	it('EDT-12: a blank name is reported', () => {
		expect(validity(setName(open(), ' ')).nameMissing).toBe(true);
	});

	it('EDT-12, EDT-13: incomplete and duplicated rows are reported by row key', () => {
		let wc = addRow(open(), 'new-1', 'Shot');
		wc = editRow(wc, 'b', { programmaticName: 'sg_a' });
		const result = validity(wc);
		expect(result.valid).toBe(false);
		expect(result.incompleteIds).toEqual(['new-1']);
		expect(result.duplicateIds).toEqual(['a', 'b']);
	});
});

describe('MOD-21: 500 rows', () => {
	it('isDirty and validity each run well under a frame', () => {
		const entries = Array.from({ length: 500 }, (_, i) =>
			storedEntry(`e${i}`, { targetEntityType: `Type${i % 7}`, dataType: i % 2 ? 'list' : 'text', validValues: ['a', 'b'] })
		);
		let wc = open(entries);
		wc = editRow(wc, 'e499', { displayName: 'changed' });
		for (let i = 0; i < 5; i++) {
			isDirty(wc);
			validity(wc);
		}
		const runs = 20;
		const start = performance.now();
		for (let i = 0; i < runs; i++) {
			expect(isDirty(wc)).toBe(true);
			expect(validity(wc).valid).toBe(true);
		}
		const each = (performance.now() - start) / runs;
		expect(each).toBeLessThan(4);
	});
});
