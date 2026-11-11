/**
 * Files dropped on the set list: which go to the set file import and which to the spreadsheet
 * import (IMP-1, D1). By the name's ending, any case. Anything that is not a set file goes to the
 * spreadsheet import, which says why it refuses a file it cannot read (IMP-2).
 */
export type ListDrop<T> = { setFiles: T[]; spreadsheets: T[] };

export function splitListDrop<T extends { name: string }>(files: readonly T[]): ListDrop<T> {
	const drop: ListDrop<T> = { setFiles: [], spreadsheets: [] };
	for (const file of files) (file.name.toLowerCase().endsWith('.json') ? drop.setFiles : drop.spreadsheets).push(file);
	return drop;
}
