import { describe, expect, it } from 'vitest';
import { readImportBanner, writeImportBanner } from './import-banner';

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

describe('import banner (IMP-50)', () => {
	it('hands the imported count to the editor of the new set, once', () => {
		const storage = memory();
		writeImportBanner('s1', 69, storage);
		expect(readImportBanner('s1', storage)).toBe(69);
		// Reading clears it: a reload of the editor shows no banner.
		expect(readImportBanner('s1', storage)).toBeNull();
		expect(storage.length).toBe(0);
	});

	it('is null for another set, and leaves the note for its own', () => {
		const storage = memory();
		expect(readImportBanner('s1', storage)).toBeNull();
		writeImportBanner('s1', 3, storage);
		expect(readImportBanner('s2', storage)).toBeNull();
		expect(readImportBanner('s1', storage)).toBe(3);
	});

	it('a newer import replaces the note', () => {
		const storage = memory();
		writeImportBanner('s1', 3, storage);
		writeImportBanner('s2', 5, storage);
		expect(readImportBanner('s1', storage)).toBeNull();
		expect(readImportBanner('s2', storage)).toBe(5);
	});

	it('an import of no fields leaves no banner', () => {
		const storage = memory();
		writeImportBanner('s1', 3, storage);
		writeImportBanner('s1', 0, storage);
		expect(readImportBanner('s1', storage)).toBeNull();
	});

	it('a count that is not a whole positive number reads as null', () => {
		const storage = memory();
		for (const count of ['"3"', '-1', '1.5', 'null']) {
			storage.setItem('sg-fields-setup:import-banner', `{"setId":"s1","importedCount":${count}}`);
			expect(readImportBanner('s1', storage)).toBeNull();
		}
	});

	it('unreadable or blocked storage is no banner, never a throw', () => {
		const storage = memory();
		storage.setItem('sg-fields-setup:import-banner', '{broken');
		expect(readImportBanner('s1', storage)).toBeNull();
		const blocked = { ...memory(), getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } as Storage;
		expect(() => writeImportBanner('s1', 3, blocked)).not.toThrow();
		expect(readImportBanner('s1', blocked)).toBeNull();
		expect(() => writeImportBanner('s1', 3, null)).not.toThrow();
		expect(readImportBanner('s1', null)).toBeNull();
	});
});
