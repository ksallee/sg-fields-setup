/**
 * Where the keyboard is in the editor's list, in the DOM. The decisions are
 * `editor-session.focusAfterRemoval` and the session's key map; this finds the elements.
 */
import type { FocusTarget } from '$lib/pure/editor-session';

const FOCUSABLE = 'button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])';

const quoted = (value: string): string => `"${CSS.escape(value)}"`;

const rowOf = (pane: HTMLElement, key: string): HTMLElement | null => pane.querySelector<HTMLElement>(`[data-row-key=${quoted(key)}]`);

/** The element a focus target names: a row's toggle, a group's "Add field", "Add entity type". */
export function focusTargetElement(pane: HTMLElement, target: FocusTarget): HTMLElement | null {
	if (target.kind === 'row') return rowOf(pane, target.key)?.querySelector<HTMLElement>('[data-slot="row-toggle"]') ?? null;
	if (target.kind === 'add-field') {
		return pane.querySelector<HTMLElement>(`[data-slot="entry-group"][data-type=${quoted(target.type)}] [data-slot="add-field"]`);
	}
	return pane.querySelector<HTMLElement>('[data-slot="add-entity-type-button"]');
}

/**
 * Remembers which control of which row has focus, before a save. A save re-keys the rows it
 * stored for the first time, and the list draws those again: the focused input is a new element
 * afterwards. `restore` puts focus, and the caret, back on the same control of the same field,
 * given each row's key after the save. It does nothing when focus never left.
 */
export function holdRowFocus(pane: HTMLElement | null): { restore(keys: ReadonlyMap<string, string>): void } {
	const active = document.activeElement;
	const row = active instanceof HTMLElement ? active.closest<HTMLElement>('[data-row-key]') : null;
	if (!pane || !row || !(active instanceof HTMLElement) || !pane.contains(row)) return { restore() {} };
	const key = row.dataset.rowKey ?? '';
	const index = [...row.querySelectorAll<HTMLElement>(FOCUSABLE)].indexOf(active);
	const caret = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? ([active.selectionStart, active.selectionEnd] as const) : null;
	return {
		restore(keys) {
			if (active.isConnected && document.activeElement === active) return;
			const next = rowOf(pane, keys.get(key) ?? key)?.querySelectorAll<HTMLElement>(FOCUSABLE)[index];
			if (!next) return;
			next.focus();
			if (caret && (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement)) {
				try {
					next.setSelectionRange(caret[0], caret[1]);
				} catch {
					/* An input type with no caret, such as a checkbox. */
				}
			}
		}
	};
}
