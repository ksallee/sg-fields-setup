import { describe, expect, it } from 'vitest';
import { isRecord } from './is-record';

describe('isRecord', () => {
	it('is true for a plain object', () => {
		expect(isRecord({})).toBe(true);
		expect(isRecord({ a: 1 })).toBe(true);
	});

	it('is false for null, an array and every primitive', () => {
		for (const value of [null, undefined, [], [1], 'a', 1, true]) expect(isRecord(value)).toBe(false);
	});
});
