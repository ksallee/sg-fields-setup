/**
 * Why Save, Install or Duplicate is disabled (EDT-9 to EDT-11): one typed reason, the first that
 * matches, and the text shown on hover. Null means the button is enabled. Whether a save is
 * already running is the view's to add.
 */
import { isDirty, validity, type WorkingCopy } from './working-copy';

/** One reason a button is disabled. */
export type Block =
	| { reason: 'nothing_to_save' }
	| { reason: 'name_missing' }
	| { reason: 'incomplete'; count: number }
	| { reason: 'duplicated' }
	| { reason: 'dirty' }
	| { reason: 'no_entries' }
	| { reason: 'no_site' };

/**
 * Save (EDT-11), first match of: nothing to save; set name missing; N fields missing required
 * values; two or more fields share an entity type and programmatic name.
 */
export function saveBlock(workingCopy: WorkingCopy): Block | null {
	if (!isDirty(workingCopy)) return { reason: 'nothing_to_save' };
	const result = validity(workingCopy);
	if (result.nameMissing) return { reason: 'name_missing' };
	if (result.incompleteIds.length > 0) return { reason: 'incomplete', count: result.incompleteIds.length };
	if (result.duplicateIds.length > 0) return { reason: 'duplicated' };
	return null;
}

/** Shared tail of Install and Duplicate: no entries, then incomplete, then duplicated. */
function entriesBlock(workingCopy: WorkingCopy, siteConnected: boolean): Block | null {
	if (workingCopy.rows.length === 0) return { reason: 'no_entries' };
	if (!siteConnected) return { reason: 'no_site' };
	const result = validity(workingCopy);
	if (result.incompleteIds.length > 0) return { reason: 'incomplete', count: result.incompleteIds.length };
	if (result.duplicateIds.length > 0) return { reason: 'duplicated' };
	return null;
}

/**
 * Install (EDT-10), first match of: the set is dirty; no entries; no site connected; an entry is
 * incomplete; entries are duplicated. Checked over the whole set, a selection or not.
 */
export function installBlock(workingCopy: WorkingCopy, siteConnected: boolean): Block | null {
	if (isDirty(workingCopy)) return { reason: 'dirty' };
	return entriesBlock(workingCopy, siteConnected);
}

/**
 * Duplicate (EDT-9), first match of: no entries; an entry is incomplete; entries are duplicated.
 * Unsaved edits do not block it: they are copied. Checked over the whole set, a selection or not.
 */
export function duplicateBlock(workingCopy: WorkingCopy): Block | null {
	return entriesBlock(workingCopy, true);
}

/** The hover text for a reason. */
export function blockText(block: Block): string {
	switch (block.reason) {
		case 'nothing_to_save':
			return 'No changes to save.';
		case 'name_missing':
			return 'The set needs a name.';
		case 'incomplete':
			return block.count === 1
				? '1 field is missing required values.'
				: `${block.count} fields are missing required values.`;
		case 'duplicated':
			return 'Two or more fields share an entity type and programmatic name.';
		case 'dirty':
			return 'Save your changes first.';
		case 'no_entries':
			return 'The set has no fields.';
		case 'no_site':
			return 'Connect a site first.';
	}
}
