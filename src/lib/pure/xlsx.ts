/**
 * Read an XLSX workbook's headers and a sample of rows, read-only (IMP-42 to IMP-47, IMP-6).
 *
 * Bytes in, sheets out. Only the parts needed are unzipped: the package relationships, the
 * workbook, its relationships, the shared strings and the sheets. The XML is read by a small
 * scanner over the few elements that matter; namespace prefixes are ignored.
 *
 * A workbook is bounded (IMP-3, the note of 2026-11-10), since a small zip can hold a huge one:
 * - A part that declares more than `XLSX_PART_CAP_BYTES` inflated, or parts needed that declare
 *   more than `XLSX_WORKBOOK_CAP_BYTES` together, refuse the workbook before anything is inflated.
 * - The declared size can lie, so what really comes out is counted too, against the same two caps.
 * - A sheet is inflated one at a time and only as far as its header row and sample: a megabyte
 *   first, then twice as much while the sample is not full. The shared strings are read the
 *   same way, as far as the highest index a cell asks for.
 * - More than `XLSX_MAX_SHEETS` sheets, or a header row of more than `MAX_COLUMNS`, refuse it.
 *   Each distinct sheet part is parsed once, however many sheets name it.
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
import { strFromU8 } from 'fflate';
import { MAX_COLUMNS, type ParsedTable } from './table';
import { ZipPartReader, zipDirectory, type ZipEntry } from './zip-parts';

export const DEFAULT_SAMPLE_SIZE = 50;

const MB = 1024 * 1024;

/** The most one part of a workbook may inflate to. */
export const XLSX_PART_CAP_BYTES = 64 * MB;
/** The most the parts read from one workbook may inflate to, together. */
export const XLSX_WORKBOOK_CAP_BYTES = 200 * MB;
/** The most sheets a workbook may list. */
export const XLSX_MAX_SHEETS = 200;

/** How much of a sheet or of the shared strings is inflated first. It doubles from there. */
const FIRST_READ_BYTES = 1 * MB;

export interface XlsxCaps {
	partBytes: number;
	workbookBytes: number;
	sheets: number;
	columns: number;
}

export const XLSX_CAPS: XlsxCaps = {
	partBytes: XLSX_PART_CAP_BYTES,
	workbookBytes: XLSX_WORKBOOK_CAP_BYTES,
	sheets: XLSX_MAX_SHEETS,
	columns: MAX_COLUMNS
};

export interface XlsxOptions {
	/** Data rows read per sheet after the header row. Default 50 (IMP-45). */
	sampleSize?: number;
	/** The bounds, for a test that needs small ones. Default `XLSX_CAPS`. */
	caps?: Partial<XlsxCaps>;
}

/** Why a workbook over a bound is refused. */
export type XlsxRefusal = 'part-too-large' | 'workbook-too-large' | 'too-many-sheets' | 'too-many-columns';

/** One worksheet with a header row, as a parsed table. */
export interface WorkbookSheet {
	name: string;
	table: ParsedTable;
}

export type WorkbookResult = { ok: true; sheets: WorkbookSheet[] } | { ok: false; reason: 'no-header' | 'unreadable' | XlsxRefusal };

class Unreadable extends Error {}

/** The XML stops making sense. In a part read part way, that is where the read was cut. */
class BadXml extends Unreadable {}

/** The workbook is over a bound. The one error `readXlsx` does not turn into `unreadable`. */
class Refused extends Error {
	constructor(readonly reason: XlsxRefusal) {
		super(reason);
	}
}

export function readXlsx(bytes: Uint8Array, options: XlsxOptions = {}): WorkbookResult {
	const sampleSize = Math.max(0, Math.floor(options.sampleSize ?? DEFAULT_SAMPLE_SIZE));
	try {
		const sheets = readSheets(new Workbook(bytes, { ...XLSX_CAPS, ...options.caps }), sampleSize);
		return sheets.length > 0 ? { ok: true, sheets } : { ok: false, reason: 'no-header' };
	} catch (error) {
		return { ok: false, reason: error instanceof Refused ? error.reason : 'unreadable' };
	}
}

