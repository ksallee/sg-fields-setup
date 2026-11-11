import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	acceptFile,
	applyInferredFallback,
	bucketsFromFile,
	bucketsOf,
	confirmEnabled,
	exceedsSizeCap,
	failSaving,
	fileProblemText,
	finishAdding,
	IMPORT_SIZE_CAP_BYTES,
	initialImportDialog,
	NO_COLUMNS_TEXT,
	problemText,
	refuseFile,
	removeBucket,
	setFallback,
	spreadsheetKind,
	startAdding,
	startSaving,
	TYPES_UNREAD_TEXT,
	type ImportDialogState
} from './import-dialog';
import { bucketFromCsv, type ImportBucket } from './import-build';

const fixture = new Uint8Array(readFileSync(new URL('../../../fixtures/source/FlowStudioDemo.xlsx', import.meta.url)));

function csvBucket(name: string, headers: string[] = ['A']): ImportBucket {
	return bucketFromCsv(name, { headers, rows: [] });
}

/** A dialog with the given CSV buckets accepted, one file each. */
function withFiles(...names: string[]): ImportDialogState {
	let state = startAdding(initialImportDialog());
	for (const name of names) state = acceptFile(state, state.session, name, [csvBucket(name)]).state;
	return finishAdding(state, state.session);
}

describe('which files are taken (IMP-2, IMP-3)', () => {
	it('IMP-2: names ending in .csv or .xlsx, case-insensitive', () => {
		expect(spreadsheetKind('shots.csv')).toBe('csv');
		expect(spreadsheetKind('Shots.CSV')).toBe('csv');
		expect(spreadsheetKind('report.xlsx')).toBe('xlsx');
		expect(spreadsheetKind('REPORT.XlSx')).toBe('xlsx');
		expect(spreadsheetKind('a.b.csv')).toBe('csv');
	});

	it('IMP-2: anything else is not a spreadsheet', () => {
		for (const name of ['notes.txt', 'report.xls', 'report.xlsm', 'csv', 'shots.csv.bak', '']) {
			expect(spreadsheetKind(name)).toBeNull();
		}
	});

	it('IMP-3: the cap is 15 MB, and only a file over it is refused', () => {
		expect(IMPORT_SIZE_CAP_BYTES).toBe(15 * 1024 * 1024);
		expect(exceedsSizeCap(IMPORT_SIZE_CAP_BYTES)).toBe(false);
		expect(exceedsSizeCap(IMPORT_SIZE_CAP_BYTES + 1)).toBe(true);
		expect(exceedsSizeCap(11, 10)).toBe(true);
	});
});

describe('problem messages (IMP-2 to IMP-5)', () => {
	it('IMP-2: an unsupported file is named', () => {
		expect(fileProblemText('unsupported', 'notes.txt')).toBe('"notes.txt" is not a CSV or XLSX file.');
	});

	it('IMP-3: a file over the cap is named with the cap', () => {
		expect(fileProblemText('too-large', 'big.csv')).toBe('"big.csv" is over 15 MB.');
		expect(fileProblemText('too-large', 'big.csv', 2 * 1024 * 1024)).toBe('"big.csv" is over 2 MB.');
	});

	it('IMP-4: a file that cannot be parsed is named', () => {
		expect(fileProblemText('unreadable', 'broken.xlsx')).toBe('"broken.xlsx" could not be read.');
	});

	it('IMP-5: a file with no header row is named', () => {
		expect(fileProblemText('no-header', 'empty.csv')).toBe('"empty.csv" has no header row.');
	});

	it('IMP-3, the note of 2026-11-10: a file over a bound is named with the bound', () => {
		expect(fileProblemText('part-too-large', 'bomb.xlsx')).toBe('"bomb.xlsx" holds a part over 64 MB once unpacked.');
		expect(fileProblemText('workbook-too-large', 'bomb.xlsx')).toBe('"bomb.xlsx" is over 200 MB once unpacked.');
		expect(fileProblemText('too-many-sheets', 'tabs.xlsx')).toBe('"tabs.xlsx" has more than 200 sheets.');
		expect(fileProblemText('too-many-columns', 'wide.csv')).toBe('"wide.csv" has more than 2,000 columns.');
	});
});

