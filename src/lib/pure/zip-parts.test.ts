import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ZipError, ZipPartReader, zipDirectory } from './zip-parts';

const MB = 1024 * 1024;

function spaces(bytes: number, head = ''): Uint8Array {
	const out = new Uint8Array(bytes).fill(0x20);
	out.set(strToU8(head), 0);
	return out;
}

describe('zipDirectory', () => {
	it('lists each entry with its declared sizes, and inflates nothing', () => {
		const zip = zipSync({ 'a.txt': strToU8('hello'), 'dir/b.xml': spaces(2 * MB, '<x/>') }, { level: 9 });
		const entries = zipDirectory(zip);
		expect([...entries.keys()]).toEqual(['a.txt', 'dir/b.xml']);
		expect(entries.get('a.txt')?.size).toBe(5);
		expect(entries.get('dir/b.xml')?.size).toBe(2 * MB);
		expect(entries.get('dir/b.xml')!.compressedSize).toBeLessThan(10_000);
	});

	it('refuses bytes that are no zip', () => {
		expect(() => zipDirectory(strToU8('not a zip at all, but long enough to hold a directory'))).toThrow(ZipError);
		expect(() => zipDirectory(new Uint8Array(0))).toThrow(ZipError);
	});

	it('refuses a directory cut short', () => {
		const zip = zipSync({ 'a.txt': strToU8('hello') });
		const cut = zip.slice(0, zip.length - 30);
		expect(() => zipDirectory(cut)).toThrow(ZipError);
	});
});

describe('ZipPartReader', () => {
	it('reads a deflated part whole', () => {
		const zip = zipSync({ 'a.txt': strToU8('hello '.repeat(1000)) }, { level: 9 });
		const reader = new ZipPartReader(zip, zipDirectory(zip).get('a.txt')!);
		reader.fill(Infinity);
		expect(reader.done).toBe(true);
		expect(new TextDecoder().decode(reader.bytes())).toBe('hello '.repeat(1000));
	});

	it('reads a stored part whole', () => {
		const zip = zipSync({ 'a.txt': strToU8('hello') }, { level: 0 });
		const reader = new ZipPartReader(zip, zipDirectory(zip).get('a.txt')!);
		reader.fill(1);
		expect(reader.done).toBe(true);
		expect(new TextDecoder().decode(reader.bytes())).toBe('hello');
	});

	it('stops near the target and goes on from there', () => {
		const zip = zipSync({ 'big.xml': spaces(100 * MB, '<head/>') }, { level: 9 });
		const reader = new ZipPartReader(zip, zipDirectory(zip).get('big.xml')!);
		reader.fill(1 * MB);
		expect(reader.done).toBe(false);
		// One 16 KB slice of deflate holds 17 MB at most.
		expect(reader.size).toBeGreaterThanOrEqual(1 * MB);
		expect(reader.size).toBeLessThan(20 * MB);
		expect(new TextDecoder().decode(reader.bytes().subarray(0, 7))).toBe('<head/>');
		const before = reader.size;
		reader.fill(before + 1);
		expect(reader.size).toBeGreaterThan(before);
	});

	it('reports every byte as it comes out, so a caller can stop it', () => {
		const zip = zipSync({ 'big.xml': spaces(100 * MB) }, { level: 9 });
		let seen = 0;
		const reader = new ZipPartReader(zip, zipDirectory(zip).get('big.xml')!, (added, total) => {
			seen += added;
			expect(total).toBe(seen);
			if (total > 30 * MB) throw new Error('enough');
		});
		expect(() => reader.fill(Infinity)).toThrow('enough');
		expect(seen).toBeLessThan(50 * MB);
	});

	it('refuses a part that inflates past the size its header declares', () => {
		const zip = zipSync({ 'big.xml': spaces(40 * MB) }, { level: 9 });
		const entry = zipDirectory(zip).get('big.xml')!;
		const reader = new ZipPartReader(zip, { ...entry, size: 1000 });
		expect(() => reader.fill(Infinity)).toThrow(ZipError);
		expect(reader.size).toBeLessThan(20 * MB);
	});

	it('refuses a compression it does not read, and a damaged stream', () => {
		const zip = zipSync({ 'a.txt': strToU8('hello '.repeat(1000)) }, { level: 9 });
		const entry = zipDirectory(zip).get('a.txt')!;
		expect(() => new ZipPartReader(zip, { ...entry, method: 12 }).fill(Infinity)).toThrow(ZipError);
		const damaged = zip.slice();
		damaged.fill(0xff, entry.offset + 40, entry.offset + 60);
		expect(() => new ZipPartReader(damaged, entry).fill(Infinity)).toThrow();
	});
});