function readSheets(book: Workbook, sampleSize: number): WorkbookSheet[] {
	const pkgRels = parseRels(book.whole('_rels/.rels'), '');
	const workbookPath = pkgRels.find((r) => r.type.endsWith('/officeDocument'))?.target ?? 'xl/workbook.xml';

	const listed = parseWorkbook(book.whole(workbookPath), book.caps.sheets);
	const rels = parseRels(book.whole(relsPathOf(workbookPath)), dirOf(workbookPath));
	const targetById = new Map(rels.map((r) => [r.id, r.target]));

	const sheetPaths = listed.map(({ relId }) => {
		const target = targetById.get(relId);
		if (target === undefined) throw new Unreadable(`no relationship ${relId}`);
		return target;
	});
	const sstPath = rels.find((r) => r.type.endsWith('/sharedStrings'))?.target;

	// Refused on what the zip declares, before a sheet is inflated.
	const distinct = [...new Set(sheetPaths)];
	book.declare(sstPath !== undefined && book.has(sstPath) ? [...distinct, sstPath] : distinct);

	const shared = new SharedStrings(sstPath !== undefined && book.has(sstPath) ? book.open(sstPath) : null);
	const tables = new Map<string, ParsedTable | null>();
	const sheets: WorkbookSheet[] = [];
	listed.forEach(({ name }, i) => {
		const path = sheetPaths[i];
		if (!tables.has(path)) tables.set(path, readSheet(book.open(path), shared, sampleSize, book.caps.columns));
		const table = tables.get(path);
		if (table) sheets.push({ name, table });
	});
	return sheets;
}

/** One sheet, inflated only as far as its header row and sample (IMP-45). */
function readSheet(part: Part, shared: SharedStrings, sampleSize: number, maxColumns: number): ParsedTable | null {
	for (let target = FIRST_READ_BYTES; ; target *= 2) {
		part.fill(target);
		const read = parseSheet(part.text(), shared, sampleSize, maxColumns, !part.done);
		if (read.complete) return read.table;
	}
}

// ---------------------------------------------------------------------------------------------
// Zip parts

/** The workbook's zip: its directory, the bounds, and the running total of what was inflated. */
class Workbook {
	private readonly entries: Map<string, ZipEntry>;
	private readonly declared = new Set<string>();
	private declaredBytes = 0;
	private inflatedBytes = 0;

	constructor(
		private readonly bytes: Uint8Array,
		readonly caps: XlsxCaps
	) {
		this.entries = zipDirectory(bytes);
	}

	has(name: string): boolean {
		return this.entries.has(name);
	}

	/** Counts what these parts declare against the two caps. A part is counted once. */
	declare(names: readonly string[]): void {
		for (const name of names) {
			const entry = this.entries.get(name);
			if (!entry) throw new Unreadable(`missing ${name}`);
			if (this.declared.has(name)) continue;
			this.declared.add(name);
			if (entry.size > this.caps.partBytes) throw new Refused('part-too-large');
			this.declaredBytes += entry.size;
			if (this.declaredBytes > this.caps.workbookBytes) throw new Refused('workbook-too-large');
		}
	}

	/** A part to read as far as needed. What comes out counts against the two caps as it comes. */
	open(name: string): Part {
		this.declare([name]);
		const reader = new ZipPartReader(this.bytes, this.entries.get(name)!, (added, total) => {
			if (total > this.caps.partBytes) throw new Refused('part-too-large');
			this.inflatedBytes += added;
			if (this.inflatedBytes > this.caps.workbookBytes) throw new Refused('workbook-too-large');
		});
		return new Part(reader);
	}

	/** A small part read whole: the relationships and the workbook. */
	whole(name: string): string {
		const part = this.open(name);
		part.fill(Infinity);
		return part.text();
	}
}

/** One part of the zip as text, read as far as it has been filled. */
class Part {
	constructor(private readonly reader: ZipPartReader) {}

	get done(): boolean {
		return this.reader.done;
	}

	fill(target: number): void {
		this.reader.fill(target);
	}

	text(): string {
		return text(this.reader.bytes());
	}
}

/**
 * The shared strings, read as far as the highest index asked for. A workbook's strings can be
 * most of its size, and a header row and a sample need the first few.
 */
class SharedStrings {
	private strings: string[] = [];
	private target = FIRST_READ_BYTES;
	private exhausted: boolean;

	constructor(private readonly part: Part | null) {
		this.exhausted = part === null;
	}

