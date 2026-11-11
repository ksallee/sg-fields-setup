import { describe, expect, it } from 'vitest';
import { countText, deleteQuestion, duplicatedText, fieldCount, importedText, ORIGIN_LABELS, SORT_LABELS, totalText, exportedNote } from './set-text';

describe('countText', () => {
	it('picks the singular for one and the plural for the rest', () => {
		expect(countText(0, 'field')).toBe('0 fields');
		expect(countText(1, 'field')).toBe('1 field');
		expect(countText(2, 'field')).toBe('2 fields');
		expect(countText(1, 'entry', 'entries')).toBe('1 entry');
		expect(countText(3, 'entry', 'entries')).toBe('3 entries');
	});

	it('groups thousands', () => {
		expect(countText(1234, 'field')).toBe('1,234 fields');
	});
});

describe('set list text', () => {
	it('SET-3 the entry count reads in fields, singular and plural', () => {
		expect(fieldCount(0)).toBe('No fields');
		expect(fieldCount(1)).toBe('1 field');
		expect(fieldCount(27)).toBe('27 fields');
	});

	it('SET-2 names every origin and every sort', () => {
		expect(ORIGIN_LABELS).toEqual({ import: 'Import', manual: 'Manual', site_capture: 'Site capture' });
		expect(SORT_LABELS).toEqual({ changed: 'Recently changed', created: 'Recently created', name: 'Name A to Z' });
	});

	it('the total reads as sets, and says when a search or filter narrowed it', () => {
		expect(totalText(1, false)).toBe('1 set');
		expect(totalText(24, false)).toBe('24 sets');
		expect(totalText(3, true)).toBe('3 sets match');
		expect(totalText(1, true)).toBe('1 set matches');
	});

	it('SET-21 the duplicate confirmation names the copy', () => {
		expect(duplicatedText('Lens copy')).toBe('Duplicated as "Lens copy".');
	});

	it('SET-22 the delete question names the set and what goes with it', () => {
		expect(deleteQuestion('Lens', 12)).toBe('"Lens" and its 12 fields will be deleted. This cannot be undone.');
		expect(deleteQuestion('Lens', 1)).toBe('"Lens" and its 1 field will be deleted. This cannot be undone.');
		expect(deleteQuestion('Lens', 0)).toBe('"Lens" will be deleted. This cannot be undone.');
	});

	it('D1 the import confirmation counts the fields and the duplicates dropped', () => {
		expect(importedText({ name: 'Lens', askedName: 'Lens', entryCount: 12, duplicatesDropped: 0 })).toBe(
			'Imported "Lens" with 12 fields.'
		);
		expect(importedText({ name: 'Lens', askedName: 'Lens', entryCount: 1, duplicatesDropped: 2 })).toBe(
			'Imported "Lens" with 1 field. 2 duplicates dropped.'
		);
		expect(importedText({ name: 'Lens', askedName: 'Lens', entryCount: 0, duplicatesDropped: 1 })).toBe(
			'Imported "Lens" with no fields. 1 duplicate dropped.'
		);
	});

	it('D1 the import confirmation says when the name was taken', () => {
		expect(importedText({ name: 'Lens copy', askedName: 'Lens', entryCount: 3, duplicatesDropped: 0 })).toBe(
			'Imported as "Lens copy" with 3 fields. The name "Lens" was taken.'
		);
	});
});

describe('exportedNote (B9 of the security audit)', () => {
	const entry = (snapshotSite: string | null) => ({ snapshotSite, snapshot: snapshotSite === null ? null : {} });

	it('says nothing for a set with no captured field', () => {
		expect(exportedNote([])).toBeUndefined();
		expect(exportedNote([entry(null), entry(null)])).toBeUndefined();
	});

	it('names the site the file carries', () => {
		expect(exportedNote([entry('https://studio.shotgrid.autodesk.com'), entry(null), entry('https://studio.shotgrid.autodesk.com')])).toBe(
			'The file carries the site address, https://studio.shotgrid.autodesk.com, and the schema record of each field captured there.'
		);
	});

	it('counts the sites when there are several', () => {
		expect(exportedNote([entry('https://a.shotgrid.autodesk.com'), entry('https://b.shotgrid.autodesk.com')])).toBe(
			'The file carries 2 site addresses and the schema record of each captured field.'
		);
	});
});
