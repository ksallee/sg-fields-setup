/**
 * The editor's wiring (specs/05-editor.md, specs/06-site-comparison.md): one object that holds
 * what the screen shows and calls the modules that decide it. The page is markup over this.
 *
 * | what                                   | decided by                                        |
 * |----------------------------------------|---------------------------------------------------|
 * | the working copy, each edit            | `working-copy`, `working-copy-bulk`               |
 * | validity, what blocks a button         | `working-copy.validity`, `editor-reasons`         |
 * | the comparison with the site           | `compare`                                         |
 * | groups, rows, counts, empty states     | `editor-view`                                     |
 * | selection                              | `selection`                                       |
 * | what a save sends, keys after a save   | `working-copy-save`, `editor-session`             |
 * | focus after a delete                   | `editor-session.focusAfterRemoval`                |
 * | re-sync                                | `live-to-entry.resyncRows`                        |
 * | deleting the set                       | `$lib/app/delete-set.svelte`                      |
 * | the words                              | `editor-text`, `set-text`, `set-plan`             |
 *
 * The sets come from `sharedSetStore()`. The site, the navigation and the new tab come in through
 * `EditorPorts`, so a test drives this with the real store and a stub site.
 *
 * Everything derived from the working copy is computed once per change, here, and handed down:
 * the validity, the comparison, the view. Rows take plain values and draw their form only while
 * open, which keeps 500 rows usable (MOD-21).
 *
 * One thing at a time on the working copy. While a save is on its way no edit is taken: the save
 * ends by replacing the working copy with the stored one. While a re-sync is on its way Save
 * waits, and a re-sync whose answer finds the working copy changed is dropped (EDT-42).
 */
import { DeleteSet } from '$lib/app/delete-set.svelte';
import { errorMessage, notify } from '$lib/app/toast';
import { readImportBanner } from '$lib/io/import-banner';
import { writeInstallSelection } from '$lib/io/install-selection';
import { sharedSetStore } from '$lib/io/set-store';
import { compareWithSite, type SiteComparison, type SiteData } from '$lib/pure/compare';
import { dataTypeLabel } from '$lib/pure/data-types';
import { duplicateBlock, installBlock, saveBlock, type Block } from '$lib/pure/editor-reasons';
import { focusAfterRemoval, keysAfterSave, pruneKeys, remapKeys, remapSelection, targetTypes, type FocusTarget } from '$lib/pure/editor-session';
import {
	assignedText,
	dataTypeChangedText,
	editorStatus,
	editorTitle,
	RECHECK_FAILED,
	RESYNC_DROPPED_TEXT,
	RESYNC_FAILED_TITLE,
	RESYNC_NONE_TEXT,
	resyncedText,
	savedText,
	type EditorStatus
} from '$lib/pure/editor-text';
import { buildEditorView, type EditorView, type StatusFilter } from '$lib/pure/editor-view';
import type { LiveField } from '$lib/pure/live-field';
import { resyncRows } from '$lib/pure/live-to-entry';
import type { EntryDefinition } from '$lib/pure/model';
import { HOME_PATH, installPath, setPath } from '$lib/pure/routes';
import {
	clickRow,
	deselect,
	EMPTY_SELECTION,
	pruneSelection,
	selectedInOrder,
	selectionSummary,
	toggleGroup,
	type Selection,
	type SelectionSummary
} from '$lib/pure/selection';
import { refusalMessage } from '$lib/pure/set-plan';
import { duplicatedText, failedTitle } from '$lib/pure/set-text';
import {
	addRow,
	cleanedDescription,
	editRow,
	isDirty,
	openWorkingCopy,
	removeRow,
	setDescription,
	setName,
	setNameMode,
	validity,
	type NameMode,
	type Row,
	type WorkingCopy
} from '$lib/pure/working-copy';
import { bulkAssignType, bulkChangeDataType, bulkDelete, bulkResync } from '$lib/pure/working-copy-bulk';
import { draftsOf, installEntries, saveRequest } from '$lib/pure/working-copy-save';

