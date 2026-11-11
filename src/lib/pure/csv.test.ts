import { describe, expect, it } from 'vitest';
import { detectSeparator, parseCsv } from './csv';
import type { ParsedTable } from './table';

function table(text: string, options?: { maxRows?: number }): ParsedTable {
	const result = parseCsv(text, options);
	if (!result.ok) throw new Error(`expected a table, got ${result.reason}`);
	return result.table;
}

describe('parseCsv: values (IMP-37)', () => {
	it('splits on commas', () => {
		expect(table('a,b,c\n1,2,3\n')).toEqual({ headers: ['a', 'b', 'c'], rows: [['1', '2', '3']] });
	});

	it('keeps commas and line breaks inside quoted values', () => {
		expect(table('a,b\n"x,y","line 1\nline 2"\n').rows).toEqual([['x,y', 'line 1\nline 2']]);
	});

	it('keeps a CRLF inside a quoted value as read', () => {
		expect(table('a\r\n"one\r\ntwo"\r\n').rows).toEqual([['one\r\ntwo']]);
	});

	it('reads a doubled quote inside a quoted value as one quote', () => {
		expect(table('a,b\n"say ""hi""",""""\n').rows).toEqual([['say "hi"', '"']]);
	});

	it('reads an empty quoted value as blank', () => {
		expect(table('a,b,c\n"",x,""\n').rows).toEqual([['', 'x', '']]);
	});

	it('keeps a quote inside an unquoted value literally', () => {
		expect(table('a,b\n5" disk,ab"c\n').rows).toEqual([['5" disk', 'ab"c']]);
	});

	it('keeps a quote after leading spaces literally, as Excel does', () => {
		expect(table('a,b\n1, "x"\n').rows).toEqual([['1', ' "x"']]);
	});

	it('appends text after a closing quote to the value', () => {
		expect(table('a\n"ab"cd\n').rows).toEqual([['abcd']]);
	});

	it('reads an unclosed quote to the end of the file', () => {
		expect(table('a,b\n1,"open\n2,3\n').rows).toEqual([['1', 'open\n2,3\n']]);
	});

	it('accepts LF, CRLF and lone CR line endings alike', () => {
		const expected = { headers: ['a', 'b'], rows: [['1', '2'], ['3', '4']] };
		expect(table('a,b\n1,2\n3,4\n')).toEqual(expected);
		expect(table('a,b\r\n1,2\r\n3,4\r\n')).toEqual(expected);
		expect(table('a,b\r1,2\r3,4\r')).toEqual(expected);
		expect(table('a,b\r\n1,2\n3,4\r')).toEqual(expected);
	});

	it('ignores a byte-order mark at the start', () => {
		expect(table('﻿name,code\nx,1\n').headers).toEqual(['name', 'code']);
	});

	it('keeps a byte-order mark anywhere else as read', () => {
		expect(table('a\n﻿x\n').rows).toEqual([['﻿x']]);
	});

	it('returns data cells untrimmed: the type guesser trims (IMP-33)', () => {
		expect(table('a,b\n  1 , x\t\n').rows).toEqual([['  1 ', ' x\t']]);
	});
});

describe('parseCsv: blank lines (IMP-38)', () => {
	it('drops empty lines anywhere', () => {
		expect(table('\n\na,b\n\n1,2\n\n\n3,4\n\n')).toEqual({ headers: ['a', 'b'], rows: [['1', '2'], ['3', '4']] });
	});

	it('drops lines of only whitespace', () => {
		expect(table('a,b\n   \n\t\n1,2\n').rows).toEqual([['1', '2']]);
	});

	it('drops lines of only separators and whitespace', () => {
		expect(table('a,b\n,\n , \n1,2\n').rows).toEqual([['1', '2']]);
	});

	it('drops lines whose cells are all blank, quoted or not', () => {
		expect(table('a,b\n"",""\n" ",\n1,2\n').rows).toEqual([['1', '2']]);
	});

	it('keeps a line with one non-blank cell', () => {
		expect(table('a,b\n,x\n').rows).toEqual([['', 'x']]);
	});

	it('parses a file without a final line break the same', () => {
		expect(table('a,b\n1,2')).toEqual(table('a,b\n1,2\n'));
		expect(table('a,b\r\n1,2')).toEqual(table('a,b\r\n1,2\r\n'));
		expect(table('a,b\n1,"2"')).toEqual(table('a,b\n1,"2"\n'));
	});

	it('keeps a trailing empty cell before the final line break', () => {
		expect(table('a,b\n1,\n').rows).toEqual([['1', '']]);
		expect(table('a,b\n1,').rows).toEqual([['1', '']]);
	});
});

