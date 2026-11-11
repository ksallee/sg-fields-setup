import { describe, expect, it } from 'vitest';
import { HOME_PATH, installPath, setPath } from './routes';

describe('routes', () => {
	it('the list is the home page', () => {
		expect(HOME_PATH).toBe('/');
	});

	it('SET-3 the editor of a set', () => {
		expect(setPath('a1')).toBe('/sets/a1');
		expect(setPath('a/b c')).toBe('/sets/a%2Fb%20c');
	});

	it('EDT-10 the install of a whole set, or of the selection handed over', () => {
		expect(installPath('a1')).toBe('/sets/a1/install');
		expect(installPath('a1', { selection: true })).toBe('/sets/a1/install?selection=1');
	});
});
