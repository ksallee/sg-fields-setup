/**
 * A dropped or browsed `File` to what the import parses: the text of a CSV, the bytes of a
 * workbook (IMP-2 to IMP-4). Which files are taken and the size cap are rules of
 * `$lib/pure/import-dialog`; this is the read.
 *
 * A file of another kind, or over the cap, is refused before a byte is read (IMP-3).
 *
 * A CSV's bytes are text in UTF-8. When they are not valid UTF-8 they are read as Windows-1252,
 * which is what a spreadsheet app on a Western European system saves and which reads any bytes.
 * A UTF-16 byte-order mark is honoured. The UTF-8 mark is left in: the parser drops it (IMP-37).
 */
import { exceedsSizeCap, IMPORT_SIZE_CAP_BYTES, spreadsheetKind, type FileContent, type FileProblem } from '$lib/pure/import-dialog';

/** The part of a `File` this reads. */
export type ReadableFile = Pick<File, 'name' | 'size' | 'arrayBuffer'>;

export type SpreadsheetRead = { ok: true; content: FileContent } | { ok: false; problem: Extract<FileProblem, 'unsupported' | 'too-large' | 'unreadable'> };

/** CSV bytes as text. Never throws. */
export function decodeText(bytes: Uint8Array): string {
	if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
	if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
	try {
		return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
	} catch {
		return new TextDecoder('windows-1252').decode(bytes);
	}
}

export async function readSpreadsheet(file: ReadableFile, capBytes: number = IMPORT_SIZE_CAP_BYTES): Promise<SpreadsheetRead> {
	const kind = spreadsheetKind(file.name);
	if (kind === null) return { ok: false, problem: 'unsupported' };
	if (exceedsSizeCap(file.size, capBytes)) return { ok: false, problem: 'too-large' };
	try {
		const bytes = new Uint8Array(await file.arrayBuffer());
		return { ok: true, content: kind === 'csv' ? { kind, text: decodeText(bytes) } : { kind, bytes } };
	} catch {
		return { ok: false, problem: 'unreadable' };
	}
}