describe('parseCsv: header row (IMP-39, IMP-5)', () => {
	it('takes the first non-blank line as the header row', () => {
		expect(table('\n , \n\nname,code\nx,1\n').headers).toEqual(['name', 'code']);
	});

	it('trims headers', () => {
		expect(table('  name ,\tcode\t," quoted "\n').headers).toEqual(['name', 'code', 'quoted']);
	});

	it('keeps blank headers as empty strings so columns line up (IMP-32)', () => {
		expect(table('a,,c, \n1,2,3,4\n').headers).toEqual(['a', '', 'c', '']);
	});

	it('returns a header with no data rows', () => {
		expect(table('a,b')).toEqual({ headers: ['a', 'b'], rows: [] });
	});

	it('reports no header for an empty file', () => {
		expect(parseCsv('')).toEqual({ ok: false, reason: 'no-header' });
	});

	it('reports no header for a file of only a byte-order mark', () => {
		expect(parseCsv('﻿')).toEqual({ ok: false, reason: 'no-header' });
	});

	it('reports no header for a file of only blank lines', () => {
		expect(parseCsv('\n\r\n  \n,,,\n;;\n\t\t\n""\n')).toEqual({ ok: false, reason: 'no-header' });
	});
});

describe('parseCsv: unreadable text (IMP-4)', () => {
	it('reports unreadable for text holding a NUL character, the mark of a binary file', () => {
		expect(parseCsv('PK\u0003\u0004\u0000\u0000junk')).toEqual({ ok: false, reason: 'unreadable' });
	});
});

describe('parseCsv: ragged rows (IMP-40)', () => {
	it('keeps rows shorter and longer than the header as they are', () => {
		expect(table('a,b,c\n1\n1,2,3,4,5\n1,2\n').rows).toEqual([['1'], ['1', '2', '3', '4', '5'], ['1', '2']]);
	});
});

