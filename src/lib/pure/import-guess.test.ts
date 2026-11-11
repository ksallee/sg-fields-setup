import { describe, expect, it } from 'vitest';
import {
	GUESS_SAMPLE_SIZE,
	columnValues,
	guessDataType,
	isBooleanWord,
	isDate,
	isDateTime,
	isNumber,
	sampleValues
} from './import-guess';
import type { ParsedTable } from './table';

describe('columnValues', () => {
	const table: ParsedTable = {
		headers: ['Slates::Slate', 'Tk Take', 'Tk FPS'],
		rows: [['1A', 'Tk05', '24'], ['2A'], ['3A', 'Tk07', '25', 'extra']]
	};

	it('IMP-40: reads one column, a missing cell reading as blank', () => {
		expect(columnValues(table, 0)).toEqual(['1A', '2A', '3A']);
		expect(columnValues(table, 2)).toEqual(['24', '', '25']);
	});

	it('IMP-40: a column past every row reads all blank', () => {
		expect(columnValues(table, 5)).toEqual(['', '', '']);
	});

	it('a table with no rows has no values', () => {
		expect(columnValues({ headers: ['a'], rows: [] }, 0)).toEqual([]);
	});
});

describe('sampleValues (IMP-33)', () => {
	it('IMP-33: trims, drops blanks, keeps the first 20', () => {
		expect(GUESS_SAMPLE_SIZE).toBe(20);
		expect(sampleValues([' a ', '', '  ', ' b\t'])).toEqual(['a', 'b']);
		const values = ['', ...Array.from({ length: 25 }, (_, i) => String(i))];
		expect(sampleValues(values)).toEqual(Array.from({ length: 20 }, (_, i) => String(i)));
	});
});

describe('isBooleanWord', () => {
	it('IMP-33: true, false, yes and no in any case', () => {
		for (const v of ['true', 'FALSE', 'Yes', 'nO']) expect(isBooleanWord(v)).toBe(true);
	});

	it('IMP-34: 0, 1 and other words are not', () => {
		for (const v of ['0', '1', 'y', 'n', 'on', 'off', 'yes!']) expect(isBooleanWord(v)).toBe(false);
	});
});

describe('isNumber', () => {
	it('IMP-33: optionally negative whole or decimal numbers', () => {
		for (const v of ['0', '24', '-10', '2.8', '-0.5', '172.8', '0.0', '1234567']) expect(isNumber(v)).toBe(true);
	});

	it('IMP-35: a leading plus sign is not a number', () => {
		expect(isNumber('+5')).toBe(false);
	});

	it('IMP-35: thousands separators, exponents and comma decimals are not numbers', () => {
		for (const v of ['1,000', '1 000', '1e5', '1E-3', '2,8']) expect(isNumber(v)).toBe(false);
	});

	it('IMP-35: a bare decimal point on either side is not a number', () => {
		for (const v of ['1.', '.5', '-.5', '.', '-']) expect(isNumber(v)).toBe(false);
	});

	it('IMP-35: a leading zero before more digits is not a number, so codes keep their zeros', () => {
		for (const v of ['007', '01', '-01', '00.5']) expect(isNumber(v)).toBe(false);
	});

	it('IMP-35: units, hex and words are not numbers', () => {
		for (const v of ['50mm', '1.8X', '0x1F', 'NaN', 'Infinity', '5600K']) expect(isNumber(v)).toBe(false);
	});
});

describe('isDate', () => {
	it('IMP-33: a year-month-day date', () => {
		for (const v of ['2026-11-10', '2024-02-29', '1999-12-31']) expect(isDate(v)).toBe(true);
	});

	it('IMP-35: one-digit months or days are not dates', () => {
		for (const v of ['2026-1-10', '2026-11-1', '26-11-10']) expect(isDate(v)).toBe(false);
	});

	it('IMP-35: days that do not exist are not dates', () => {
		for (const v of ['2026-13-45', '2026-00-10', '2026-11-00', '2026-02-29', '2026-04-31', '1900-02-29'])
			expect(isDate(v)).toBe(false);
	});

	it('IMP-35: other date layouts are not dates', () => {
		for (const v of ['2026/11/10', '10-11-2026', '11/10/2026', '20261110']) expect(isDate(v)).toBe(false);
	});

	it('a date with a time is not a date', () => {
		expect(isDate('2026-11-10 09:30')).toBe(false);
	});
});

