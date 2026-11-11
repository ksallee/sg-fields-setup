import { describe, expect, it } from 'vitest';
import { commaListText, linesText, parseCommaList, parseLines, sameItems } from './list-text';

describe('valid values as lines (EDT-28)', () => {
	it('EDT-28: one value per line, lines trimmed, blanks dropped', () => {
		expect(parseLines(' 35mm \n\n50mm\r\n   \n85mm')).toEqual(['35mm', '50mm', '85mm']);
		expect(parseLines('')).toEqual([]);
	});

	it('EDT-28: order and repeats are kept', () => {
		expect(parseLines('b\na\nb')).toEqual(['b', 'a', 'b']);
	});

	it('EDT-28: a list reads back one value per line', () => {
		expect(linesText(['35mm', '50mm'])).toBe('35mm\n50mm');
		expect(parseLines(linesText(['a', 'b']))).toEqual(['a', 'b']);
	});
});

describe('valid types as a comma-separated list (EDT-27)', () => {
	it('EDT-27: split on commas, trimmed, blanks dropped', () => {
		expect(parseCommaList(' Shot, Asset ,,CustomEntity01 ')).toEqual(['Shot', 'Asset', 'CustomEntity01']);
		expect(parseCommaList('  ')).toEqual([]);
	});

	it('EDT-27: a list reads back with a comma and a space', () => {
		expect(commaListText(['Shot', 'Asset'])).toBe('Shot, Asset');
	});
});

describe('sameItems', () => {
	it('is true for the same items in the same order only', () => {
		expect(sameItems(['a', 'b'], ['a', 'b'])).toBe(true);
		expect(sameItems(['a', 'b'], ['b', 'a'])).toBe(false);
		expect(sameItems(['a'], ['a', 'b'])).toBe(false);
	});
});
