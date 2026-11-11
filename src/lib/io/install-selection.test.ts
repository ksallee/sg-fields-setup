import { describe, expect, it } from 'vitest';
import { readInstallSelection, writeInstallSelection } from './install-selection';

function memory(): Storage {
	const map = new Map<string, string>();
	return {
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => void map.set(key, value),
		removeItem: (key: string) => void map.delete(key),
		clear: () => map.clear(),
		key: () => null,
		get length() {
			return map.size;
		}
	};
}

describe('install selection (EDT-10, PLN-1)', () => {
	it('hands the selected entry ids to the install screen of the same set', () => {
		const storage = memory();
		writeInstallSelection('s1', ['e1', 'e2'], storage);
		expect(readInstallSelection('s1', storage)).toEqual(['e1', 'e2']);
		// Still there after a reload of the install screen.
		expect(readInstallSelection('s1', storage)).toEqual(['e1', 'e2']);
	});

	it('is null for another set, and when nothing was handed over', () => {
		const storage = memory();
		expect(readInstallSelection('s1', storage)).toBeNull();
		writeInstallSelection('s1', ['e1'], storage);
		expect(readInstallSelection('s2', storage)).toBeNull();
	});

	it('an empty selection clears it', () => {
		const storage = memory();
		writeInstallSelection('s1', ['e1'], storage);
		writeInstallSelection('s1', [], storage);
		expect(readInstallSelection('s1', storage)).toBeNull();
	});

	it('unreadable or blocked storage is no selection, never a throw', () => {
		const storage = memory();
		storage.setItem('sg-fields-setup:install-selection', '{broken');
		expect(readInstallSelection('s1', storage)).toBeNull();
		const blocked = { ...memory(), getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } as Storage;
		expect(() => writeInstallSelection('s1', ['e1'], blocked)).not.toThrow();
		expect(readInstallSelection('s1', blocked)).toBeNull();
	});
});
