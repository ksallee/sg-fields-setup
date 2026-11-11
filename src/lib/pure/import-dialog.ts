/**
 * The import dialog's state: which files are taken, what a refused file is told, the buckets and
 * their fallbacks, and the steps of confirming (IMP-1 to IMP-16, IMP-51).
 *
 * Data in, data out. Reading a `File` is `$lib/io/read-spreadsheet`; the schema and the store are
 * the dialog's wiring. Building the entries is `import-build`.
 *
 * Rules where the spec leaves room:
 * - A CSV keeps the same sample of data rows as a worksheet (IMP-45): the guesser reads 20 values.
 * - One message slot (IMP-12). It holds the last refused file of the latest drop, or the last
 *   failed confirm. When the same drop refused more files, the message says how many, so no
 *   refusal goes unseen.
 * - The set name's default is spent by the first accepted file, whether it was used or not (IMP-9).
 * - A fallback the user touched is the user's, even when cleared again: inference never fills
 *   it (IMP-16).
 * - Every opening of the dialog is a session. A file or an inference that answers for an earlier
 *   session is dropped (IMP-13).
 * - While saving nothing changes but the outcome (IMP-13).
 */
import { parseCsv } from './csv';
import { bucketFromCsv, bucketsFromWorkbook, canConfirm, defaultSetName, type ImportBucket } from './import-build';
import type { ImportMode } from './import-entity-type';
import { DEFAULT_DELIMITER } from './import-header';
import { MAX_COLUMNS } from './table';
import { DEFAULT_SAMPLE_SIZE, readXlsx, XLSX_MAX_SHEETS, XLSX_PART_CAP_BYTES, XLSX_WORKBOOK_CAP_BYTES } from './xlsx';

/* Files. */

/** The size cap of one file (IMP-3). */
export const IMPORT_SIZE_CAP_BYTES = 15 * 1024 * 1024;

/** What the file picker offers. A drop is checked by `spreadsheetKind`. */
export const IMPORT_ACCEPT = '.csv,.xlsx';

export type SpreadsheetKind = 'csv' | 'xlsx';

/** The kind of an accepted file, by its name's ending, any case. Null for anything else (IMP-2). */
export function spreadsheetKind(fileName: string): SpreadsheetKind | null {
	const name = fileName.toLowerCase();
	if (name.endsWith('.csv')) return 'csv';
	if (name.endsWith('.xlsx')) return 'xlsx';
	return null;
}

/** Whether a file of this size is refused unread (IMP-3). */
export function exceedsSizeCap(size: number, capBytes: number = IMPORT_SIZE_CAP_BYTES): boolean {
	return size > capBytes;
}

/**
 * Why a file is refused (IMP-2 to IMP-5). The last four are the bounds on what a file may hold
 * once read (IMP-3, the note of 2026-11-10): a workbook that unpacks too large, in one part or
 * in all, one with too many sheets, a table with too many columns.
 */
export type FileProblem =
	| 'unsupported'
	| 'too-large'
	| 'unreadable'
	| 'no-header'
	| 'part-too-large'
	| 'workbook-too-large'
	| 'too-many-sheets'
	| 'too-many-columns';

const megabytes = (bytes: number): number => Math.round(bytes / (1024 * 1024));

/** The sentence for a refused file, naming it (IMP-2 to IMP-5). */
export function fileProblemText(problem: FileProblem, fileName: string, capBytes: number = IMPORT_SIZE_CAP_BYTES): string {
	switch (problem) {
		case 'unsupported':
			return `"${fileName}" is not a CSV or XLSX file.`;
		case 'too-large':
			return `"${fileName}" is over ${megabytes(capBytes)} MB.`;
		case 'unreadable':
			return `"${fileName}" could not be read.`;
		case 'no-header':
			return `"${fileName}" has no header row.`;
		case 'part-too-large':
			return `"${fileName}" holds a part over ${megabytes(XLSX_PART_CAP_BYTES)} MB once unpacked.`;
		case 'workbook-too-large':
			return `"${fileName}" is over ${megabytes(XLSX_WORKBOOK_CAP_BYTES)} MB once unpacked.`;
		case 'too-many-sheets':
			return `"${fileName}" has more than ${XLSX_MAX_SHEETS.toLocaleString('en-US')} sheets.`;
		case 'too-many-columns':
			return `"${fileName}" has more than ${MAX_COLUMNS.toLocaleString('en-US')} columns.`;
	}
}