describe('a file to its buckets (IMP-4 to IMP-6, IMP-41, IMP-47)', () => {
	it('IMP-6: a CSV is one bucket', () => {
		const result = bucketsFromFile('shots.csv', { kind: 'csv', text: 'Code,Cut In\nsh010,1001\n' });
		expect(result.ok && result.buckets.map((bucket) => [bucket.label, bucket.table.headers])).toEqual([['shots.csv', ['Code', 'Cut In']]]);
	});

	it('IMP-41: a semicolon separated CSV is read as columns', () => {
		const result = bucketsFromFile('shots.csv', { kind: 'csv', text: 'Code;Cut In;Cut Out\nsh010;1001;1100\n' });
		expect(result.ok && result.buckets[0].table.headers).toEqual(['Code', 'Cut In', 'Cut Out']);
	});

	it('keeps a sample of a CSV, 50 data rows, as a worksheet does (IMP-45)', () => {
		const text = 'A\n' + Array.from({ length: 80 }, (_, i) => String(i)).join('\n');
		const result = bucketsFromFile('long.csv', { kind: 'csv', text });
		expect(result.ok && result.buckets[0].table.rows.length).toBe(50);
	});

	it('IMP-5: an empty CSV has no header', () => {
		expect(bucketsFromFile('empty.csv', { kind: 'csv', text: '' })).toEqual({ ok: false, problem: 'no-header' });
		expect(bucketsFromFile('blank.csv', { kind: 'csv', text: '\n , ,\n' })).toEqual({ ok: false, problem: 'no-header' });
	});

	it('IMP-4: a binary file named .csv is unreadable', () => {
		expect(bucketsFromFile('image.csv', { kind: 'csv', text: 'PK\u0000\u0003' })).toEqual({ ok: false, problem: 'unreadable' });
	});

	it('IMP-6: the real workbook is one bucket of 72 columns, labelled with file and sheet', () => {
		const result = bucketsFromFile('FlowStudioDemo.xlsx', { kind: 'xlsx', bytes: fixture });
		if (!result.ok) throw new Error('expected buckets');
		expect(result.buckets).toHaveLength(1);
		expect(result.buckets[0].label).toMatch(/^FlowStudioDemo\.xlsx \(.+\)$/);
		expect(result.buckets[0].table.headers).toHaveLength(72);
		expect(result.buckets[0].fallback).toBe('');
	});

	it('IMP-3, the note of 2026-11-10: a table over the column bound is refused by its reason', () => {
		expect(bucketsFromFile('wide.csv', { kind: 'csv', text: 'a,'.repeat(2001) })).toEqual({ ok: false, problem: 'too-many-columns' });
	});

	it('IMP-47: bytes that are not a workbook are unreadable', () => {
		const bytes = new TextEncoder().encode('just some text');
		expect(bucketsFromFile('renamed.xlsx', { kind: 'xlsx', bytes })).toEqual({ ok: false, problem: 'unreadable' });
	});
});

describe('adding files (IMP-1, IMP-6, IMP-9, IMP-12)', () => {
	it('starts with nothing, automatic mode and the two colons', () => {
		const state = initialImportDialog();
		expect(state.rows).toEqual([]);
		expect(state.setName).toBe('');
		expect(state.mode).toBe('automatic');
		expect(state.delimiter).toBe('::');
		expect(state.saving).toBe(false);
		expect(problemText(state)).toBeNull();
	});

	it('IMP-1, IMP-6: buckets are kept in the order they came, each with its own id', () => {
		const first = acceptFile(startAdding(initialImportDialog()), 0, 'a.csv', [csvBucket('a.csv')]);
		expect(first.added.map((row) => row.bucket.label)).toEqual(['a.csv']);
		const sheets = [
			{ ...csvBucket('b.xlsx'), label: 'b.xlsx (One)', worksheet: 'One' },
			{ ...csvBucket('b.xlsx'), label: 'b.xlsx (Two)', worksheet: 'Two' }
		];
		const second = acceptFile(startAdding(first.state), 0, 'b.xlsx', sheets);
		expect(second.added.map((row) => row.bucket.label)).toEqual(['b.xlsx (One)', 'b.xlsx (Two)']);
		expect(bucketsOf(second.state).map((bucket) => bucket.label)).toEqual(['a.csv', 'b.xlsx (One)', 'b.xlsx (Two)']);
		expect(new Set(second.state.rows.map((row) => row.id)).size).toBe(3);
	});

	it('IMP-9: the set name defaults to the first accepted file, without its extension', () => {
		expect(withFiles('Lens Data.csv').setName).toBe('Lens Data');
	});

	it('IMP-9: only once: a second file never renames the set, even after the box was emptied', () => {
		let state = withFiles('first.csv');
		state = { ...state, setName: '' };
		state = acceptFile(startAdding(state), state.session, 'second.csv', [csvBucket('second.csv')]).state;
		expect(state.setName).toBe('');
	});

	it('IMP-9: a name already typed is kept, and the default is then spent', () => {
		let state: ImportDialogState = { ...initialImportDialog(), setName: 'Mine' };
		state = acceptFile(startAdding(state), 0, 'first.csv', [csvBucket('first.csv')]).state;
		expect(state.setName).toBe('Mine');
		state = { ...state, setName: '' };
		state = acceptFile(startAdding(state), 0, 'second.csv', [csvBucket('second.csv')]).state;
		expect(state.setName).toBe('');
	});

	it('IMP-9: a refused file is not the first accepted file', () => {
		let state = refuseFile(startAdding(initialImportDialog()), 0, 'unsupported', 'notes.txt');
		state = acceptFile(state, 0, 'shots.csv', [csvBucket('shots.csv')]).state;
		expect(state.setName).toBe('shots');
	});

	it('IMP-2: a refused file leaves the other files of the drop in', () => {
		let state = startAdding(initialImportDialog());
		state = acceptFile(state, 0, 'a.csv', [csvBucket('a.csv')]).state;
		state = refuseFile(state, 0, 'unsupported', 'notes.txt');
		state = acceptFile(state, 0, 'b.csv', [csvBucket('b.csv')]).state;
		expect(bucketsOf(state).map((bucket) => bucket.label)).toEqual(['a.csv', 'b.csv']);
		expect(problemText(state)).toBe('"notes.txt" is not a CSV or XLSX file.');
	});

	it('IMP-12: the most recent problem shows, with how many more the same drop had', () => {
		let state = startAdding(initialImportDialog());
		state = refuseFile(state, 0, 'unsupported', 'notes.txt');
		state = refuseFile(state, 0, 'too-large', 'big.csv');
		expect(problemText(state)).toBe('"big.csv" is over 15 MB. 1 other file was refused.');
		state = refuseFile(state, 0, 'no-header', 'empty.csv');
		expect(problemText(state)).toBe('"empty.csv" has no header row. 2 other files were refused.');
	});

	it('IMP-12: adding files clears the problem first', () => {
		let state = refuseFile(startAdding(initialImportDialog()), 0, 'unsupported', 'notes.txt');
		state = startAdding(state);
		expect(problemText(state)).toBeNull();
		state = refuseFile(state, 0, 'unreadable', 'broken.xlsx');
		expect(problemText(state)).toBe('"broken.xlsx" could not be read.');
	});

	it('IMP-13: a file that finishes reading after the dialog closed is dropped', () => {
		const reopened = initialImportDialog(1);
		const accepted = acceptFile(reopened, 0, 'late.csv', [csvBucket('late.csv')]);
		expect(accepted.state).toBe(reopened);
		expect(accepted.added).toEqual([]);
		expect(refuseFile(reopened, 0, 'unreadable', 'late.csv')).toBe(reopened);
	});
});