/** The connected site as the editor reads it: `EditorSite` of `./site-data.svelte`, or a stub. */
export interface EditorSiteReads {
	readonly connected: boolean;
	readonly siteUrl: string;
	readonly data: SiteData | null;
	typeLabel(name: string): string | undefined;
	fieldsByType(types: readonly string[]): Promise<Map<string, readonly LiveField[]>>;
	recheck(): Promise<void>;
}

/** What the session reaches outside itself, beside the store. */
export interface EditorPorts {
	site: EditorSiteReads;
	/** In-app navigation: `goto` of `$app/navigation`. */
	goto(to: string | URL): Promise<void>;
	/** Opens a path of the app in a new tab. False when the browser blocked it. */
	openTab(path: string): boolean;
}

/** A navigation as `beforeNavigate` reports it. */
export interface Leaving {
	/** The tab is closing or reloading. */
	willUnload: boolean;
	/** Where to, when it stays in the app. */
	to: URL | null;
}

/** A row to move focus to, and a number that moves with every ask so the same target can be asked twice. */
export interface FocusAsk {
	target: FocusTarget;
	serial: number;
}

const NO_ROWS: readonly Row[] = [];

export class EditorSession {
	/* The set (EDT-1). */

	phase = $state<'loading' | 'ready' | 'missing' | 'failed'>('loading');
	loadError = $state('');
	wc = $state.raw<WorkingCopy | null>(null);
	/** How many fields the import that made this set brought in (IMP-50); null once dismissed. */
	banner = $state<number | null>(null);

	/* What the screen keeps beside the working copy. */

	expanded = $state.raw<ReadonlySet<string>>(new Set());
	selection = $state.raw<Selection>(EMPTY_SELECTION);
	addedGroups = $state.raw<readonly string[]>([]);
	/** The "add entity type" row is open (EDT-19). */
	adding = $state(false);
	search = $state('');
	filter = $state<StatusFilter>('all');
	onSiteFirst = $state(false);
	saving = $state(false);
	saveError = $state<string | null>(null);
	duplicating = $state(false);
	resyncing = $state(false);
	/** The leave prompt is showing (EDT-5). */
	discardOpen = $state(false);
	/** Where the keyboard should go, after a delete took the focused row away. */
	focus = $state.raw<FocusAsk | null>(null);

	/** Deleting the set (EDT-8): the same flow as the list's. */
	readonly deleting: DeleteSet;

	readonly #ports: EditorPorts;
	/** Which load may still write: an older one answers to nobody. */
	#loads = 0;
	/** Set while a navigation the person has already agreed to runs. */
	#leaving = false;
	#discardTo: URL | null = null;
	#focusSerial = 0;

	constructor(ports: EditorPorts) {
		this.#ports = ports;
		this.deleting = new DeleteSet(() => this.leave(HOME_PATH));
		void this.deleting.loadPreference();
	}