/** A file as read: the text of a CSV, the bytes of a workbook. */
export type FileContent = { kind: 'csv'; text: string } | { kind: 'xlsx'; bytes: Uint8Array };

export type FileBuckets = { ok: true; buckets: ImportBucket[] } | { ok: false; problem: Exclude<FileProblem, 'unsupported' | 'too-large'> };

/** A read file as its buckets: one for a CSV, one per worksheet with a header (IMP-4 to IMP-6). */
export function bucketsFromFile(fileName: string, content: FileContent): FileBuckets {
	if (content.kind === 'csv') {
		const parsed = parseCsv(content.text, { maxRows: DEFAULT_SAMPLE_SIZE });
		return parsed.ok ? { ok: true, buckets: [bucketFromCsv(fileName, parsed.table)] } : { ok: false, problem: parsed.reason };
	}
	const workbook = readXlsx(content.bytes, { sampleSize: DEFAULT_SAMPLE_SIZE });
	if (!workbook.ok) return { ok: false, problem: workbook.reason };
	const buckets = bucketsFromWorkbook(fileName, workbook.sheets);
	return buckets.length > 0 ? { ok: true, buckets } : { ok: false, problem: 'no-header' };
}

/* The dialog's state. */

/** One bucket on screen. */
export interface BucketRow {
	/** Stable while the dialog is open: the row's key, and what a late inference answers for. */
	id: number;
	bucket: ImportBucket;
	/** The user chose or cleared the fallback: inference leaves it alone (IMP-16). */
	touched: boolean;
}

export interface ImportDialogState {
	/** Which opening of the dialog this is. */
	session: number;
	rows: readonly BucketRow[];
	nextId: number;
	/** As typed. */
	setName: string;
	/** The first accepted file has had its say on the set name (IMP-9). */
	nameDefaulted: boolean;
	mode: ImportMode;
	delimiter: string;
	/** The messages of the latest drop, or the one of the last failed confirm. The last one shows. */
	problems: readonly string[];
	saving: boolean;
	/** How many drops are still being read. Confirm waits for them: their buckets are part of the import (IMP-11). */
	reading: number;
}

export function initialImportDialog(session = 0): ImportDialogState {
	return {
		session,
		rows: [],
		nextId: 1,
		setName: '',
		nameDefaulted: false,
		mode: 'automatic',
		delimiter: DEFAULT_DELIMITER,
		problems: [],
		saving: false,
		reading: 0
	};
}

/** The buckets, in order, as `import-build` takes them. */
export function bucketsOf(state: ImportDialogState): ImportBucket[] {
	return state.rows.map((row) => row.bucket);
}

/** The one message on screen, or null (IMP-12). */
export function problemText(state: ImportDialogState): string | null {
	const last = state.problems.at(-1);
	if (last === undefined) return null;
	const others = state.problems.length - 1;
	if (others === 0) return last;
	return `${last} ${others} other ${others === 1 ? 'file was' : 'files were'} refused.`;
}

/** Files are coming: the message goes first (IMP-12), and confirm waits until `finishAdding` (IMP-11). */
export function startAdding(state: ImportDialogState): ImportDialogState {
	if (state.saving) return state;
	return { ...state, problems: [], reading: state.reading + 1 };
}

/** The files of one `startAdding` have all been read, accepted or refused. A drop of an earlier opening answers to nobody. */
export function finishAdding(state: ImportDialogState, session: number): ImportDialogState {
	if (state.session !== session || state.reading === 0) return state;
	return { ...state, reading: state.reading - 1 };
}

function current(state: ImportDialogState, session: number): boolean {
	return state.session === session && !state.saving;
}

