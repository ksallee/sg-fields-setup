/** The words of the set list and of the actions on a set: counts, labels, confirmations. Pure. */
import type { Origin } from './model';
import type { SetSort } from './set-query';

/** "1 field", "2 fields", "1,234 fields": the number, then the singular or the plural. */
export function countText(count: number, singular: string, plural = `${singular}s`): string {
	return `${count.toLocaleString('en-US')} ${count === 1 ? singular : plural}`;
}

/** A set's entry count as the list shows it (SET-3). The app calls entries fields. */
export function fieldCount(count: number): string {
	return count === 0 ? 'No fields' : countText(count, 'field');
}

/** The origins as the filter and the rows name them (SET-2, SET-3). */
export const ORIGIN_LABELS: Record<Origin, string> = {
	import: 'Import',
	manual: 'Manual',
	site_capture: 'Site capture'
};

/** The sorts as the sort choice names them (SET-2, SET-4). */
export const SORT_LABELS: Record<SetSort, string> = {
	changed: 'Recently changed',
	created: 'Recently created',
	name: 'Name A to Z'
};

/** The line over the list: how many sets, or how many match the search and the filter. */
export function totalText(total: number, filtered: boolean): string {
	const sets = countText(total, 'set');
	if (!filtered) return sets;
	return `${sets} ${total === 1 ? 'matches' : 'match'}`;
}

/** The confirmation after a duplicate (SET-21). */
export function duplicatedText(copyName: string): string {
	return `Duplicated as "${copyName}".`;
}

/** The body of the delete confirmation (SET-22): the set by name and what goes with it (MOD-3). */
export function deleteQuestion(name: string, entryCount: number): string {
	const what = entryCount === 0 ? `"${name}"` : `"${name}" and its ${countText(entryCount, 'field')}`;
	return `${what} will be deleted. This cannot be undone.`;
}

/** What an import of a set file stored (D1). `askedName` is the name in the file. */
export interface ImportedSummary {
	name: string;
	askedName: string;
	entryCount: number;
	duplicatesDropped: number;
}

/** The confirmation after a set file came in: the fields, the duplicates dropped, a changed name. */
export function importedText(done: ImportedSummary): string {
	const renamed = done.name !== done.askedName.trim();
	const fields = done.entryCount === 0 ? 'no fields' : countText(done.entryCount, 'field');
	const parts = [`Imported ${renamed ? 'as ' : ''}"${done.name}" with ${fields}.`];
	if (done.duplicatesDropped > 0) parts.push(`${countText(done.duplicatesDropped, 'duplicate')} dropped.`);
	if (renamed) parts.push(`The name "${done.askedName.trim()}" was taken.`);
	return parts.join(' ');
}

/**
 * What an exported set file carries beside the fields, said when it does: the address of the
 * site its fields were captured from, and each captured field's schema record as the site sent
 * it. Nothing to say for a set with no captured field.
 */
export function exportedNote(entries: readonly { snapshotSite: string | null }[]): string | undefined {
	const sites = [...new Set(entries.map((entry) => entry.snapshotSite).filter((site): site is string => site !== null && site !== ''))];
	if (sites.length === 0) return undefined;
	if (sites.length === 1) return `The file carries the site address, ${sites[0]}, and the schema record of each field captured there.`;
	return `The file carries ${sites.length} site addresses and the schema record of each captured field.`;
}

/** The confirmation after a set was created (SET-1). */
export function createdText(name: string): string {
	return `Created "${name}".`;
}

/** The confirmation after a set was deleted (SET-23, EDT-8). */
export function deletedText(name: string): string {
	return `Deleted "${name}".`;
}

/** The confirmation after a set file was written (D1). */
export function exportedText(fileName: string): string {
	return `Exported ${fileName}.`;
}

/** What a failure's toast is titled: the action that failed and the set, or the file, it was for. */
export function failedTitle(action: 'duplicate' | 'export' | 'import' | 'delete', name?: string): string {
	if (action === 'delete') return 'Could not delete the set';
	// A set is quoted. A file goes by its name as it is.
	return action === 'import' ? `Could not import ${name ?? 'the file'}` : `Could not ${action} "${name ?? ''}"`;
}

/** A row whose set was deleted elsewhere while it showed (SET-21). */
export const SET_GONE_TEXT = 'This set no longer exists.';
