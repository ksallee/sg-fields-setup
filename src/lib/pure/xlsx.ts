/**
 * Read an XLSX workbook's headers and a sample of rows, read-only (IMP-42 to IMP-47, IMP-6).
 *
 * Bytes in, sheets out. Only the parts needed are unzipped: the package relationships, the
 * workbook, its relationships, the shared strings and the sheets. The XML is read by a small
 * scanner over the few elements that matter; namespace prefixes are ignored.
 *
 * Rules where the spec leaves room:
 * - The header row is the first row with a non-blank cell. Blank rows above it are skipped, so a
 *   blank first row followed by a header reads the same as a header in row 1.
 * - Trailing blank headers are dropped; blank headers between others stay as ''.
 * - Fully blank data rows are dropped, as CSV drops blank lines (IMP-38). They do not count toward
 *   the sample.
 * - Data values are kept as read, untrimmed. Headers are trimmed.
 * - Hidden sheets are read like any other.
 * - A damaged workbook (a listed part missing, a shared string index out of range) is unreadable.
 * - Date cells stay serial numbers (IMP-46, kept on purpose).
 */
import { strFromU8, unzipSync } from 'fflate';
import type { ParsedTable } from './table';

export const DEFAULT_SAMPLE_SIZE = 50;

export interface XlsxOptions {
	/** Data rows read per sheet after the header row. Default 50 (IMP-45). */
	sampleSize?: number;
}

/** One worksheet with a header row, as a parsed table. */
export interface WorkbookSheet {
	name: string;
	table: ParsedTable;
}

export type WorkbookResult = { ok: true; sheets: WorkbookSheet[] } | { ok: false; reason: 'no-header' | 'unreadable' };

class Unreadable extends Error {}

export function readXlsx(bytes: Uint8Array, options: XlsxOptions = {}): WorkbookResult {
	const sampleSize = Math.max(0, Math.floor(options.sampleSize ?? DEFAULT_SAMPLE_SIZE));
	try {
		const sheets = readSheets(bytes, sampleSize);
		return sheets.length > 0 ? { ok: true, sheets } : { ok: false, reason: 'no-header' };
	} catch {
		return { ok: false, reason: 'unreadable' };
	}
}

function readSheets(bytes: Uint8Array, sampleSize: number): WorkbookSheet[] {
	const pkgRels = parseRels(part(unzip(bytes, ['_rels/.rels']), '_rels/.rels'), '');
	const workbookPath = pkgRels.find((r) => r.type.endsWith('/officeDocument'))?.target ?? 'xl/workbook.xml';
	const workbookRelsPath = relsPathOf(workbookPath);

	const top = unzip(bytes, [workbookPath, workbookRelsPath]);
	const listed = parseWorkbook(part(top, workbookPath));
	const rels = parseRels(part(top, workbookRelsPath), dirOf(workbookPath));

	const sheetPaths = listed.map(({ relId }) => {
		const rel = rels.find((r) => r.id === relId);
		if (!rel) throw new Unreadable(`no relationship ${relId}`);
		return rel.target;
	});
	const sstPath = rels.find((r) => r.type.endsWith('/sharedStrings'))?.target;

	const parts = unzip(bytes, sstPath ? [...sheetPaths, sstPath] : sheetPaths);
	const shared = sstPath && parts[sstPath] ? parseSharedStrings(text(parts[sstPath])) : [];

	const sheets: WorkbookSheet[] = [];
	listed.forEach(({ name }, i) => {
		const table = parseSheet(part(parts, sheetPaths[i]), shared, sampleSize);
		if (table) sheets.push({ name, table });
	});
	return sheets;
}

// ---------------------------------------------------------------------------------------------
// Zip parts

function unzip(bytes: Uint8Array, names: string[]): Record<string, Uint8Array> {
	const wanted = new Set(names);
	return unzipSync(bytes, { filter: (file) => wanted.has(file.name) });
}

function part(parts: Record<string, Uint8Array>, name: string): string {
	const data = parts[name];
	if (!data) throw new Unreadable(`missing ${name}`);
	return text(data);
}

