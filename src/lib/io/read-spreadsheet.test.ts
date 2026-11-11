import { describe, expect, it } from 'vitest';
import { decodeText, readSpreadsheet, type ReadableFile } from './read-spreadsheet';

/** A file that counts its reads, with a size that need not match its bytes. */
function file(name: string, bytes: Uint8Array, size = bytes.length): ReadableFile & { reads: number } {
	return {
		name,
		size,
		reads: 0,
		arrayBuffer() {
			this.reads += 1;
			return Promise.resolve(bytes.slice().buffer);
		}
	};
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('reading a dropped file (IMP-2 to IMP-4)', () => {
	it('a CSV is read as text', async () => {
		expect(await readSpreadsheet(file('shots.CSV', utf8('Code,Durée\n')))).toEqual({
			ok: true,
			content: { kind: 'csv', text: 'Code,Durée\n' }
		});
	});

	it('a workbook is read as bytes', async () => {
		const bytes = new Uint8Array([80, 75, 3, 4]);
		expect(await readSpreadsheet(file('report.xlsx', bytes))).toEqual({ ok: true, content: { kind: 'xlsx', bytes } });
	});

	it('IMP-2: another kind of file is refused unread', async () => {
		const notes = file('notes.txt', utf8('hello'));
		expect(await readSpreadsheet(notes)).toEqual({ ok: false, problem: 'unsupported' });
		expect(notes.reads).toBe(0);
	});

	it('IMP-3: a file over the cap is refused before it is read', async () => {
		const big = file('big.csv', utf8('A\n'), 15 * 1024 * 1024 + 1);
		expect(await readSpreadsheet(big)).toEqual({ ok: false, problem: 'too-large' });
		expect(big.reads).toBe(0);
		const atCap = file('fine.csv', utf8('A\n'), 15 * 1024 * 1024);
		expect((await readSpreadsheet(atCap)).ok).toBe(true);
		expect(await readSpreadsheet(file('small.csv', utf8('A,B\n')), 2)).toEqual({ ok: false, problem: 'too-large' });
	});

	it('IMP-4: a file the browser cannot read is unreadable', async () => {
		const gone: ReadableFile = { name: 'gone.csv', size: 1, arrayBuffer: () => Promise.reject(new Error('NotFoundError')) };
		expect(await readSpreadsheet(gone)).toEqual({ ok: false, problem: 'unreadable' });
	});
});

describe('CSV text encodings', () => {
	it('UTF-8, with or without a byte-order mark, is kept as it is for the parser (IMP-37)', () => {
		expect(decodeText(utf8('Durée'))).toBe('Durée');
		expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe('﻿A');
	});

	it('bytes that are not UTF-8 read as Windows-1252, as a spreadsheet app in Europe saves a CSV', () => {
		// "Durée;Été" in Windows-1252.
		const bytes = new Uint8Array([0x44, 0x75, 0x72, 0xe9, 0x65, 0x3b, 0xc9, 0x74, 0xe9]);
		expect(decodeText(bytes)).toBe('Durée;Été');
	});

	it('UTF-16 with a byte-order mark is read, as a spreadsheet app saves "Unicode text"', () => {
		expect(decodeText(new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0xe9, 0x00]))).toBe('Aé');
		expect(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x41, 0x00, 0xe9]))).toBe('Aé');
	});
});