describe('buckets and their fallbacks (IMP-8, IMP-15, IMP-16)', () => {
	it('IMP-8: removing a bucket leaves the others, in order', () => {
		const state = withFiles('a.csv', 'b.csv', 'c.csv');
		const next = removeBucket(state, state.rows[1].id);
		expect(bucketsOf(next).map((bucket) => bucket.label)).toEqual(['a.csv', 'c.csv']);
		expect(removeBucket(next, 999)).toBe(next);
	});

	it('IMP-8: the user sets a bucket\'s fallback', () => {
		const state = withFiles('a.csv', 'b.csv');
		const next = setFallback(state, state.rows[1].id, 'Asset');
		expect(bucketsOf(next).map((bucket) => bucket.fallback)).toEqual(['', 'Asset']);
	});

	it('IMP-15: an inferred fallback fills an empty one', () => {
		const state = withFiles('a.csv');
		const next = applyInferredFallback(state, state.session, state.rows[0].id, 'Shot');
		expect(bucketsOf(next)[0].fallback).toBe('Shot');
	});

	it('IMP-15: no inference leaves it empty', () => {
		const state = withFiles('a.csv');
		expect(applyInferredFallback(state, state.session, state.rows[0].id, null)).toBe(state);
	});

	it('IMP-16: inference never overwrites a fallback the user set', () => {
		let state = withFiles('a.csv');
		state = setFallback(state, state.rows[0].id, 'Asset');
		expect(applyInferredFallback(state, state.session, state.rows[0].id, 'Shot')).toBe(state);
	});

	it('IMP-16: nor one the user set and then cleared', () => {
		let state = withFiles('a.csv');
		state = setFallback(state, state.rows[0].id, 'Asset');
		state = setFallback(state, state.rows[0].id, '');
		expect(applyInferredFallback(state, state.session, state.rows[0].id, 'Shot')).toBe(state);
	});

	it('IMP-16: a slow inference for a bucket that was removed, or for a closed dialog, does nothing', () => {
		const state = withFiles('a.csv', 'b.csv');
		const removed = removeBucket(state, state.rows[0].id);
		expect(applyInferredFallback(removed, removed.session, state.rows[0].id, 'Shot')).toBe(removed);
		const reopened = initialImportDialog(state.session + 1);
		expect(applyInferredFallback(reopened, state.session, state.rows[0].id, 'Shot')).toBe(reopened);
	});

	it('IMP-16: an inferred fallback can still be changed by the user', () => {
		let state = withFiles('a.csv');
		state = applyInferredFallback(state, state.session, state.rows[0].id, 'Shot');
		state = setFallback(state, state.rows[0].id, 'Asset');
		expect(bucketsOf(state)[0].fallback).toBe('Asset');
	});
});

