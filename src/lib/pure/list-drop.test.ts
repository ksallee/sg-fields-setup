import { describe, expect, it } from 'vitest';
import { splitListDrop } from './list-drop';

const named = (...names: string[]) => names.map((name) => ({ name }));

describe('splitListDrop (IMP-1, D1)', () => {
	it('sends set files one way and everything else to the spreadsheet import, in order', () => {
		expect(splitListDrop(named('a.xlsx', 'b.fieldset.json', 'c.csv', 'd.txt'))).toEqual({
			setFiles: named('b.fieldset.json'),
			spreadsheets: named('a.xlsx', 'c.csv', 'd.txt')
		});
	});

	it('reads the ending in any case', () => {
		expect(splitListDrop(named('A.JSON', 'B.XLSX'))).toEqual({ setFiles: named('A.JSON'), spreadsheets: named('B.XLSX') });
	});

	it('takes a name that only contains .json as a spreadsheet', () => {
		expect(splitListDrop(named('a.json.csv')).setFiles).toEqual([]);
	});

	it('answers two empty lists for no files', () => {
		expect(splitListDrop([])).toEqual({ setFiles: [], spreadsheets: [] });
	});
});