describe('parseCsv: separators (IMP-41, Q11)', () => {
	it('detects a semicolon header and parses the file with it', () => {
		expect(table('name;code\n"a;b";1,5\n')).toEqual({ headers: ['name', 'code'], rows: [['a;b', '1,5']] });
	});

	it('detects a tab header and parses the file with it', () => {
		expect(table('name\tcode\n"a\tb"\t1,5\n')).toEqual({ headers: ['name', 'code'], rows: [['a\tb', '1,5']] });
	});

	it('applies the comma rules to other separators: quotes, blank lines, ragged rows', () => {
		expect(table('\n a ;b\n;\n"x ""y""";"1\n2";extra\n')).toEqual({
			headers: ['a', 'b'],
			rows: [['x "y"', '1\n2', 'extra']]
		});
	});

	it('is not fooled by separators inside quoted header cells', () => {
		expect(detectSeparator('"a;b;c;d","e;f"')).toBe(',');
		expect(detectSeparator('"x,y,z";"w"')).toBe(';');
		expect(detectSeparator('"x,y;z"\t"w"')).toBe('\t');
	});

	it('detects from the header line only, not the data', () => {
		expect(table('a;b\n1,2,3,4\n').rows).toEqual([['1,2,3,4']]);
	});

	it('IMP-38, IMP-41: detection and parsing agree on a blank line, whatever kind of space it holds', () => {
		// An em space alone on the first line: blank for the parser, so blank for the detection too.
		expect(parseCsv('\u2003\nName;Type\nx;y\n')).toEqual({ ok: true, table: { headers: ['Name', 'Type'], rows: [['x', 'y']] } });
		for (const space of ['\u1680', '\u2000', '\u2003', '\u200a', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff', '\u00a0', '\u000b', '\u000c', ' ', '\t']) {
			const label = `U+${space.charCodeAt(0).toString(16)}`;
			expect(detectSeparator(`,${space},\nA;B\n`), label).toBe(';');
			expect(detectSeparator(`"${space}"\nA\tB\n`), label).toBe('\t');
			expect(parseCsv(`${space}\n"${space}",${space}\nA;B\n1;2\n`), label).toEqual({ ok: true, table: { headers: ['A', 'B'], rows: [['1', '2']] } });
		}
		// A character that is no space is content in both: that line is the header.
		expect(parseCsv('\u200b\nName;Type\n')).toMatchObject({ ok: true, table: { headers: ['\u200b'], rows: [['Name;Type']] } });
	});

	it('detects from the first non-blank line', () => {
		expect(detectSeparator('\n,,\n\na;b\n')).toBe(';');
	});

	it('detects across a quoted line break in the header', () => {
		expect(detectSeparator('"a\nb";c;d\n1,2,3,4,5,6\n')).toBe(';');
	});

	it('picks the separator that splits the header into the most cells', () => {
		expect(detectSeparator('a;b;c,d\n')).toBe(';');
		expect(detectSeparator('a\tb\tc;d,e\n')).toBe('\t');
	});

	it('breaks ties as comma, then semicolon, then tab', () => {
		expect(detectSeparator('a,b;c\n')).toBe(',');
		expect(detectSeparator('a;b\tc\n')).toBe(';');
		expect(detectSeparator('single\n')).toBe(',');
		expect(detectSeparator('')).toBe(',');
	});
});

describe('parseCsv: sample (maxRows)', () => {
	it('keeps only the first N data rows', () => {
		expect(table('a\n1\n2\n3\n4\n', { maxRows: 2 }).rows).toEqual([['1'], ['2']]);
	});

	it('does not count dropped blank lines', () => {
		expect(table('a\n\n1\n,\n2\n3\n', { maxRows: 2 }).rows).toEqual([['1'], ['2']]);
	});

	it('returns the header alone for maxRows 0', () => {
		expect(table('a\n1\n', { maxRows: 0 })).toEqual({ headers: ['a'], rows: [] });
	});

	it('keeps every row when there are fewer than N', () => {
		expect(table('a\n1\n', { maxRows: 20 }).rows).toEqual([['1']]);
	});
});

describe('parseCsv: size', () => {
	it('parses a 15 MB file of 2.2 million cells in linear time', () => {
		const header = Array.from({ length: 10 }, (_, i) => `col ${i}`).join(',');
		const line = '"quoted, value",plain,12345,"say ""hi""",,2024-01-02,x,y,z,"multi\nline"';
		const rowCount = 220_000;
		const text = header + '\r\n' + Array(rowCount).fill(line).join('\r\n') + '\r\n';
		const started = performance.now();
		const result = table(text);
		const elapsed = performance.now() - started;
		expect(text.length).toBeGreaterThan(15 * 1024 * 1024);
		expect(result.rows).toHaveLength(rowCount);
		expect(result.rows[rowCount - 1]).toEqual([
			'quoted, value',
			'plain',
			'12345',
			'say "hi"',
			'',
			'2024-01-02',
			'x',
			'y',
			'z',
			'multi\nline'
		]);
		expect(elapsed).toBeLessThan(2000);
	});

	it('stops early with maxRows on a large file', () => {
		const text = 'a,b\n' + '1,2\n'.repeat(1_000_000);
		const started = performance.now();
		expect(table(text, { maxRows: 20 }).rows).toHaveLength(20);
		expect(performance.now() - started).toBeLessThan(200);
	});
});
