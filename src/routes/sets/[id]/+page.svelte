<!--
	The editor (specs/05-editor.md, specs/06-site-comparison.md): one set, all its fields, edited
	locally until Save. Wiring only. The working copy is `$lib/pure/working-copy`, the list's view
	`$lib/pure/editor-view`, the selection `$lib/pure/selection`, the comparison `$lib/pure/compare`,
	the words `$lib/pure/editor-text`, the sets `$lib/io/set-store`. The pieces are in
	`$lib/app/editor/`.

	Everything derived from the working copy is computed once per change, here, and handed down:
	the validity, the comparison, the view. Rows take plain values and draw their form only while
	open, which keeps 500 rows usable (MOD-21).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import Download from '@lucide/svelte/icons/download';
	import Layers from '@lucide/svelte/icons/layers';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Plus from '@lucide/svelte/icons/plus';
	import Save from '@lucide/svelte/icons/save';
	import SearchX from '@lucide/svelte/icons/search-x';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import X from '@lucide/svelte/icons/x';
	import ConfirmDialog from '$lib/app/confirm-dialog.svelte';
	import AddEntityType from '$lib/app/editor/add-entity-type.svelte';
	import BulkBar from '$lib/app/editor/bulk-bar.svelte';
	import EditorToolbar from '$lib/app/editor/editor-toolbar.svelte';
	import EntryGroup from '$lib/app/editor/entry-group.svelte';
	import HeaderAction from '$lib/app/editor/header-action.svelte';
	import SetDetails from '$lib/app/editor/set-details.svelte';
	import { EditorSite } from '$lib/app/editor/site-data.svelte';
	import IconButton from '$lib/app/icon-button.svelte';
	import Notice from '$lib/app/notice.svelte';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import { errorMessage, notify } from '$lib/app/toast';
	import { Button } from '$lib/components/ui/button/index.js';
	import { readImportBanner } from '$lib/io/import-banner';
	import { writeInstallSelection } from '$lib/io/install-selection';
	import { sharedSetStore } from '$lib/io/set-store';
	import { compareWithSite } from '$lib/pure/compare';
	import { dataTypeLabel } from '$lib/pure/data-types';
	import { blockText, duplicateBlock, installBlock, saveBlock } from '$lib/pure/editor-reasons';
	import { keysAfterSave, remapKeys, remapSelection, targetTypes } from '$lib/pure/editor-session';
	import {
		assignedText,
		dataTypeChangedText,
		duplicateLabel,
		editorStatus,
		installLabel,
		resyncedText,
		RESYNC_NONE_TEXT,
		savedText,
		STATUS_TEXT
	} from '$lib/pure/editor-text';
	import { buildEditorView, type StatusFilter } from '$lib/pure/editor-view';
	import { importBannerText } from '$lib/pure/import-build';
	import { resyncRows } from '$lib/pure/live-to-entry';
	import type { EntryDefinition } from '$lib/pure/model';
	import { HOME_PATH, installPath, setPath } from '$lib/pure/routes';
	import {
		clickRow,
		deselect,
		EMPTY_SELECTION,
		groupCheckState,
		pruneSelection,
		selectedInOrder,
		selectionSummary,
		toggleGroup,
		type Selection
	} from '$lib/pure/selection';
	import { refusalMessage } from '$lib/pure/set-plan';
	import { deleteQuestion, duplicatedText, fieldCount } from '$lib/pure/set-text';
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
	import { afterSave, draftsOf, installEntries, saveRequest } from '$lib/pure/working-copy-save';
	import { cn } from '$lib/utils.js';

	const BACK = { href: HOME_PATH, label: 'Sets' };
	const NO_ROWS: readonly Row[] = [];

	/* The site, read once per session and only in the background (CMP-1, CMP-2). */

	const site = new EditorSite();
	void site.connect();

	/* The set (EDT-1). The route keeps this page when only the id changes, so loading follows the id. */

	let phase = $state<'loading' | 'ready' | 'missing' | 'failed'>('loading');
	let loadError = $state('');
	let wc = $state.raw<WorkingCopy | null>(null);
	/** How many fields the import that made this set brought in (IMP-50); null once dismissed. */
	let banner = $state<number | null>(null);

	/* What the screen keeps beside the working copy. */

	let expanded = $state.raw<ReadonlySet<string>>(new Set());
	let selection = $state.raw<Selection>(EMPTY_SELECTION);
	let addedGroups = $state.raw<readonly string[]>([]);
	let adding = $state(false);
	let search = $state('');
	let filter = $state<StatusFilter>('all');
	let onSiteFirst = $state(false);
	let saving = $state(false);
	let saveError = $state<string | null>(null);
	let duplicating = $state(false);
	let resyncing = $state(false);

	async function load(id: string): Promise<void> {
		phase = 'loading';
		wc = null;
		banner = null;
		expanded = new Set();
		selection = EMPTY_SELECTION;
		addedGroups = [];
		adding = false;
		search = '';
		filter = 'all';
		saveError = null;
		try {
			const found = await (await sharedSetStore()).getSet(id);
			if (id !== page.params.id) return;
			if (!found) {
				phase = 'missing';
				return;
			}
			wc = openWorkingCopy(found.set, found.entries);
			banner = readImportBanner(id);
			phase = 'ready';
		} catch (error) {
			if (id !== page.params.id) return;
			loadError = errorMessage(error);
			phase = 'failed';
		}
	}

	$effect(() => {
		const id = page.params.id ?? '';
		untrack(() => void load(id));
	});

	/* Derived once per change, then handed down. */

	const rows = $derived(wc?.rows ?? NO_ROWS);
	const rowOf = $derived(new Map(rows.map((row) => [row.key, row])));
	const dirty = $derived(wc !== null && isDirty(wc));
	const valid = $derived(wc ? validity(wc) : null);
	const incomplete = $derived(new Set(valid?.incompleteIds));
	const duplicated = $derived(new Set(valid?.duplicateIds));
	// Advisory, as the user types, over cached reads only (CMP-11). It never blocks a save (EDT-14).
	const comparison = $derived(compareWithSite({ rows, duplicated, site: site.data }));
	const view = $derived(
		buildEditorView({
			rows,
			categoryOf: comparison.categoryOf,
			typeDisplayName: site.typeLabel,
			addedGroups,
			search,
			filter,
			onSiteFirst,
			addInProgress: adding
		})
	);
	const selectedKeys = $derived(selectedInOrder(selection, view.visibleKeys));
	const summary = $derived(selectionSummary(selection, view.visibleKeys));
	const saveReason = $derived(wc ? saveBlock(wc) : null);
	const installReason = $derived(wc ? installBlock(wc, site.connected) : null);
	const duplicateReason = $derived(wc ? duplicateBlock(wc) : null);
	const status = $derived(editorStatus({ saving, failed: saveError !== null, dirty }));
	const title = $derived(wc ? wc.name.trim() || 'Untitled set' : 'Set');

	// CMP-2: each distinct target type's fields, read once, in the background.
	$effect(() => site.ensureFields(targetTypes(rows)));

	/* Edits. Each one is a new working copy; a new edit clears the last save's failure. */

	function commit(next: WorkingCopy): void {
		if (next === wc) return;
		wc = next;
		saveError = null;
	}

	const edit = (key: string, patch: Partial<EntryDefinition>): void => void (wc && commit(editRow(wc, key, patch)));
	const nameMode = (key: string, mode: NameMode): void => void (wc && commit(setNameMode(wc, key, mode)));

	function toggle(key: string): void {
		const next = new Set(expanded);
		if (!next.delete(key)) next.add(key);
		expanded = next;
	}

	/** EDT-18: a blank row on that type, open. The search and filter are cleared so it shows. */
	function addField(type: string): void {
		if (!wc) return;
		const key = `new-${crypto.randomUUID()}`;
		commit(addRow(wc, key, type));
		expanded = new Set(expanded).add(key);
		search = '';
		filter = 'all';
	}

	/** EDT-19: an empty group, kept for this session only. */
	function addGroup(type: string): void {
		adding = false;
		if (view.groups.some((group) => group.type === type)) return;
		addedGroups = [...addedGroups, type];
		search = '';
		filter = 'all';
	}

	/** Drops what points at rows that are gone. */
	function forget(next: WorkingCopy, clearAnchor = false): void {
		const keys = next.rows.map((row) => row.key);
		const pruned = pruneSelection(selection, keys);
		selection = clearAnchor ? { ...pruned, anchor: null } : pruned;
		const existing = new Set(keys);
		expanded = new Set([...expanded].filter((key) => existing.has(key)));
	}

	/** EDT-33: at once, no confirmation. */
	function deleteRow(key: string): void {
		if (!wc) return;
		const next = removeRow(wc, key);
		commit(next);
		forget(next);
	}

	/* Selection and bulk actions (EDT-39 to EDT-43). They act on the selected rows on screen. */

	const select = (key: string, shift: boolean): void => void (selection = clickRow(selection, key, shift, view.visibleKeys));
	const selectGroup = (keys: string[]): void => void (selection = toggleGroup(selection, keys));

	function assign(type: string): void {
		if (!wc) return;
		const keys = selectedKeys;
		const result = bulkAssignType(wc, keys, type);
		commit(result.workingCopy);
		selection = deselect(selection, keys);
		if (result.skipped > 0) notify.info(assignedText(keys.length - result.skipped, site.typeLabel(type) ?? type, result.skipped));
	}

	function changeDataType(dataType: string): void {
		if (!wc) return;
		const keys = selectedKeys;
		const result = bulkChangeDataType(wc, keys, dataType);
		commit(result.workingCopy);
		if (result.skipped > 0) notify.info(dataTypeChangedText(keys.length - result.skipped, dataTypeLabel(dataType), result.skipped));
	}

	/** EDT-42: the selected rows take the site's values where the site has their field. */
	async function resync(): Promise<void> {
		if (!wc || resyncing || !site.connected) return;
		const keys = selectedKeys;
		resyncing = true;
		try {
			const fieldsByType = await site.fieldsByType(targetTypes(keys.flatMap((key) => rowOf.get(key) ?? [])));
			if (!wc) return;
			// The rows as they stand now: the read took a moment.
			const result = resyncRows(
				keys.flatMap((key) => rowOf.get(key) ?? []),
				fieldsByType,
				site.siteUrl
			);
			commit(bulkResync(wc, result.updates));
			selection = deselect(selection, keys);
			if (result.count === 0) notify.warning(RESYNC_NONE_TEXT);
			else notify.success(resyncedText(result.count, keys.length));
		} catch (error) {
			notify.error(error, 'Could not re-sync from the site');
		} finally {
			resyncing = false;
		}
	}

	function deleteSelected(): void {
		if (!wc) return;
		const next = bulkDelete(wc, selectedKeys);
		commit(next);
		forget(next, true);
	}

	async function recheck(): Promise<void> {
		try {
			await site.recheck();
		} catch {
			notify.error('The site did not answer. Try again.', 'Could not re-check the entity types');
		}
	}

	/* Save (EDT-44 to EDT-48). The store applies it in one transaction or not at all. */

	async function save(): Promise<void> {
		if (!wc || saving || saveBlock(wc) !== null) return;
		const before = wc;
		saving = true;
		saveError = null;
		try {
			const result = await (await sharedSetStore()).saveSet(before.setId, saveRequest(before));
			if (!result.ok) {
				saveError = refusalMessage(result);
				return;
			}
			// Rows are keyed by entry id from here on: what was open or selected follows them.
			const keys = keysAfterSave(before, result.added);
			wc = afterSave(before, result.set, result.entries);
			expanded = remapKeys(expanded, keys);
			selection = remapSelection(selection, keys);
			notify.success(savedText(result.set.name));
		} catch (error) {
			saveError = errorMessage(error);
		} finally {
			saving = false;
		}
	}

	function onkeydown(event: KeyboardEvent): void {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && phase === 'ready') {
			event.preventDefault();
			void save();
		}
	}

	/* Leaving while dirty (EDT-5). */

	/** Set while a navigation the user has already agreed to runs. */
	let leaving = false;
	let discardOpen = $state(false);
	let discardTo: URL | null = null;

	beforeNavigate((navigation) => {
		if (leaving || !dirty) return;
		// Closing or reloading the tab: the browser asks in its own words.
		if (navigation.willUnload || !navigation.to) {
			navigation.cancel();
			return;
		}
		navigation.cancel();
		discardTo = navigation.to.url;
		discardOpen = true;
	});

	async function leave(to: string | URL): Promise<void> {
		leaving = true;
		try {
			await goto(to);
		} finally {
			leaving = false;
		}
	}

	function discard(): void {
		discardOpen = false;
		if (discardTo) void leave(discardTo);
	}

	/* Header actions (EDT-7 to EDT-10). */

	let skipDeleteConfirm = $state(false);
	let deleteOpen = $state(false);
	let deleteBusy = $state(false);
	let deleteError = $state<string | null>(null);

	void sharedSetStore()
		.then((store) => store.getPreferences())
		.then((preferences) => (skipDeleteConfirm = preferences.skipDeleteSetConfirm))
		.catch(() => {});

	/** EDT-8: the set goes, then the list. The leave prompt is skipped (EDT-5). */
	async function removeSet(): Promise<void> {
		if (!wc) return;
		const name = wc.saved.name;
		await (await sharedSetStore()).deleteSet(wc.setId);
		notify.success(`Deleted "${name}".`);
		await leave(HOME_PATH);
	}

	function askDelete(): void {
		if (skipDeleteConfirm) {
			void removeSet().catch((error) => notify.error(error, 'Could not delete the set'));
			return;
		}
		deleteError = null;
		deleteOpen = true;
	}

	async function confirmDelete(remember: boolean): Promise<void> {
		if (deleteBusy) return;
		deleteBusy = true;
		deleteError = null;
		if (remember) {
			skipDeleteConfirm = true;
			void sharedSetStore()
				.then((store) => store.setPreference('skipDeleteSetConfirm', true))
				.catch(() => {});
		}
		try {
			await removeSet();
			deleteOpen = false;
		} catch (error) {
			deleteError = errorMessage(error);
		} finally {
			deleteBusy = false;
		}
	}

	/** EDT-9: the working copy as it stands, or the selected rows, as a new set in a new tab. */
	async function duplicate(): Promise<void> {
		if (!wc || duplicating || duplicateBlock(wc) !== null) return;
		const keys = selectedKeys.length > 0 ? selectedKeys : undefined;
		duplicating = true;
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
				notify.error(refusalMessage(result), `Could not duplicate "${title}"`);
				return;
			}
			notify.success(duplicatedText(result.set.name));
			const path = setPath(result.set.id);
			const tab = window.open(path, '_blank');
			if (tab) tab.opener = null;
			// A blocked tab: the copy opens here, after the leave prompt if there is unsaved work.
			else await goto(path);
		} catch (error) {
			notify.error(error, `Could not duplicate "${title}"`);
		} finally {
			duplicating = false;
		}
	}

	/** EDT-10: the install screen, for the whole set or for the selected rows. */
	function install(): void {
		if (!wc || installBlock(wc, site.connected) !== null) return;
		const ids = selectedKeys.length > 0 ? installEntries(wc, selectedKeys).map((entry) => entry.id) : [];
		writeInstallSelection(wc.setId, ids);
		void goto(installPath(wc.setId, { selection: ids.length > 0 }));
	}
