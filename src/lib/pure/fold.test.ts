import { describe, expect, it } from 'vitest';
import { trimFold } from './fold';

describe('trimFold', () => {
	it('trims and lowercases, nothing else', () => {
		expect(trimFold('  Shot Code ')).toBe('shot code');
		expect(trimFold('Shot-Code')).toBe('shot-code');
	});

	it('leaves the Unicode form as it is', () => {
		expect(trimFold('Café')).not.toBe(trimFold('Café'));
	});
});