	get(index: number): string | undefined {
		while (index >= this.strings.length && !this.exhausted && this.part) {
			this.part.fill(this.target);
			this.target *= 2;
			this.strings = parseSharedStrings(this.part.text(), !this.part.done);
			this.exhausted = this.part.done;
		}
		return this.strings[index];
	}
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

/** The workbook's sheets in workbook order (IMP-42). One more than `maxSheets` refuses it. */
function parseWorkbook(xml: string, maxSheets: number): { name: string; relId: string }[] {
	const sheets: { name: string; relId: string }[] = [];
	for (const tok of tokens(xml)) {
		if (tok.kind !== 'open' || tok.name !== 'sheet') continue;
		const a = attributes(tok.attrs);
		if (a.id === undefined) throw new Unreadable('sheet without a relationship');
		if (sheets.length >= maxSheets) throw new Refused('too-many-sheets');
		sheets.push({ name: a.name ?? '', relId: a.id });
	}
	return sheets;
}

/**
 * Shared strings: rich text runs concatenated, phonetic runs ignored (IMP-43). With `partial`
 * the text is the start of the part, cut anywhere: the strings that are whole come back.
 */
function parseSharedStrings(xml: string, partial: boolean): string[] {
	const strings: string[] = [];
	const collect = new TextCollector();
	try {
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
	} catch (error) {
		if (!partial || !(error instanceof BadXml)) throw error;
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

/**
 * The header row and up to `sampleSize` data rows; the table is null when the sheet has no header
 * row. With `partial` the text is the start of the sheet, cut anywhere: `complete` is false when
 * the cut came before the sample was full, and the caller reads further.
 */
function parseSheet(
	xml: string,
	shared: SharedStrings,
	sampleSize: number,
	maxColumns: number,
	partial: boolean
): { complete: boolean; table: ParsedTable | null } {
	try {
		const scan = scanSheet(xml, shared, sampleSize, maxColumns);
		return { complete: scan.ended || !partial, table: scan.table };
	} catch (error) {
		// Every token before a bad one was whole, so a bad one in a partial read is the cut.
		if (partial && error instanceof BadXml) return { complete: false, table: null };
		throw error;
	}
}

/** `ended` is true when the sample filled or the sheet's data closed, false when the text ran out first. */
function scanSheet(xml: string, shared: SharedStrings, sampleSize: number, maxColumns: number): { ended: boolean; table: ParsedTable | null } {
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
			if (headers.length > maxColumns) throw new Refused('too-many-columns');
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
					if (tok.empty && endRow()) return { ended: true, table: finish(headers, rows) };
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
					if (endRow()) return { ended: true, table: finish(headers, rows) };
					break;
				case 'sheetData':
					return { ended: true, table: finish(headers, rows) };
				default:
					cell?.inline.feed(tok);
			}
		} else if (cell) {
			if (cell.inV) cell.value.push(tok.cdata ? tok.text : decodeEntities(tok.text));
			else cell.inline.feed(tok);
		}
	}
	// The text ran out before </sheetData>: a partial read was cut, or the whole sheet ends so.
	return { ended: false, table: finish(headers, rows) };
}

function finish(headers: string[] | null, rows: string[][]): ParsedTable | null {
	return headers ? { headers, rows } : null;
}

/** A cell's text by its type (IMP-43). Numbers and dates stay as stored (IMP-46). */
function cellValue(type: string, stored: string, inline: TextCollector, shared: SharedStrings): string {
	switch (type) {
		case 's': {
			if (stored.trim() === '') return '';
			const index = Number(stored);
			const found = Number.isInteger(index) && index >= 0 ? shared.get(index) : undefined;
			if (found === undefined) throw new Unreadable(`shared string ${stored} out of range`);
			return found;
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
			if (end < 0) throw new BadXml('unclosed CDATA');
			yield { kind: 'text', text: xml.slice(lt + 9, end), cdata: true };
			i = end + 3;
		} else if (xml.startsWith('<?', lt)) {
			i = after(xml, '?>', lt + 2);
		} else if (xml.startsWith('<!', lt)) {
			i = after(xml, '>', lt + 2);
		} else {
			TAG.lastIndex = lt;
			const m = TAG.exec(xml);
			if (!m) throw new BadXml(`bad tag at ${lt}`);
			// Read before the yield: a consumer may scan another part meanwhile, with the same regex.
			i = TAG.lastIndex;
			const name = localName(m[2]);
			if (m[1]) yield { kind: 'close', name };
			else yield { kind: 'open', name, attrs: m[3], empty: m[4] === '/' };
		}
	}
}

function after(xml: string, end: string, from: number): number {
	const at = xml.indexOf(end, from);
	if (at < 0) throw new BadXml(`missing ${end}`);
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