/** A part as text, BOM dropped and line ends normalized as XML 1.0 requires (§2.11). */
function text(data: Uint8Array): string {
	const s = strFromU8(data).replace(/\r\n?/g, '\n');
	return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function dirOf(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash < 0 ? '' : path.slice(0, slash + 1);
}

function relsPathOf(path: string): string {
	const dir = dirOf(path);
	return `${dir}_rels/${path.slice(dir.length)}.rels`;
}

/** A relationship target resolved against the source part's folder, as a zip path. */
function resolvePath(base: string, target: string): string {
	const segments = target.startsWith('/') ? [] : base.split('/').filter(Boolean);
	for (const seg of target.split('/')) {
		if (seg === '..') segments.pop();
		else if (seg && seg !== '.') segments.push(seg);
	}
	return segments.join('/');
}

// ---------------------------------------------------------------------------------------------
// Package parts

interface Rel {
	id: string;
	type: string;
	target: string;
}

function parseRels(xml: string, base: string): Rel[] {
	const rels: Rel[] = [];
	for (const tok of tokens(xml)) {
		if (tok.kind !== 'open' || tok.name !== 'Relationship') continue;
		const a = attributes(tok.attrs);
		if (a.TargetMode === 'External' || !a.Id || !a.Target) continue;
		rels.push({ id: a.Id, type: a.Type ?? '', target: resolvePath(base, a.Target) });
	}
	return rels;
}

/** The workbook's sheets in workbook order (IMP-42). */
function parseWorkbook(xml: string): { name: string; relId: string }[] {
	const sheets: { name: string; relId: string }[] = [];
	for (const tok of tokens(xml)) {
		if (tok.kind !== 'open' || tok.name !== 'sheet') continue;
		const a = attributes(tok.attrs);
		if (a.id === undefined) throw new Unreadable('sheet without a relationship');
		sheets.push({ name: a.name ?? '', relId: a.id });
	}
	return sheets;
}

/** Shared strings: rich text runs concatenated, phonetic runs ignored (IMP-43). */
function parseSharedStrings(xml: string): string[] {
	const strings: string[] = [];
	const collect = new TextCollector();
	for (const tok of tokens(xml)) {
		if (tok.kind === 'open' && tok.name === 'si') {
			collect.reset();
			if (tok.empty) strings.push('');
		} else if (tok.kind === 'close' && tok.name === 'si') {
			strings.push(collect.value());
		} else {
			collect.feed(tok);
		}
	}
	return strings;
}

/** Gathers the text of <t> elements, skipping phonetic runs (<rPh>). */
class TextCollector {
	private parts: string[] = [];
	private inT = false;
	private phonetic = 0;

	reset() {
		this.parts = [];
		this.inT = false;
		this.phonetic = 0;
	}

	feed(tok: Token) {
		if (tok.kind === 'open') {
			if (tok.name === 'rPh' && !tok.empty) this.phonetic++;
			else if (tok.name === 't' && !tok.empty) this.inT = true;
		} else if (tok.kind === 'close') {
			if (tok.name === 'rPh') this.phonetic = Math.max(0, this.phonetic - 1);
			else if (tok.name === 't') this.inT = false;
		} else if (this.inT && this.phonetic === 0) {
			this.parts.push(tok.cdata ? tok.text : decodeEntities(tok.text));
		}
	}

	value(): string {
		return decodeEscapes(this.parts.join(''));
	}
}

// ---------------------------------------------------------------------------------------------
// Sheets

/** The header row and up to `sampleSize` data rows, or null when the sheet has no header row. */
function parseSheet(xml: string, shared: string[], sampleSize: number): ParsedTable | null {
	let headers: string[] | null = null;
	const rows: string[][] = [];

	let row: string[] = [];
	let col = -1;
	let cell: { type: string; value: string[]; inV: boolean; inline: TextCollector } | null = null;

	const endCell = () => {
		if (!cell) return;
		const value = cellValue(cell.type, cell.value.join(''), cell.inline, shared);
		if (value !== '') {
			while (row.length < col) row.push('');
			row[col] = value;
		}
		cell = null;
	};

	/** Returns true when the sample is full and reading can stop. */
	const endRow = (): boolean => {
		const blank = row.every((v) => v.trim() === '');
		if (!headers) {
			if (blank) return false;
			headers = row.map((v) => (v ?? '').trim());
			while (headers.length > 0 && headers[headers.length - 1] === '') headers.pop();
		} else if (!blank) {
			const width = headers.length;
			const out = row.slice(0, width);
			while (out.length < width) out.push('');
			rows.push(out.map((v) => v ?? ''));
		}
		return rows.length >= sampleSize;
	};

	for (const tok of tokens(xml)) {
		if (tok.kind === 'open') {
			switch (tok.name) {
				case 'row':
					row = [];
					col = -1;
					if (tok.empty && endRow()) return finish(headers, rows);
					break;
				case 'c': {
					const a = attributes(tok.attrs);
					col = a.r ? columnIndex(a.r) : col + 1;
					cell = { type: a.t ?? 'n', value: [], inV: false, inline: new TextCollector() };
					if (tok.empty) endCell();
					break;
				}
				case 'v':
					if (cell && !tok.empty) cell.inV = true;
					break;
				default:
					cell?.inline.feed(tok);
			}
		} else if (tok.kind === 'close') {
			switch (tok.name) {
				case 'c':
					endCell();
					break;
				case 'v':
					if (cell) cell.inV = false;
					break;
				case 'row':
					endCell();
					if (endRow()) return finish(headers, rows);
					break;
				case 'sheetData':
					return finish(headers, rows);
				default:
					cell?.inline.feed(tok);
			}
		} else if (cell) {
			if (cell.inV) cell.value.push(tok.cdata ? tok.text : decodeEntities(tok.text));
			else cell.inline.feed(tok);
		}
	}
	return finish(headers, rows);
}

function finish(headers: string[] | null, rows: string[][]): ParsedTable | null {
	return headers ? { headers, rows } : null;
}

/** A cell's text by its type (IMP-43). Numbers and dates stay as stored (IMP-46). */
function cellValue(type: string, stored: string, inline: TextCollector, shared: string[]): string {
	switch (type) {
		case 's': {
			if (stored.trim() === '') return '';
			const index = Number(stored);
			if (!Number.isInteger(index) || index < 0 || index >= shared.length) {
				throw new Unreadable(`shared string ${stored} out of range`);
			}
			return shared[index];
		}
		case 'inlineStr':
			return inline.value();
		case 'b':
			return stored === '' ? '' : stored.trim() === '0' ? 'false' : 'true';
		case 'str':
			return decodeEscapes(stored);
		default:
			return stored;
	}
}

/** Zero-based column of a cell reference: A1 is 0, AB3 is 27. */
function columnIndex(ref: string): number {
	let n = 0;
	for (const ch of ref.toUpperCase()) {
		const code = ch.charCodeAt(0);
		if (code < 65 || code > 90) break;
		n = n * 26 + (code - 64);
	}
	if (n === 0 || n > 16384) throw new Unreadable(`bad cell reference ${ref}`);
	return n - 1;
}

// ---------------------------------------------------------------------------------------------
// XML scanner

type Token =
	| { kind: 'open'; name: string; attrs: string; empty: boolean }
	| { kind: 'close'; name: string }
	| { kind: 'text'; text: string; cdata: boolean };

/** Start tag, end tag or empty tag. Attribute values may hold '>'. */
const TAG = /<(\/?)([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
const ATTR = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Element tokens with local names (prefix dropped), and raw text. Comments and PIs skipped. */
function* tokens(xml: string): Generator<Token> {
	let i = 0;
	while (i < xml.length) {
		const lt = xml.indexOf('<', i);
		if (lt < 0) {
			yield { kind: 'text', text: xml.slice(i), cdata: false };
			return;
		}
		if (lt > i) yield { kind: 'text', text: xml.slice(i, lt), cdata: false };
		if (xml.startsWith('<!--', lt)) {
			i = after(xml, '-->', lt + 4);
		} else if (xml.startsWith('<![CDATA[', lt)) {
			const end = xml.indexOf(']]>', lt + 9);
			if (end < 0) throw new Unreadable('unclosed CDATA');
			yield { kind: 'text', text: xml.slice(lt + 9, end), cdata: true };
			i = end + 3;
		} else if (xml.startsWith('<?', lt)) {
			i = after(xml, '?>', lt + 2);
		} else if (xml.startsWith('<!', lt)) {
			i = after(xml, '>', lt + 2);
		} else {
			TAG.lastIndex = lt;
			const m = TAG.exec(xml);
			if (!m) throw new Unreadable(`bad tag at ${lt}`);
			const name = localName(m[2]);
			if (m[1]) yield { kind: 'close', name };
			else yield { kind: 'open', name, attrs: m[3], empty: m[4] === '/' };
			i = TAG.lastIndex;
		}
	}
}

function after(xml: string, end: string, from: number): number {
	const at = xml.indexOf(end, from);
	if (at < 0) throw new Unreadable(`missing ${end}`);
	return at + end.length;
}

function localName(name: string): string {
	return name.slice(name.indexOf(':') + 1);
}

/** Attributes by local name, values decoded. */
function attributes(raw: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const m of raw.matchAll(ATTR)) out[localName(m[1])] = decodeEntities(m[2] ?? m[3]);
	return out;
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s: string): string {
	if (!s.includes('&')) return s;
	return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
		if (body[0] !== '#') return NAMED[body] ?? whole;
		const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
		return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
	});
}

/** Excel's _xHHHH_ escapes in string values; _x005F_ escapes a literal underscore. */
function decodeEscapes(s: string): string {
	if (!s.includes('_x')) return s;
	return s.replace(/_x([0-9a-fA-F]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}
