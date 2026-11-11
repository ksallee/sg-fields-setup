import { describe, expect, it } from 'vitest';
import { copyName, setNameKey } from './copy-name';

describe('setNameKey', () => {
	it('MOD-1, MOD-2: ignores surrounding spaces and case', () => {
		expect(setNameKey('  Camera Report ')).toBe(setNameKey('camera report'));
	});

	it('MOD-2: ignores how an accent is encoded', () => {
		expect(setNameKey('Caméra')).toBe(setNameKey('Caméra'));
	});

	it('MOD-2: keeps inner spaces and punctuation', () => {
		expect(setNameKey('Camera  report')).not.toBe(setNameKey('Camera report'));
		expect(setNameKey('Camera-report')).not.toBe(setNameKey('Camera report'));
	});
});

describe('copyName', () => {
	it('SET-18: adds the suffix', () => {
		expect(copyName('Lens', [])).toBe('Lens copy');
		expect(copyName('Lens', ['Lens'])).toBe('Lens copy');
	});

	it('SET-20, Q9: takes the next free number, from 2', () => {
		expect(copyName('Lens', ['Lens', 'Lens copy'])).toBe('Lens copy 2');
		expect(copyName('Lens', ['Lens', 'Lens copy', 'Lens copy 2'])).toBe('Lens copy 3');
	});

	it('SET-20: fills the first gap', () => {
		expect(copyName('Lens', ['Lens copy', 'Lens copy 3'])).toBe('Lens copy 2');
	});

	it('SET-20, MOD-2: a taken name counts whatever its case or padding', () => {
		expect(copyName('Lens', ['LENS COPY', ' lens copy 2 '])).toBe('Lens copy 3');
	});

	it('SET-18: a copy of a copy is suffixed again, never renumbered', () => {
		expect(copyName('Lens copy', ['Lens', 'Lens copy'])).toBe('Lens copy copy');
		expect(copyName('Lens copy 2', [])).toBe('Lens copy 2 copy');
	});

	it('MOD-1: trims the name it copies', () => {
		expect(copyName('  Lens ', [])).toBe('Lens copy');
	});

	it('SET-20: takes any iterable of names', () => {
		expect(copyName('Lens', new Set(['Lens copy']))).toBe('Lens copy 2');
	});
});
