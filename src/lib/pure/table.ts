/** One bucket's worth of spreadsheet: a header row and a sample of data rows. */
export interface ParsedTable {
	/** Header cells, trimmed, in column order. Blank headers are kept as '' so columns line up. */
	headers: string[];
	/** Data rows as read. A row may be shorter or longer than headers (CSV, IMP-40). */
	rows: string[][];
}

export type TableResult = { ok: true; table: ParsedTable } | { ok: false; reason: 'no-header' | 'unreadable' };
