/**
 * Bulk actions over a list of row keys (EDT-41, EDT-42). Clearing the selection afterwards is the
 * view's business.
 */
import { isMirror } from './data-types';
import type { ResyncUpdate } from './live-to-entry';
import type { EntryDefinition } from './model';
import { editRow, removeRows, replaceDefinition, type WorkingCopy } from './working-copy';

/** A bulk edit's outcome: the new working copy and how many listed mirror rows it left alone. */
export interface BulkResult {
	workingCopy: WorkingCopy;
	skipped: number;
}

function bulkEdit(workingCopy: WorkingCopy, keys: readonly string[], patch: Partial<EntryDefinition>): BulkResult {
	const listed = new Set(keys);
	let next = workingCopy;
	let skipped = 0;
	for (const row of workingCopy.rows) {
		if (!listed.has(row.key)) continue;
		if (isMirror(row)) skipped += 1;
		else next = editRow(next, row.key, patch);
	}
	return { workingCopy: next, skipped };
}

/**
 * Sets the target entity type of every listed row (EDT-41). Mirror rows are skipped and counted:
 * a mirror is read-only except for deletion (MOD-15, EDT-32). A move onto a type that already
 * has the same programmatic name makes both duplicates (EDT-43). Unknown keys are ignored.
 */
export function bulkAssignType(workingCopy: WorkingCopy, keys: readonly string[], targetEntityType: string): BulkResult {
	return bulkEdit(workingCopy, keys, { targetEntityType });
}

/**
 * Sets the data type of every listed row except mirror rows, which are skipped and counted
 * (EDT-41). Settings the new type does not carry stay in the working copy and are dropped on save
 * (MOD-9). Unknown keys are ignored.
 */
export function bulkChangeDataType(workingCopy: WorkingCopy, keys: readonly string[], dataType: string): BulkResult {
	return bulkEdit(workingCopy, keys, { dataType });
}

/** Removes every listed row, mirrors included (EDT-41, EDT-33). Unknown keys are ignored. */
export function bulkDelete(workingCopy: WorkingCopy, keys: readonly string[]): WorkingCopy {
	return removeRows(workingCopy, keys);
}

/**
 * Applies a re-sync (EDT-42): each update of `resyncRows` (`live-to-entry.ts`) replaces its row's
 * definition and snapshot, mirror rows included. Rows with no update stay as they are. Unknown
 * keys are ignored. The result is unsaved until Save.
 */
export function bulkResync(workingCopy: WorkingCopy, updates: readonly ResyncUpdate[]): WorkingCopy {
	let next = workingCopy;
	for (const update of updates) next = replaceDefinition(next, update.key, update.definition, update.snapshot);
	return next;
}
