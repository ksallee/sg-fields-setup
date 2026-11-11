import { describe, expect, it } from 'vitest';
import { commaListText, parseCommaList, sameItems } from './list-text';

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