describe('confirming (IMP-11, IMP-13, IMP-51)', () => {
	function ready(): ImportDialogState {
		const state = withFiles('a.csv');
		return setFallback(state, state.rows[0].id, 'Shot');
	}

	it('IMP-11: needs a name, a bucket, and a fallback on every bucket', () => {
		expect(confirmEnabled(initialImportDialog())).toBe(false);
		expect(confirmEnabled(withFiles('a.csv'))).toBe(false);
		expect(confirmEnabled(ready())).toBe(true);
		expect(confirmEnabled({ ...ready(), setName: '  ' })).toBe(false);
		const two = acceptFile(ready(), 0, 'b.csv', [csvBucket('b.csv')]).state;
		expect(confirmEnabled(two)).toBe(false);
		expect(confirmEnabled(removeBucket(two, two.rows[1].id))).toBe(true);
	});

	it('IMP-11: not while a file is still being read: its buckets would be left out without a word', () => {
		// One file is in, with its fallback. A second drop is still being read.
		const reading = startAdding(ready());
		expect(reading.reading).toBe(1);
		expect(confirmEnabled(reading)).toBe(false);
		expect(startSaving(reading)).toBeNull();
		// Two drops at once: both must end.
		const twice = startAdding(reading);
		const one = finishAdding(twice, twice.session);
		expect(confirmEnabled(one)).toBe(false);
		const none = finishAdding(one, one.session);
		expect(none.reading).toBe(0);
		expect(confirmEnabled(none)).toBe(true);
		// The second file arrived meanwhile and needs its fallback like any other.
		const arrived = finishAdding(acceptFile(reading, reading.session, 'b.csv', [csvBucket('b.csv')]).state, reading.session);
		expect(confirmEnabled(arrived)).toBe(false);
		expect(confirmEnabled(setFallback(arrived, arrived.rows[1].id, 'Asset'))).toBe(true);
	});

	it('IMP-13: a read that ends after the dialog was opened again answers to nobody, and the count never goes below zero', () => {
		const old = startAdding(initialImportDialog(3));
		const reopened = startAdding(initialImportDialog(4));
		expect(finishAdding(reopened, old.session)).toBe(reopened);
		const idle = initialImportDialog(4);
		expect(finishAdding(idle, 4)).toBe(idle);
		expect(initialImportDialog().reading).toBe(0);
	});

	it('IMP-11: saving starts only when confirm is enabled, and clears the problem', () => {
		expect(startSaving(withFiles('a.csv'))).toBeNull();
		const state = refuseFile(ready(), 0, 'unsupported', 'notes.txt');
		const saving = startSaving(state);
		expect(saving?.saving).toBe(true);
		expect(saving && problemText(saving)).toBeNull();
	});

	it('IMP-11: nothing is confirmed twice while saving', () => {
		const saving = startSaving(ready());
		if (!saving) throw new Error('expected saving');
		expect(confirmEnabled(saving)).toBe(false);
		expect(startSaving(saving)).toBeNull();
	});

	it('IMP-13: while saving, files and bucket changes are ignored', () => {
		const saving = startSaving(ready());
		if (!saving) throw new Error('expected saving');
		expect(startAdding(saving)).toBe(saving);
		expect(removeBucket(saving, saving.rows[0].id)).toBe(saving);
		expect(setFallback(saving, saving.rows[0].id, 'Asset')).toBe(saving);
	});

	it('IMP-51: a failure shows its message, and the buckets and the name stay', () => {
		const saving = startSaving(ready());
		if (!saving) throw new Error('expected saving');
		const failed = failSaving(saving, saving.session, 'A set named "a" already exists. Choose another name.');
		expect(failed.saving).toBe(false);
		expect(problemText(failed)).toBe('A set named "a" already exists. Choose another name.');
		expect(bucketsOf(failed)).toEqual(bucketsOf(saving));
		expect(failed.setName).toBe('a');
		expect(confirmEnabled(failed)).toBe(true);
	});

	it('IMP-12: adding files after a failure clears its message', () => {
		const saving = startSaving(ready());
		if (!saving) throw new Error('expected saving');
		const failed = failSaving(saving, saving.session, 'No.');
		expect(problemText(startAdding(failed))).toBeNull();
	});

	it('the failure texts the dialog words itself', () => {
		expect(NO_COLUMNS_TEXT).toBe('These files have no column to import.');
		expect(TYPES_UNREAD_TEXT).toBe('Could not read the entity types of the site. Try again.');
	});
});
