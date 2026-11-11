/**
 * A data type guessed from a column's values (IMP-33 to IMP-36).
 *
 * Rules where the spec leaves room. When unsure, text: a wrong guess costs more (IMP-35).
 * - Number: digits, an optional leading minus, an optional decimal point with digits on both
 *   sides. No plus sign, no thousands separator, no exponent, no "1." or ".5", no comma decimal.
 *   A whole part with a leading zero before more digits ("007", "01") is text, so codes keep their
 *   zeros. "0" and "0.5" are numbers.
 * - Float: any kept value holds a decimal point, even "2.0" (Q10).
 * - Date: four-digit year, two-digit month and day, separated by "-", and the day must exist
 *   (leap years counted). "2026-1-5" and "2026-13-45" are text.
 * - Date and time: such a date, one space or a capital "T", then HH:MM or HH:MM:SS, two digits
 *   each, 00:00 to 23:59:59. No fractional seconds, no time zone: those are text.
 * - Booleans: true, false, yes, no, any case. Not 0 and 1 (IMP-34), not y, n, on, off.
 */
import type { CreatableDataType } from './data-types';
import type { ParsedTable } from './table';

/** How many non-blank values the guess looks at (IMP-33). */
export const GUESS_SAMPLE_SIZE = 20;

const BOOLEAN_WORDS = new Set(['true', 'false', 'yes', 'no']);
const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** One column of a table. A row too short for the column reads as blank (IMP-40). */
export function columnValues(table: ParsedTable, column: number): string[] {
	return table.rows.map((row) => row[column] ?? '');
}

/** Trimmed, blanks dropped, the first 20 kept (IMP-33). */
export function sampleValues(values: readonly string[]): string[] {
	const kept: string[] = [];
	for (const value of values) {
		if (kept.length === GUESS_SAMPLE_SIZE) break;
		const trimmed = value.trim();
		if (trimmed !== '') kept.push(trimmed);
	}
	return kept;
}

export function isBooleanWord(value: string): boolean {
	return BOOLEAN_WORDS.has(value.toLowerCase());
}

export function isNumber(value: string): boolean {
	return NUMBER.test(value);
}

function daysInMonth(year: number, month: number): number {
	if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
	return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isDate(value: string): boolean {
	const match = DATE.exec(value);
	if (!match) return false;
	const [year, month, day] = match.slice(1).map(Number);
	return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function isDateTime(value: string): boolean {
	const match = DATE_TIME.exec(value);
	if (!match || !isDate(match[1])) return false;
	const [hours, minutes, seconds] = match.slice(2).map((part) => Number(part ?? '0'));
	return hours <= 23 && minutes <= 59 && seconds <= 59;
}

/** The guessed data type, by the table of IMP-33. */
export function guessDataType(values: readonly string[]): CreatableDataType {
	const kept = sampleValues(values);
	if (kept.length === 0) return 'text';
	if (kept.every(isBooleanWord)) return 'checkbox';
	if (kept.every(isDateTime)) return 'date_time';
	if (kept.every(isDate)) return 'date';
	if (kept.every(isNumber)) return kept.some((value) => value.includes('.')) ? 'float' : 'number';
	return 'text';
}