describe('isDateTime', () => {
	it('IMP-33: a date, a space or "T", then hours and minutes', () => {
		expect(isDateTime('2026-11-10 09:30')).toBe(true);
		expect(isDateTime('2026-11-10T23:59')).toBe(true);
	});

	it('IMP-33: optional seconds', () => {
		expect(isDateTime('2026-11-10 09:30:15')).toBe(true);
		expect(isDateTime('2026-11-10T00:00:59')).toBe(true);
	});

	it('IMP-35: a time zone after the time is not a date and time', () => {
		for (const v of ['2026-11-10T09:30Z', '2026-11-10T09:30:00+01:00', '2026-11-10 09:30 UTC'])
			expect(isDateTime(v)).toBe(false);
	});

	it('IMP-35: fractional seconds, one-digit hours and other separators are not', () => {
		for (const v of ['2026-11-10T09:30:00.123', '2026-11-10 9:30', '2026-11-10t09:30', '2026-11-10  09:30', '2026-11-10_09:30'])
			expect(isDateTime(v)).toBe(false);
	});

	it('IMP-35: times or dates that do not exist are not', () => {
		for (const v of ['2026-11-10 24:00', '2026-11-10 12:60', '2026-11-10 12:30:60', '2026-13-45 09:30'])
			expect(isDateTime(v)).toBe(false);
	});

	it('a date alone or a time alone is not a date and time', () => {
		expect(isDateTime('2026-11-10')).toBe(false);
		expect(isDateTime('09:30')).toBe(false);
	});
});

describe('guessDataType (IMP-33 to IMP-36)', () => {
	it('IMP-33: no values guess text', () => {
		expect(guessDataType([])).toBe('text');
		expect(guessDataType(['', '  '])).toBe('text');
	});

	it('IMP-33: true, false, yes and no in any case guess checkbox', () => {
		expect(guessDataType(['TRUE', 'false', ' Yes ', 'no'])).toBe('checkbox');
	});

	it('IMP-34: a column of 0 and 1 guesses number, never checkbox', () => {
		expect(guessDataType(['0', '1', '1', '0'])).toBe('number');
	});

	it('IMP-33: dates with a time guess date_time', () => {
		expect(guessDataType(['2026-11-10 09:30', '2026-11-11T10:45:00'])).toBe('date_time');
	});

	it('IMP-33: dates guess date', () => {
		expect(guessDataType(['2026-11-10', '2026-11-11'])).toBe('date');
	});

	it('IMP-35: dates mixed with dates and times guess text', () => {
		expect(guessDataType(['2026-11-10', '2026-11-11 09:30'])).toBe('text');
	});

	it('IMP-36: whole numbers guess number', () => {
		expect(guessDataType(['24', '25', '-3'])).toBe('number');
	});

	it('IMP-36: any decimal value guesses float', () => {
		expect(guessDataType(['2.8', '2.3', '2'])).toBe('float');
		expect(guessDataType(['24', '2.0'])).toBe('float');
	});

	it('IMP-35: one misfit drops to text', () => {
		expect(guessDataType(['24', '25', 'n/a'])).toBe('text');
		expect(guessDataType(['true', 'false', 'maybe'])).toBe('text');
		expect(guessDataType(['2026-11-10', '2026-13-45'])).toBe('text');
	});

	it('IMP-35: booleans mixed with 0 and 1 guess text', () => {
		expect(guessDataType(['true', '0'])).toBe('text');
	});

	it('IMP-33: blanks are dropped before guessing', () => {
		expect(guessDataType(['', ' 24 ', '   ', '25'])).toBe('number');
	});

	it('IMP-33: only the first 20 kept values count', () => {
		const values = [...Array.from({ length: 20 }, () => '7'), 'not a number'];
		expect(guessDataType(values)).toBe('number');
		expect(guessDataType(['', ...values])).toBe('number');
		expect(guessDataType([...Array.from({ length: 19 }, () => '7'), 'x'])).toBe('text');
	});

	it('the FlowStudioDemo camera report columns guess as their field sets say', () => {
		// Values from fixtures/source/FlowStudioDemo.xlsx; types from fixtures/field-sets.
		expect(guessDataType(['24', '24', '24', '24', '24'])).toBe('number'); // Tk FPS
		expect(guessDataType(['2.8', '2.8', '2.3', '2.8', '2.8'])).toBe('float'); // Lens::Maximum Aperture
		expect(guessDataType(['+5', '-10', '+5', '+5', '+5'])).toBe('text'); // Tk Camera Tilt
		expect(guessDataType(['1.8X', '1.8X'])).toBe('text'); // Lens::Anamorphic Desqueeze Ratio
		expect(guessDataType(['Tk05', 'Tk06'])).toBe('text'); // Tk Take
		expect(guessDataType(['2\'9"', '3\''])).toBe('text'); // Tk Lens Height
	});
});
