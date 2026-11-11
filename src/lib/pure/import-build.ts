/**
 * Building a new set from imported spreadsheets: buckets, fallback inference, entries, and the
 * dialog's rules and texts (IMP-6 to IMP-11, IMP-15, IMP-16, IMP-29 to IMP-32, IMP-48 to IMP-52).
 *
 * Data in, data out. Reading files, the schema and the store is the dialog's business.
 *
 * Rules where the spec leaves room:
 * - A workbook bucket is labelled "file.xlsx (Sheet)". A CSV bucket is labelled with its file name.
 * - A sheet whose headers are all blank makes no bucket (IMP-6).
 * - A bucket's column count is its non-blank headers (IMP-8, IMP-10).
 * - Inference counts headers, not distinct names: a repeated header counts each time. It
 *   matches each header's field name (prefix cut) against each common type, whatever type the
 *   header would resolve to. A header that makes no entry counts nothing.
 * - De-duplication compares (target type, programmatic name) trimmed and case-sensitively, as
 *   `validity.duplicatedIds` does. An entry missing either half is never a duplicate and is
 *   always kept (EDT-12).
 * - Source files: the distinct file names, in bucket order, joined with ", ".
 * - The default set name cuts the last ".extension"; a name that is only an extension is kept.
 */
import { columnValues, guessDataType } from './import-guess';
import { DEFAULT_DELIMITER, splitHeader } from './import-header';
import { targetEntityType, type ImportMode, type SiteEntityType } from './import-entity-type';
import { createMatcher, type LiveFieldsByType } from './import-match';
import { predictFieldName } from './field-name';
import { draftFromLiveField } from './live-to-entry';
import type { EntryDraft, OriginDetails, Timestamp } from './model';
import type { ParsedTable } from './table';
import type { WorkbookSheet } from './xlsx';

/* Buckets. */

/** One CSV, or one worksheet of a workbook (IMP-6). */
export interface ImportBucket {
	/** What the dialog shows: the file name, plus the sheet name for a workbook. */
	label: string;
	/** The source file's name, for the set's origin details. */
	fileName: string;
	/** The worksheet's name, or null for a CSV. */
	worksheet: string | null;
	table: ParsedTable;
	/** The fallback entity type, '' while none is set (IMP-8). */
	fallback: string;
}

/** A parsed CSV as one bucket, with no fallback. */
export function bucketFromCsv(fileName: string, table: ParsedTable): ImportBucket {
	return { label: fileName, fileName, worksheet: null, table, fallback: '' };
}

function hasHeader(table: ParsedTable): boolean {
	return table.headers.some((header) => header.trim() !== '');
}

/** One bucket per sheet with a header, in workbook order, with no fallback (IMP-6). */
export function bucketsFromWorkbook(fileName: string, sheets: readonly WorkbookSheet[]): ImportBucket[] {
	return sheets
		.filter((sheet) => hasHeader(sheet.table))
		.map((sheet) => ({ label: `${fileName} (${sheet.name})`, fileName, worksheet: sheet.name, table: sheet.table, fallback: '' }));
}

/** The bucket's non-blank headers (IMP-8). */
export function bucketColumnCount(bucket: ImportBucket): number {
	return bucket.table.headers.filter((header) => header.trim() !== '').length;
}

export interface ImportTotals {
	columns: number;
	buckets: number;
}

export function importTotals(buckets: readonly ImportBucket[]): ImportTotals {
	return { columns: buckets.reduce((sum, bucket) => sum + bucketColumnCount(bucket), 0), buckets: buckets.length };
}

function count(n: number, singular: string, plural: string): string {
	return `${n} ${n === 1 ? singular : plural}`;
}

/** The footer line (IMP-10): "72 columns in 1 bucket." */
export function importFooterText(buckets: readonly ImportBucket[]): string {
	const totals = importTotals(buckets);
	return `${count(totals.columns, 'column', 'columns')} in ${count(totals.buckets, 'bucket', 'buckets')}.`;
}

/* Which types the import resolves to. */

interface Column {
	bucket: ImportBucket;
	index: number;
	hint: string;
	fieldName: string;
}

/** Every header that makes an entry, in bucket order then column order (IMP-32). */
function columnsOf(buckets: readonly ImportBucket[], delimiter: string): Column[] {
	const columns: Column[] = [];
	for (const bucket of buckets) {
		bucket.table.headers.forEach((header, index) => {
			const parts = splitHeader(header, delimiter);
			if (parts) columns.push({ bucket, index, ...parts });
		});
	}
	return columns;
}

function targetOf(column: Column, mode: ImportMode, types: readonly SiteEntityType[] | undefined): string {
	return targetEntityType({
		mode,
		hint: column.hint,
		worksheet: column.bucket.worksheet ?? undefined,
		fallback: column.bucket.fallback,
		types
	});
}

/**
 * The distinct target types the import resolves to, first seen first, '' left out (IMP-29): the
 * only types whose live fields need reading. Empty without a site (`types` null).
 */
export function resolvedEntityTypes(
	buckets: readonly ImportBucket[],
	mode: ImportMode,
	delimiter: string,
	types: readonly SiteEntityType[] | null
): string[] {
	if (!types) return [];
	const seen = new Set<string>();
	for (const column of columnsOf(buckets, delimiter)) {
		const type = targetOf(column, mode, types);
		if (type !== '') seen.add(type);
	}
	return [...seen];
}

/* Fallback inference. */

