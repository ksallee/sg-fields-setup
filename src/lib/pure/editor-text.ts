/**
 * The words of the editor screen that take an argument (docs/design.md, Copy): the status near
 * the title, the header buttons, the bulk bar and its reports. Pure.
 */
import type { StatusFilter } from './editor-view';
import type { SelectionSummary } from './selection';
import { countText } from './set-text';

/** The status near the title (EDT-4), plus the failed save of EDT-47. */
export type EditorStatus = 'saving' | 'error' | 'dirty' | 'saved';

/** Which status shows: a running save first, then a failed one, then unsaved changes (EDT-4, EDT-47). */
export function editorStatus(state: { saving: boolean; failed: boolean; dirty: boolean }): EditorStatus {
	if (state.saving) return 'saving';
	if (state.failed) return 'error';
	return state.dirty ? 'dirty' : 'saved';
}

export const STATUS_TEXT: Record<EditorStatus, string> = {
	saving: 'Saving…',
	error: 'Not saved',
	dirty: 'Unsaved changes',
	saved: 'Saved'
};

/** The status filter's choices as the toolbar names them (EDT-35). */
export const FILTER_LABELS: Record<StatusFilter, string> = {
	all: 'All',
	on_site: 'On site',
	new: 'New',
	needs_attention: 'Needs attention'
};

/** Duplicate, saying how many fields when rows are selected (EDT-9). */
export function duplicateLabel(selected: number): string {
	return selected > 0 ? `Duplicate ${countText(selected, 'field')}` : 'Duplicate';
}

/** Install, saying how many fields when rows are selected (EDT-10). */
export function installLabel(selected: number): string {
	return selected > 0 ? `Install ${countText(selected, 'field')}` : 'Install';
}

/**
 * The bulk bar's count (EDT-41): the selected rows on screen, which are the ones an action
 * touches, and how many more a search or filter hides.
 */
export function selectionText(summary: SelectionSummary): string {
	const shown = `${summary.visible.toLocaleString('en-US')} selected`;
	return summary.hidden > 0 ? `${shown}, ${summary.hidden.toLocaleString('en-US')} hidden` : shown;
}

function skippedText(skipped: number): string {
	return `Skipped ${countText(skipped, 'computed field')}.`;
}

function withSkipped(done: string | null, skipped: number): string {
	const parts = [done, skipped > 0 ? skippedText(skipped) : null].filter((part) => part !== null);
	return parts.join(' ');
}

/** After assign to entity type (EDT-41): how many moved, and the mirror rows left alone. */
export function assignedText(assigned: number, typeLabel: string, skipped: number): string {
	return withSkipped(assigned > 0 ? `Assigned ${countText(assigned, 'field')} to ${typeLabel}.` : null, skipped);
}

/** After change data type (EDT-41): how many changed, and the mirror rows skipped. */
export function dataTypeChangedText(changed: number, typeLabel: string, skipped: number): string {
	return withSkipped(changed > 0 ? `Changed ${countText(changed, 'field')} to ${typeLabel}.` : null, skipped);
}

/** After a re-sync that found at least one field (EDT-42). `selected` is how many were asked for. */
export function resyncedText(resynced: number, selected: number): string {
	const done = `Re-synced ${countText(resynced, 'field')} from the site.`;
	const absent = selected - resynced;
	if (absent <= 0) return done;
	return `${done} ${absent.toLocaleString('en-US')} ${absent === 1 ? 'is' : 'are'} not on the site.`;
}

/** After a re-sync that found none (EDT-42). */
export const RESYNC_NONE_TEXT = 'None of the selected fields exist on the site.';

/** The confirmation after a save (EDT-46). */
export function savedText(name: string): string {
	return `Saved "${name}".`;
}

/** Why a mirror row is locked (EDT-26, EDT-32). */
export const MIRROR_TEXT =
	'This field is computed on the site. It cannot be edited or installed. Keep it for reference, or remove it.';

/** The note under unique per project (EDT-30). */
export const UNIQUE_NOTE = 'Fixed when the field is created. The API cannot change it later.';

/** The page's title (EDT-1): the name as typed, a blank one named, and a word before the set loads. */
export function editorTitle(name: string | null): string {
	if (name === null) return 'Set';
	return name.trim() || 'Untitled set';
}

/**
 * A re-sync whose answer arrived after the set had moved on: an edit, or a save that re-keyed the
 * rows (EDT-42). Its values are for rows as they were, so none is applied.
 */
export const RESYNC_DROPPED_TEXT = 'The set changed while the site was read. Nothing was re-synced. Try again.';

/** The toast title of a re-sync whose read failed (EDT-42). */
export const RESYNC_FAILED_TITLE = 'Could not re-sync from the site';

/** The toast of a re-check whose read failed (CMP-10). */
export const RECHECK_FAILED = { title: 'Could not re-check the entity types', message: 'The site did not answer. Try again.' } as const;