	/** The site, for the lines below: they are set up before the constructor has the ports. */
	#site(): EditorSiteReads {
		return this.#ports.site;
	}

	/* Derived once per change, then handed down. Each line is one call into a pure module. */

	readonly rows: readonly Row[] = $derived(this.wc?.rows ?? NO_ROWS);
	readonly rowOf: ReadonlyMap<string, Row> = $derived(new Map(this.rows.map((row) => [row.key, row])));
	readonly dirty: boolean = $derived(this.wc !== null && isDirty(this.wc));
	readonly #valid = $derived(this.wc ? validity(this.wc) : null);
	readonly incomplete: ReadonlySet<string> = $derived(new Set(this.#valid?.incompleteIds));
	readonly duplicated: ReadonlySet<string> = $derived(new Set(this.#valid?.duplicateIds));
	/** Advisory, as the person types, over cached reads only (CMP-11). It never blocks a save (EDT-14). */
	readonly comparison: SiteComparison = $derived(compareWithSite({ rows: this.rows, duplicated: this.duplicated, site: this.#site().data }));
	readonly view: EditorView = $derived(
		buildEditorView({
			rows: this.rows,
			categoryOf: this.comparison.categoryOf,
			typeDisplayName: this.#site().typeLabel,
			addedGroups: this.addedGroups,
			search: this.search,
			filter: this.filter,
			onSiteFirst: this.onSiteFirst,
			addInProgress: this.adding
		})
	);
	/** The selected rows on screen, in order: what a bulk action, Duplicate and Install take (EDT-39 to EDT-43). */
	readonly selectedKeys: string[] = $derived(selectedInOrder(this.selection, this.view.visibleKeys));
	readonly summary: SelectionSummary = $derived(selectionSummary(this.selection, this.view.visibleKeys));
	readonly saveReason: Block | null = $derived(this.wc ? saveBlock(this.wc, { resyncing: this.resyncing }) : null);
	readonly installReason: Block | null = $derived(this.wc ? installBlock(this.wc, this.#site().connected) : null);
	readonly duplicateReason: Block | null = $derived(this.wc ? duplicateBlock(this.wc) : null);
	readonly status: EditorStatus = $derived(editorStatus({ saving: this.saving, failed: this.saveError !== null, dirty: this.dirty }));
	readonly title: string = $derived(editorTitle(this.wc ? this.wc.name : null));
	/** The types whose fields the comparison reads, once each (CMP-2). */
	readonly targetTypes: string[] = $derived(targetTypes(this.rows));
	/** The set as the delete question names it: the stored name and count, not the typed ones. */
	readonly #stored = $derived(this.wc ? { id: this.wc.setId, name: this.wc.saved.name, entryCount: this.wc.saved.entries.length } : null);

	/* Loading (EDT-1). The route keeps the page when only the id changes, so loading follows the id. */

	async load(id: string): Promise<void> {
		const asked = ++this.#loads;
		this.phase = 'loading';
		this.wc = null;
		this.banner = null;
		this.expanded = new Set();
		this.selection = EMPTY_SELECTION;
		this.addedGroups = [];
		this.adding = false;
		this.search = '';
		this.filter = 'all';
		this.saveError = null;
		this.focus = null;
		try {
			const found = await (await sharedSetStore()).getSet(id);
			if (asked !== this.#loads) return;
			if (!found) {
				this.phase = 'missing';
				return;
			}
			this.wc = openWorkingCopy(found.set, found.entries);
			// Read once: the note is cleared by the read, so a reload shows no banner (IMP-50).
			this.banner = readImportBanner(id);
			this.phase = 'ready';
		} catch (error) {
			if (asked !== this.#loads) return;
			this.loadError = errorMessage(error);
			this.phase = 'failed';
		}
	}

	dismissBanner(): void {
		this.banner = null;
	}

	/* Edits. Each one is a new working copy; a new edit clears the last save's failure. */

	#commit(next: WorkingCopy): void {
		// A save ends by replacing the working copy: an edit taken meanwhile would be lost unseen.
		if (next === this.wc || this.saving) return;
		this.wc = next;
		this.saveError = null;
	}

	edit(key: string, patch: Partial<EntryDefinition>): void {
		if (this.wc) this.#commit(editRow(this.wc, key, patch));
	}

	nameMode(key: string, mode: NameMode): void {
		if (this.wc) this.#commit(setNameMode(this.wc, key, mode));
	}

	rename(name: string): void {
		if (this.wc) this.#commit(setName(this.wc, name));
	}

	describe(description: string): void {
		if (this.wc) this.#commit(setDescription(this.wc, description));
	}

	toggle(key: string): void {
		const next = new Set(this.expanded);
		if (!next.delete(key)) next.add(key);
		this.expanded = next;
	}

	clearFilters(): void {
		this.search = '';
		this.filter = 'all';
	}

	/** EDT-18: a blank row on that type, open. The search and filter are cleared so it shows. */
	addField(type: string): void {
		if (!this.wc || this.saving) return;
		const key = `new-${crypto.randomUUID()}`;
		this.#commit(addRow(this.wc, key, type));
		this.expanded = new Set(this.expanded).add(key);
		this.clearFilters();
	}

	/** EDT-19: an empty group, kept for this session only. */
	addGroup(type: string): void {
		this.adding = false;
		if (this.view.groups.some((group) => group.type === type)) return;
		this.addedGroups = [...this.addedGroups, type];
		this.clearFilters();
	}

	/**
	 * After rows went: what pointed at them is dropped, and focus is asked onto a neighbour, read
	 * from the list as it was and as it is now (`focusAfterRemoval`).
	 */
	#forget(before: EditorView, removed: readonly string[], clearAnchor = false): void {
		const keys = this.rows.map((row) => row.key);
		const pruned = pruneSelection(this.selection, keys);
		this.selection = clearAnchor ? { ...pruned, anchor: null } : pruned;
		this.expanded = pruneKeys(this.expanded, keys);
		const target = focusAfterRemoval(before.groups, this.view.groups, removed);
		if (target) this.focus = { target, serial: ++this.#focusSerial };
	}

	/** EDT-33: at once, no confirmation. */
	deleteRow(key: string): void {
		if (!this.wc || this.saving) return;
		const before = this.view;
		this.#commit(removeRow(this.wc, key));
		this.#forget(before, [key]);
	}

	/* Selection and bulk actions (EDT-39 to EDT-43). They act on the selected rows on screen. */

	select(key: string, shift: boolean): void {
		this.selection = clickRow(this.selection, key, shift, this.view.visibleKeys);
	}

	selectGroup(keys: string[]): void {
		this.selection = toggleGroup(this.selection, keys);
	}

	clearSelection(): void {
		this.selection = EMPTY_SELECTION;
	}

	assign(type: string): void {
		if (!this.wc || this.saving) return;
		const keys = this.selectedKeys;
		const result = bulkAssignType(this.wc, keys, type);
		this.#commit(result.workingCopy);
		this.selection = deselect(this.selection, keys);
		if (result.skipped > 0) notify.info(assignedText(keys.length - result.skipped, this.#ports.site.typeLabel(type) ?? type, result.skipped));
	}

	changeDataType(dataType: string): void {
		if (!this.wc || this.saving) return;
		const keys = this.selectedKeys;
		const result = bulkChangeDataType(this.wc, keys, dataType);
		this.#commit(result.workingCopy);
		if (result.skipped > 0) notify.info(dataTypeChangedText(keys.length - result.skipped, dataTypeLabel(dataType), result.skipped));
	}

	/**
	 * EDT-42: the selected rows take the site's values where the site has their field. The read
	 * takes a moment. Its answer is for the working copy it started from: when that one was edited
	 * or saved meanwhile, nothing is applied and the screen says so.
	 */
	async resync(): Promise<void> {
		const site = this.#ports.site;
		const started = this.wc;
		if (!started || this.resyncing || this.saving || !site.connected) return;
		const keys = this.selectedKeys;
		const rows = keys.flatMap((key) => this.rowOf.get(key) ?? []);
		this.resyncing = true;
		try {
			const fieldsByType = await site.fieldsByType(targetTypes(rows));
			if (this.wc !== started || this.saving) {
				if (this.wc !== null) notify.warning(RESYNC_DROPPED_TEXT);
				return;
			}
			const result = resyncRows(rows, fieldsByType, site.siteUrl);
			this.#commit(bulkResync(started, result.updates));
			this.selection = deselect(this.selection, keys);
			if (result.count === 0) notify.warning(RESYNC_NONE_TEXT);
			else notify.success(resyncedText(result.count, keys.length));
		} catch (error) {
			notify.error(error, RESYNC_FAILED_TITLE);
		} finally {
			this.resyncing = false;
		}
	}

	deleteSelected(): void {
		if (!this.wc || this.saving) return;
		const before = this.view;
		const keys = this.selectedKeys;
		this.#commit(bulkDelete(this.wc, keys));
		this.#forget(before, keys, true);
	}

	/** CMP-10: reads the site's type list again. */
	async recheck(): Promise<void> {
		try {
			await this.#ports.site.recheck();
		} catch {
			notify.error(RECHECK_FAILED.message, RECHECK_FAILED.title);
		}
	}

	/* Save (EDT-44 to EDT-48). The store applies it in one transaction or not at all. */

	/**
	 * Saves. Answers each row's key after the save, for whoever holds something by row key (the
	 * page's focus); null when nothing was saved: blocked, already saving, refused or failed. A
	 * refusal or a failure keeps the working copy as it is and shows why (EDT-47).
	 */
	async save(): Promise<ReadonlyMap<string, string> | null> {
		const before = this.wc;
		if (!before || this.saving || this.saveReason !== null) return null;
		this.saving = true;
		this.saveError = null;
		try {
			const result = await (await sharedSetStore()).saveSet(before.setId, saveRequest(before));
			if (!result.ok) {
				this.saveError = refusalMessage(result);
				return null;
			}
			// Rows are keyed by entry id from here on: what was open or selected follows them.
			const keys = keysAfterSave(before, result.added);
			this.wc = openWorkingCopy(result.set, result.entries);
			this.expanded = remapKeys(this.expanded, keys);
			this.selection = remapSelection(this.selection, keys);
			notify.success(savedText(result.set.name));
			return keys;
		} catch (error) {
			this.saveError = errorMessage(error);
			return null;
		} finally {
			this.saving = false;
		}
	}

	/* Leaving while dirty (EDT-5). */

	/**
	 * A navigation is starting. True when it must be cancelled: the set is dirty and the person
	 * has not agreed. One that stays in the app opens the prompt; a closing tab is the browser's
	 * to ask about, in its own words.
	 */
	blocksLeaving(navigation: Leaving): boolean {
		if (this.#leaving || !this.dirty) return false;
		if (navigation.willUnload || !navigation.to) return true;
		this.#discardTo = navigation.to;
		this.discardOpen = true;
		return true;
	}

	/** Navigates with the prompt skipped: the person agreed, or the set is gone. */
	async leave(to: string | URL): Promise<void> {
		this.#leaving = true;
		try {
			await this.#ports.goto(to);
		} finally {
			this.#leaving = false;
		}
	}

	/** The prompt's "Discard changes". */
	discard(): void {
		this.discardOpen = false;
		if (this.#discardTo) void this.leave(this.#discardTo);
	}

	/* Header actions (EDT-7 to EDT-10). */

	/** EDT-8: the set goes, then the list. The leave prompt is skipped (EDT-5). */
	askDelete(): Promise<void> {
		return this.#stored ? this.deleting.ask(this.#stored) : Promise.resolve();
	}

	/**
	 * EDT-9: the working copy as it stands, or the selected rows, as a new set in a new tab. The
	 * whole of it is handed over, so a set deleted in another tab is still copied with its edits.
	 */
	async duplicate(): Promise<void> {
		const wc = this.wc;
		if (!wc || this.duplicating || this.duplicateReason !== null) return;
		const keys = this.selectedKeys.length > 0 ? this.selectedKeys : undefined;
		const failed = failedTitle('duplicate', this.title);
		this.duplicating = true;
		try {
			const result = await (await sharedSetStore()).duplicateSet(wc.setId, {
				name: wc.name,
				description: cleanedDescription(wc),
				entries: draftsOf(wc, keys),
				// Used only when the set was deleted in another tab: the copy is then made from this working copy alone.
				origin: wc.saved.origin,
				originDetails: wc.saved.originDetails
			});
			if (!result.ok) {
				notify.error(refusalMessage(result), failed);
				return;
			}
			notify.success(duplicatedText(result.set.name));
			const path = setPath(result.set.id);
			// A blocked tab: the copy opens here, after the leave prompt if there is unsaved work.
			if (!this.#ports.openTab(path)) await this.#ports.goto(path);
		} catch (error) {
			notify.error(error, failed);
		} finally {
			this.duplicating = false;
		}
	}

	/** EDT-10: the install screen, for the whole set or for the selected rows. */
	install(): void {
		const wc = this.wc;
		if (!wc || this.installReason !== null) return;
		const ids = this.selectedKeys.length > 0 ? installEntries(wc, this.selectedKeys).map((entry) => entry.id) : [];
		writeInstallSelection(wc.setId, ids);
		void this.#ports.goto(installPath(wc.setId, { selection: ids.length > 0 }));
	}
}
