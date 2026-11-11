/**
 * CSV text to a header row and data rows (IMP-37 to IMP-41).
 *
 * Text in, value out. Reading the file and the size cap (IMP-3) are the dialog's job.
 *
 * Rules where the spec leaves room:
 * - Line breaks: LF, CRLF and a lone CR all end a line. Inside a quoted value they are kept as read.
 * - A quote opens a quoted value only as the first character of a cell, as in RFC 4180 and Excel.
 *   Elsewhere it is literal. Text after a closing quote is appended to the value. An unclosed quote
 *   runs to the end of the file.
 * - A line is blank, and dropped, when outside quotes it holds only whitespace and the characters
 *   comma, semicolon and tab, and every quoted value in it is empty or whitespace. The rule is the
 *   same whatever the separator, so detection and parsing agree on which line is the header.
 * - Headers are trimmed. Data cells are returned as read, untrimmed: the type guesser trims (IMP-33).
 * - The separator is the one of comma, semicolon and tab found most often outside quotes on the
 *   header line. Ties go to comma, then semicolon, then tab. None at all means comma.
 * - Text holding a NUL character is a binary file: `unreadable` (IMP-4). No header row: `no-header`
 *   (IMP-5).
 */
import type { TableResult } from './table';

export type Separator = ',' | ';' | '\t';

export interface CsvOptions {
	/** Keep at most this many data rows. Blank lines dropped do not count. Default: all. */
	maxRows?: number;
}

const QUOTE = 34;
const CR = 13;
const LF = 10;
const COMMA = 44;
const SEMICOLON = 59;
const TAB = 9;
const BOM = 0xfeff;

/** True when a stretch of unquoted text holds something other than whitespace and separators. */
const HAS_CONTENT = /[^\s,;]/;

/** Whitespace as `HAS_CONTENT` and `trim` see it: the one rule for a blank line, in detection and in parsing. */
const SPACE = /\s/;

function isSpace(code: number): boolean {
	return code === 32 || code === TAB || SPACE.test(String.fromCharCode(code));
}

function withoutBom(text: string): string {
	return text.charCodeAt(0) === BOM ? text.slice(1) : text;
}

/** The header line's separator (IMP-41). Separators inside quoted header cells are not counted. */
export function detectSeparator(text: string): Separator {
	const body = withoutBom(text);
	const n = body.length;
	let counts = [0, 0, 0];
	let content = false;
	let cellStart = true;
	let i = 0;
	while (i < n) {
		const c = body.charCodeAt(i);
		if (cellStart && c === QUOTE) {
			i++;
			while (i < n) {
				const q = body.charCodeAt(i);
				if (q === QUOTE) {
					if (body.charCodeAt(i + 1) !== QUOTE) break;
					content = true;
					i += 2;
					continue;
				}
				if (!isSpace(q) && q !== CR && q !== LF) content = true;
				i++;
			}
			i++;
			cellStart = false;
			continue;
		}
		if (c === CR || c === LF) {
			if (content) break;
			counts = [0, 0, 0];
			cellStart = true;
			i++;
			continue;
		}
		if (c === COMMA) counts[0]++;
		else if (c === SEMICOLON) counts[1]++;
		else if (c === TAB) counts[2]++;
		else if (!isSpace(c)) content = true;
		cellStart = c === COMMA || c === SEMICOLON || c === TAB;
		i++;
	}
	if (!content) return ',';
	const [comma, semicolon, tab] = counts;
	if (comma >= semicolon && comma >= tab) return ',';
	return semicolon >= tab ? ';' : '\t';
}

/**
 * Walks the records of the text in one pass, calling `visit` for each non-blank one, in order.
 * `visit` returns false to stop early.
 */
function readRecords(text: string, separator: Separator, visit: (cells: string[]) => boolean): void {
	const n = text.length;
	const sep = separator.charCodeAt(0);
	let cells: string[] = [];
	let content = false;
	let i = 0;
	while (i < n) {
		let value: string;
		if (text.charCodeAt(i) === QUOTE) {
			let close = i + 1;
			let doubled = false;
			for (;;) {
				close = text.indexOf('"', close);
				if (close === -1 || text.charCodeAt(close + 1) !== QUOTE) break;
				doubled = true;
				close += 2;
			}
			const end = close === -1 ? n : close;
			value = text.slice(i + 1, end);
			if (doubled) value = value.replaceAll('""', '"');
			if (!content && value.trim() !== '') content = true;
			i = close === -1 ? n : close + 1;
			let k = i;
			while (k < n) {
				const c = text.charCodeAt(k);
				if (c === sep || c === CR || c === LF) break;
				k++;
			}
			if (k > i) {
				const tail = text.slice(i, k);
				value += tail;
				if (!content && HAS_CONTENT.test(tail)) content = true;
				i = k;
			}
		} else {
			let k = i;
			while (k < n) {
				const c = text.charCodeAt(k);
				if (c === sep || c === CR || c === LF) break;
				k++;
			}
			value = text.slice(i, k);
			if (!content && HAS_CONTENT.test(value)) content = true;
			i = k;
		}
		cells.push(value);

		if (i < n && text.charCodeAt(i) === sep) {
			i++;
			if (i < n) continue;
			cells.push('');
		} else if (i < n) {
			i += text.charCodeAt(i) === CR && text.charCodeAt(i + 1) === LF ? 2 : 1;
		}
		if (content && !visit(cells)) return;
		cells = [];
		content = false;
	}
}

/**
 * The header row and data rows of a CSV file's text (IMP-37 to IMP-41). The first non-blank line is
 * the header row, trimmed. Data cells come back as read. Rows keep their own length (IMP-40).
 */
export function parseCsv(text: string, options: CsvOptions = {}): TableResult {
	if (text.includes('\u0000')) return { ok: false, reason: 'unreadable' };
	const body = withoutBom(text);
	const maxRows = options.maxRows ?? Infinity;
	let headers: string[] | null = null;
	const rows: string[][] = [];
	readRecords(body, detectSeparator(body), (cells) => {
		if (headers === null) {
			headers = cells.map((cell) => cell.trim());
			return rows.length < maxRows;
		}
		rows.push(cells);
		return rows.length < maxRows;
	});
	if (headers === null) return { ok: false, reason: 'no-header' };
	return { ok: true, table: { headers, rows } };
}