</script>

<svelte:head><title>{title} · SG Fields Setup</title></svelte:head>
<svelte:window {onkeydown} />

{#if phase === 'loading'}
	<PageState state="loading" title="Loading the set…" />
{:else if phase === 'missing'}
	<PageState state="empty" title="Set not found" line="It may have been deleted, or it was made in another browser.">
		{#snippet action()}<Button variant="outline" href={HOME_PATH}>Back to sets</Button>{/snippet}
	</PageState>
{:else if phase === 'failed' || !wc}
	<PageState state="error" title="The set did not load" line={loadError}>
		{#snippet action()}<Button variant="outline" href={HOME_PATH}>Back to sets</Button>{/snippet}
	</PageState>
{:else}
	<PageHeader {title} back={BACK}>
		{#snippet context()}
			<span class="flex items-center gap-1.5" role="status" aria-live="polite" data-slot="editor-status" data-status={status}>
				{#if status === 'saving'}
					<LoaderCircle class="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
				{:else if status === 'saved'}
					<Check class="text-success size-3.5" aria-hidden="true" />
				{:else}
					<span class={cn('size-1.5 rounded-full', status === 'error' ? 'bg-destructive' : 'bg-warning')} aria-hidden="true"></span>
				{/if}
				<span class={cn(status === 'error' && 'text-destructive', status === 'dirty' && 'text-foreground')}>{STATUS_TEXT[status]}</span>
			</span>
			<span aria-hidden="true">·</span>
			<span class="tabular-nums" data-slot="field-count">{fieldCount(rows.length)}</span>
		{/snippet}
		{#snippet actions()}
			<Button variant="ghost" class="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onclick={askDelete} data-slot="delete-set">
				<Trash2 data-icon="inline-start" /><span class="max-sm:sr-only">Delete set</span>
			</Button>
			<HeaderAction slot="duplicate" reason={duplicateReason && blockText(duplicateReason)} busy={duplicating} onclick={duplicate}>
				<Copy data-icon="inline-start" />{duplicateLabel(selectedKeys.length)}
			</HeaderAction>
			<HeaderAction slot="install" reason={installReason && blockText(installReason)} onclick={install}>
				<Download data-icon="inline-start" />{installLabel(selectedKeys.length)}
			</HeaderAction>
			<HeaderAction slot="save" variant="default" reason={saveReason && blockText(saveReason)} busy={saving} onclick={save}>
				<Save data-icon="inline-start" />Save
			</HeaderAction>
		{/snippet}
		{#if view.showToolbar}
			<EditorToolbar
				{search}
				{filter}
				{onSiteFirst}
				counts={view.counts}
				highlightNeedsAttention={view.highlightNeedsAttention}
				onsearch={(text) => (search = text)}
				onfilter={(next) => (filter = next)}
				ononsitefirst={(on) => (onSiteFirst = on)}
			/>
		{/if}
	</PageHeader>

	<div class="relative flex min-h-0 flex-1 flex-col overflow-y-auto" inert={saving} aria-busy={saving} data-slot="editor-pane">
		<div class="flex flex-1 flex-col gap-6 py-4">
			{#if banner !== null || saveError !== null}
				<div class="flex flex-col gap-3 px-6">
					{#if saveError !== null}
						<Notice tone="destructive" title="Not saved." data-slot="save-error">{saveError} Your changes are kept. Save again when ready.</Notice>
					{/if}
					{#if banner !== null}
						<Notice tone="info" data-slot="import-banner">
							{importBannerText(banner)}
							{#snippet action()}<IconButton label="Dismiss" icon={X} onclick={() => (banner = null)} />{/snippet}
						</Notice>
					{/if}
				</div>
			{/if}

			<div class="px-6">
				<SetDetails
					name={wc.name}
					description={wc.description}
					onname={(name) => wc && commit(setName(wc, name))}
					ondescription={(description) => wc && commit(setDescription(wc, description))}
				/>
			</div>

			<section class="flex flex-1 flex-col gap-3" aria-label="Fields" data-slot="entry-list">
				<div class="flex items-center gap-3 px-6">
					<h2 class="text-sm font-semibold">Fields</h2>
					<Button variant="outline" class="ml-auto" disabled={adding} onclick={() => (adding = true)} data-slot="add-entity-type-button">
						<Plus data-icon="inline-start" />Add entity type
					</Button>
				</div>

				{#if adding}
					<div class="px-6">
						<AddEntityType
							context={site.context}
							taken={view.groups.filter((group) => !group.unassigned).map((group) => group.type)}
							onadd={addGroup}
							oncancel={() => (adding = false)}
						/>
					</div>
				{/if}

				{#if view.emptyState === 'no_entries'}
					<PageState
						state="empty"
						icon={Layers}
						title="No fields yet"
						line="Add an entity type, then its fields. Or import a spreadsheet from the set list."
					>
						{#snippet action()}
							<Button variant="outline" onclick={() => (adding = true)}><Plus data-icon="inline-start" />Add entity type</Button>
						{/snippet}
					</PageState>
				{:else if view.emptyState === 'no_matches'}
					<PageState state="empty" icon={SearchX} title="No field matches" line="Try another search, or clear the search and the filter.">
						{#snippet action()}
							<Button
								variant="outline"
								onclick={() => {
									search = '';
									filter = 'all';
								}}>Clear search and filter</Button
							>
						{/snippet}
					</PageState>
				{/if}

				<div class="flex flex-col gap-4 px-4">
					{#each view.groups as group (group.type)}
						<EntryGroup
							{group}
							{rowOf}
							comparisonOf={comparison.byKey}
							{incomplete}
							{duplicated}
							selected={selection.selected}
							{expanded}
							checkState={groupCheckState(selection, group.keys)}
							notOnSite={comparison.notOnSite.has(group.type)}
							rechecking={site.rechecking}
							context={site.context}
							onadd={addField}
							ontogglegroup={selectGroup}
							onrecheck={recheck}
							ontoggle={toggle}
							onselect={select}
							onedit={edit}
							onnamemode={nameMode}
							ondelete={deleteRow}
						/>
					{/each}
				</div>
			</section>
		</div>

		{#if selection.selected.size > 0}
			<BulkBar
				{summary}
				context={site.context}
				{resyncing}
				onassign={assign}
				ondatatype={changeDataType}
				onresync={resync}
				ondelete={deleteSelected}
				onclear={() => (selection = EMPTY_SELECTION)}
			/>
		{/if}
	</div>

	<ConfirmDialog
		bind:open={deleteOpen}
		title="Delete this set?"
		message={deleteQuestion(wc.saved.name, wc.saved.entries.length)}
		confirmLabel="Delete set"
		destructive
		rememberLabel="Do not ask again when deleting a set"
		busy={deleteBusy}
		error={deleteError}
		onconfirm={({ remember }) => confirmDelete(remember)}
	/>

	<ConfirmDialog
		bind:open={discardOpen}
		title="Discard unsaved changes?"
		message="This set has changes that are not saved. Leaving discards them."
		confirmLabel="Discard changes"
		cancelLabel="Keep editing"
		destructive
		onconfirm={discard}
	/>
{/if}