/**
 * The common type whose live fields match the most of the bucket's headers (IMP-15). `order` is
 * the common types in inference order: pass `COMMON_ENTITY_TYPES`. Only those types count; one
 * missing from `fieldsByType` counts zero. Ties go to the earlier type. Null when nothing matches.
 */
export function inferFallback(
	bucket: ImportBucket,
	fieldsByType: LiveFieldsByType,
	order: readonly string[],
	delimiter: string = DEFAULT_DELIMITER
): string | null {
	const match = createMatcher(fieldsByType);
	const columns = columnsOf([bucket], delimiter);
	let best: string | null = null;
	let bestCount = 0;
	for (const type of order) {
		const matched = columns.filter((column) => match(type, column.fieldName) !== null).length;
		if (matched > bestCount) {
			best = type;
			bestCount = matched;
		}
	}
	return best;
}

/* Building entries. */

/** The connected site, as the build needs it. */
export interface ImportSite {
	/** The site's URL, for each snapshot. */
	url: string;
	entityTypes: readonly SiteEntityType[];
	/** Live fields of the types `resolvedEntityTypes` named. A type missing has no fields. */
	fieldsByType: LiveFieldsByType;
}

export interface BuildInput {
	buckets: readonly ImportBucket[];
	mode: ImportMode;
	delimiter: string;
	/** Null without a site (IMP-52): nothing resolves, nothing matches, all types guessed. */
	site: ImportSite | null;
	importedAt: Timestamp;
}

export interface BuildResult {
	/** De-duplicated, in bucket order then column order. */
	entries: EntryDraft[];
	/** How many duplicate columns were dropped (IMP-48). */
	dropped: number;
	originDetails: OriginDetails;
}

function guessedDraft(targetEntityType: string, fieldName: string, values: readonly string[]): EntryDraft {
	return {
		targetEntityType,
		// No data type here: a non-ASCII header stays blank rather than `sg_<guessed type>`, which
		// would make two such columns one and drop the second as a duplicate (IMP-48, G11).
		programmaticName: predictFieldName(fieldName) ?? '',
		displayName: fieldName,
		dataType: guessDataType(values),
		validTypes: [],
		validValues: [],
		defaultValue: null,
		description: null,
		uniquePerProject: false,
		snapshot: null,
		snapshotSite: null,
		snapshotTime: null
	};
}

/** Distinct file names, in bucket order, joined with ", ". */
export function sourceFiles(buckets: readonly ImportBucket[]): string {
	return [...new Set(buckets.map((bucket) => bucket.fileName))].join(', ');
}

/**
 * The entries of the new set (IMP-30 to IMP-32, IMP-48, IMP-52). Each header that makes an entry
 * takes its type by the mode. A live field match on that type is mirrored (IMP-30); otherwise the
 * entry gets the header's field name, the predicted programmatic name and the guessed type
 * (IMP-31). Then later duplicates on (type, name) are dropped and counted.
 */
export function buildEntries(input: BuildInput): BuildResult {
	const { buckets, mode, delimiter, site, importedAt } = input;
	const match = site ? createMatcher(site.fieldsByType) : null;
	const seen = new Set<string>();
	const entries: EntryDraft[] = [];
	let dropped = 0;
	for (const column of columnsOf(buckets, delimiter)) {
		const type = targetOf(column, mode, site?.entityTypes);
		const live = match && type !== '' ? match(type, column.fieldName) : null;
		const draft =
			live && site
				? draftFromLiveField(live, site.url)
				: guessedDraft(type, column.fieldName, columnValues(column.bucket.table, column.index));
		const pairType = draft.targetEntityType.trim();
		const pairName = draft.programmaticName.trim();
		if (pairType !== '' && pairName !== '') {
			const pair = JSON.stringify([pairType, pairName]);
			if (seen.has(pair)) {
				dropped += 1;
				continue;
			}
			seen.add(pair);
		}
		entries.push(draft);
	}
	return { entries, dropped, originDetails: { sourceFiles: sourceFiles(buckets), importedAt } };
}

/* The dialog's rules and texts. */

export interface ConfirmState {
	saving: boolean;
	/** As typed. */
	setName: string;
	buckets: readonly ImportBucket[];
}

/** Whether the confirm action is enabled (IMP-11). */
export function canConfirm(state: ConfirmState): boolean {
	return (
		!state.saving &&
		state.setName.trim() !== '' &&
		state.buckets.length > 0 &&
		state.buckets.every((bucket) => bucket.fallback.trim() !== '')
	);
}

/**
 * The set name after the first accepted file (IMP-9): the file name without its extension if the
 * name box is blank, else the name as typed. Call it once, for the first accepted file only.
 */
export function defaultSetName(currentName: string, fileName: string): string {
	if (currentName.trim() !== '') return currentName;
	const dot = fileName.lastIndexOf('.');
	return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/** The confirmation after a successful import (IMP-50). */
export function importSuccessText(imported: number, skipped: number): string {
	const text = `Imported ${count(imported, 'field', 'fields')}.`;
	return skipped > 0 ? `${text} Skipped ${count(skipped, 'duplicate column', 'duplicate columns')}.` : text;
}

/** The editor's banner on the new set (IMP-50). */
export function importBannerText(imported: number): string {
	const ask = imported === 1 ? 'Check its entity type and data type.' : 'Check each entity type and data type.';
	return `Imported ${count(imported, 'field', 'fields')}. ${ask}`;
}