/**
 * A parsed file's buckets go in, after the ones already there (IMP-6). The first accepted file
 * names the set if the box is blank (IMP-9). `added` is the new rows, for the inference.
 */
export function acceptFile(
	state: ImportDialogState,
	session: number,
	fileName: string,
	buckets: readonly ImportBucket[]
): { state: ImportDialogState; added: BucketRow[] } {
	if (!current(state, session) || buckets.length === 0) return { state, added: [] };
	const added = buckets.map((bucket, index) => ({ id: state.nextId + index, bucket, touched: false }));
	return {
		state: {
			...state,
			rows: [...state.rows, ...added],
			nextId: state.nextId + added.length,
			setName: state.nameDefaulted ? state.setName : defaultSetName(state.setName, fileName),
			nameDefaulted: true
		},
		added
	};
}

/** A file is refused: its message becomes the one that shows (IMP-2 to IMP-5, IMP-12). */
export function refuseFile(
	state: ImportDialogState,
	session: number,
	problem: FileProblem,
	fileName: string,
	capBytes: number = IMPORT_SIZE_CAP_BYTES
): ImportDialogState {
	if (!current(state, session)) return state;
	return { ...state, problems: [...state.problems, fileProblemText(problem, fileName, capBytes)] };
}

export function removeBucket(state: ImportDialogState, id: number): ImportDialogState {
	if (state.saving || !state.rows.some((row) => row.id === id)) return state;
	return { ...state, rows: state.rows.filter((row) => row.id !== id) };
}

function withFallback(state: ImportDialogState, id: number, fallback: string, touched: boolean): ImportDialogState {
	return {
		...state,
		rows: state.rows.map((row) => (row.id === id ? { ...row, bucket: { ...row.bucket, fallback }, touched } : row))
	};
}

/** The user picks, types or clears a bucket's fallback (IMP-8). */
export function setFallback(state: ImportDialogState, id: number, fallback: string): ImportDialogState {
	if (state.saving || !state.rows.some((row) => row.id === id)) return state;
	return withFallback(state, id, fallback, true);
}

/**
 * An inference has answered for a bucket (IMP-15). It goes in only when the bucket is still
 * there, still empty and untouched (IMP-16).
 */
export function applyInferredFallback(state: ImportDialogState, session: number, id: number, inferred: string | null): ImportDialogState {
	if (!current(state, session) || inferred === null) return state;
	const row = state.rows.find((candidate) => candidate.id === id);
	if (!row || row.touched || row.bucket.fallback.trim() !== '') return state;
	return withFallback(state, id, inferred, false);
}

/* Confirming. */

/**
 * Whether the confirm action is enabled (IMP-11). Never while a file is still being read: the
 * import would go without its buckets and nothing would say so.
 */
export function confirmEnabled(state: ImportDialogState): boolean {
	return state.reading === 0 && canConfirm({ saving: state.saving, setName: state.setName, buckets: bucketsOf(state) });
}

/** The saving state, or null when confirm is not enabled (IMP-11). The message goes. */
export function startSaving(state: ImportDialogState): ImportDialogState | null {
	return confirmEnabled(state) ? { ...state, saving: true, problems: [] } : null;
}

/** The save failed: its message shows, everything else stays (IMP-51). */
export function failSaving(state: ImportDialogState, session: number, message: string): ImportDialogState {
	if (state.session !== session || !state.saving) return state;
	return { ...state, saving: false, problems: [message] };
}

/** Every header was blank or only a prefix (IMP-32): there is no field to store. */
export const NO_COLUMNS_TEXT = 'These files have no column to import.';

/** With a site connected, its entity types could not be read, so no column can be resolved (IMP-21). */
export const TYPES_UNREAD_TEXT = 'Could not read the entity types of the site. Try again.';

/** The name of a bucket's typed fallback box, which has no visible label of its own (IMP-8). */
export function fallbackLabel(bucketLabel: string): string {
	return `Fallback entity type of ${bucketLabel}`;
}
