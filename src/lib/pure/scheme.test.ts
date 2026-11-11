import { describe, expect, it } from 'vitest';
import { resolveDark } from './scheme';

describe('resolveDark', () => {
	it('follows an explicit pick whatever the system says', () => {
		expect(resolveDark('dark', false)).toBe(true);
		expect(resolveDark('light', true)).toBe(false);
	});

	it('follows the system in system mode', () => {
		expect(resolveDark('system', true)).toBe(true);
		expect(resolveDark('system', false)).toBe(false);
	});
});
