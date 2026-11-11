/** One bucket's worth of spreadsheet: a header row and a sample of data rows. */
export interface ParsedTable {
	/** Header cells, trimmed, in column order. Blank headers are kept as '' so columns line up. */
	headers: string[];
	/** Data rows as read. A row may be shorter or longer than headers (CSV, IMP-40). */
	rows: string[][];
}

/**
 * The most columns one table may have, CSV or worksheet (IMP-3, the note of 2026-11-10). A header
 * becomes a row of the dialog and an entry of the set; a file past this is no field list.
 */
export const MAX_COLUMNS = 2000;

export type TableResult = { ok: true; table: ParsedTable } | { ok: false; reason: 'no-header' | 'unreadable' | 'too-many-columns' };
