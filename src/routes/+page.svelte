<!--
	The set list (specs/03-set-list.md): the entry point. Wiring only. The list's state is
	`$lib/pure/set-list`, its words `$lib/pure/set-text`, the sets `$lib/io/set-store`.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import FileUp from '@lucide/svelte/icons/file-up';
	import Layers from '@lucide/svelte/icons/layers';
	import Plus from '@lucide/svelte/icons/plus';
	import SearchX from '@lucide/svelte/icons/search-x';
	import Sheet from '@lucide/svelte/icons/sheet';
	import ConfirmDialog from '$lib/app/confirm-dialog.svelte';
	import CreateSetDialog from '$lib/app/create-set-dialog.svelte';
	import ImportDialog from '$lib/app/import-dialog.svelte';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import SetRow from '$lib/app/set-list/set-row.svelte';
	import SetToolbar from '$lib/app/set-list/set-toolbar.svelte';
	import { errorMessage, notify } from '$lib/app/toast';
	import { Button } from '$lib/components/ui/button/index.js';
	import { downloadText } from '$lib/io/download';
	import { importSetFileFrom } from '$lib/io/import-set-file';
	import { sharedSetStore } from '$lib/io/set-store';
	import { liveSchema, prepareLive } from '$lib/live';
	import { setPath } from '$lib/pure/routes';
	import { encodeSetFile } from '$lib/pure/set-file';
	import {
		failLoad,
		initialSetList,
		isFiltered,
		listView,
		receivePage,
		removeRow,
		startLoad,
		startMore,
		type SetListRequest,
		type SetListState
	} from '$lib/pure/set-list';
	import { refusalMessage } from '$lib/pure/set-plan';
	import type { SetSummary } from '$lib/pure/set-query';
	import { deleteQuestion, duplicatedText, importedText, totalText } from '$lib/pure/set-text';
	import { cn } from '$lib/utils.js';

	const SEARCH_DELAY_MS = 300;

	let list = $state.raw(initialSetList());
	/** Why the last load failed, for the retry view. */
	let loadError = $state('');
	const view = $derived(listView(list));

	/** Sends a request the list state handed out, and feeds the answer back (stale ones are dropped there). */
	async function send(started: { state: SetListState; request: SetListRequest } | null): Promise<void> {
		if (!started) return;
		list = started.state;
		const { id, query } = started.request;
		try {
			const page = await (await sharedSetStore()).listSets(query);
			list = receivePage(list, id, page);
		} catch (error) {
			const before = list;
			list = failLoad(list, id);
			if (list === before) return;
			loadError = errorMessage(error);
			notify.error(loadError, 'Could not load the sets');
		}
	}

	const reload = (): Promise<void> => send(startLoad(list));

	/* Search, filter, sort (SET-2, SET-6, SET-7). */

	let searchText = $state('');
	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	function onSearch(): void {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => void send(startLoad(list, { search: searchText })), SEARCH_DELAY_MS);
	}

	/** A filter or sort change goes at once, with whatever is typed in the search box. */
	function change(part: Partial<SetListState['filters']>): void {
		clearTimeout(searchTimer);
		void send(startLoad(list, { search: searchText, ...part }));
	}

	function clearFilters(): void {
		searchText = '';
		change({ origin: null });
	}

	/* Paging on scroll (SET-8): the line under the rows asks for the next page when it shows. */

	let scroller = $state<HTMLElement | null>(null);
	let more = $state<HTMLElement | null>(null);

	$effect(() => {
		// Re-observed after each page, so a line still in view asks again.
		void list.rows.length;
		if (!more || !scroller || list.phase !== 'ready') return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) void send(startMore(list));
			},
			{ root: scroller, rootMargin: '200px' }
		);
		observer.observe(more);
		return () => observer.disconnect();
	});

	/* Row actions. One at a time per row. */

	let busyIds = $state.raw<ReadonlySet<string>>(new Set());

	async function act(id: string, action: () => Promise<void>): Promise<void> {
		if (busyIds.has(id)) return;
		busyIds = new Set(busyIds).add(id);
		try {
			await action();
		} catch (error) {
			notify.error(error);
		} finally {
			const next = new Set(busyIds);
			next.delete(id);
			busyIds = next;
		}
	}

	/** SET-18 to SET-21: one click, a confirmation, the list reloads. */
	function duplicate(row: SetSummary): Promise<void> {
		return act(row.set.id, async () => {
			const result = await (await sharedSetStore()).duplicateSet(row.set.id);
			if (result.ok) notify.success(duplicatedText(result.set.name));
			else notify.error(refusalMessage(result), `Could not duplicate "${row.set.name}"`);
			await reload();
		});
	}

	/** D1: the set as a file. */
	function exportFile(row: SetSummary): Promise<void> {
		return act(row.set.id, async () => {
			const stored = await (await sharedSetStore()).getSet(row.set.id);
			if (!stored) {
				notify.error('This set no longer exists.', `Could not export "${row.set.name}"`);
				await reload();
				return;
			}
			const { text, fileName } = encodeSetFile(stored.set, stored.entries);
			downloadText(fileName, text);
			notify.success(`Exported ${fileName}.`);
		});
	}

	/* Delete (SET-22 to SET-24). */

	let skipDeleteConfirm = $state(false);
	let deleting = $state<SetSummary | null>(null);
	let deleteOpen = $state(false);
	let deleteBusy = $state(false);
	let deleteError = $state<string | null>(null);

	async function removeSet(row: SetSummary): Promise<void> {
		await (await sharedSetStore()).deleteSet(row.set.id);
		list = removeRow(list, row.set.id);
		notify.success(`Deleted "${row.set.name}".`);
	}

	function askDelete(row: SetSummary): void {
		if (skipDeleteConfirm) {
			void act(row.set.id, () => removeSet(row));
			return;
		}
		deleting = row;
		deleteError = null;
		deleteOpen = true;
	}

	async function confirmDelete(remember: boolean): Promise<void> {
		const row = deleting;
		if (!row || deleteBusy) return;
		deleteBusy = true;
		deleteError = null;
		try {
			await removeSet(row);
			deleteBusy = false;
			deleteOpen = false;
		} catch (error) {
			deleteError = errorMessage(error);
			return;
		} finally {
			deleteBusy = false;
		}
		if (!remember) return;
		skipDeleteConfirm = true;
		// The set is gone either way; a preference that did not stick only means one more question.
		void sharedSetStore()
			.then((store) => store.setPreference('skipDeleteSetConfirm', true))
			.catch(() => {});
	}

	/* Create, the spreadsheet import, and set files (SET-1, SET-14 to SET-17, D1). */

	let createOpen = $state(false);
	let importOpen = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);

	async function importFiles(): Promise<void> {
		const files = [...(fileInput?.files ?? [])];
		if (fileInput) fileInput.value = '';
		for (const file of files) {
			const title = `Could not import ${file.name}`;
			try {
				const result = await importSetFileFrom(await sharedSetStore(), file);
				if (result.ok) notify.success(importedText(result));
				else notify.error(result.message, title);
			} catch (error) {
				notify.error(error, title);
			}
		}
		if (files.length > 0) await reload();
	}

	/* On entering: the first page, the remembered preference, and the schema warm-up. */

	void send(startLoad(initialSetList()));

	void sharedSetStore()
		.then((store) => store.getPreferences())
		.then((preferences) => (skipDeleteConfirm = preferences.skipDeleteSetConfirm))
		.catch(() => {});

	// SET-25, SET-26: best effort, never awaited, only with a site that can be read.
	void prepareLive()
		.then((live) => {
			if (live.siteUrl !== '' && live.problem === null) void liveSchema().warmUp();
		})
		.catch(() => {});
</script>

<svelte:head><title>Sets · SG Fields Setup</title></svelte:head>

<PageHeader title="Sets" context="Named lists of field definitions, kept in this browser.">
	{#snippet actions()}
		<Button variant="ghost" onclick={() => fileInput?.click()} title="Import a set file exported from this app" data-slot="import-set-file">
			<FileUp data-icon="inline-start" /><span class="max-sm:sr-only">Import set file</span>
		</Button>
		<Button variant="outline" onclick={() => (createOpen = true)} data-slot="new-set"><Plus data-icon="inline-start" />New set</Button>
		<Button onclick={() => (importOpen = true)} data-slot="import-spreadsheet"><Sheet data-icon="inline-start" />Import spreadsheet</Button>
	{/snippet}
	{#if view !== 'empty' && view !== 'failed' && !(view === 'loading' && !isFiltered(list.filters))}
		<SetToolbar
			bind:search={searchText}
			filters={list.filters}
			summary={view === 'rows' ? totalText(list.total, isFiltered(list.filters)) : undefined}
			onsearch={onSearch}
			onorigin={(origin) => change({ origin })}
			onsort={(sort) => change({ sort })}
		/>
	{/if}
</PageHeader>

<input bind:this={fileInput} type="file" accept=".json,application/json" multiple hidden onchange={importFiles} data-slot="set-file-input" />

<div bind:this={scroller} class="flex min-h-0 flex-1 flex-col overflow-y-auto" data-slot="set-list-pane">
	{#if view === 'loading'}
		<PageState state="loading" title="Loading sets…" />
	{:else if view === 'failed'}
		<PageState state="error" title="The sets did not load" line={loadError}>
			{#snippet action()}<Button variant="outline" onclick={reload}>Try again</Button>{/snippet}
		</PageState>
	{:else if view === 'empty'}
		<PageState state="empty" icon={Layers} title="No sets yet" line="Import a spreadsheet of fields, or build a set by hand.">
			{#snippet action()}
				<Button variant="outline" onclick={() => (createOpen = true)}><Plus data-icon="inline-start" />New set</Button>
				<Button onclick={() => (importOpen = true)}><Sheet data-icon="inline-start" />Import spreadsheet</Button>
			{/snippet}
		</PageState>
	{:else if view === 'noMatch'}
		<PageState state="empty" icon={SearchX} title="No set matches" line="Try another search, or clear the search and the filter.">
			{#snippet action()}<Button variant="outline" onclick={clearFilters}>Clear search and filter</Button>{/snippet}
		</PageState>
	{:else}
		<div class="w-full px-4 pb-6" aria-busy={list.phase === 'loading'}>
			<ul class={cn('flex flex-col transition-opacity', list.phase === 'loading' && 'opacity-60')} data-slot="set-list">
				{#each list.rows as row (row.set.id)}
					<SetRow
						{row}
						busy={busyIds.has(row.set.id)}
						onduplicate={() => duplicate(row)}
						onexport={() => exportFile(row)}
						ondelete={() => askDelete(row)}
					/>
				{/each}
			</ul>
			{#if list.hasMore}
				<p bind:this={more} class="text-muted-foreground px-2 py-3 text-sm" role="status" data-slot="set-list-more">Loading more…</p>
			{/if}
		</div>
	{/if}
</div>

<CreateSetDialog
	bind:open={createOpen}
	oncreated={(set) => {
		notify.success(`Created "${set.name}".`);
		void goto(setPath(set.id));
	}}
/>

<ImportDialog bind:open={importOpen} oncreated={(setId) => void goto(setPath(setId))} />

<ConfirmDialog
	bind:open={deleteOpen}
	title="Delete this set?"
	message={deleting ? deleteQuestion(deleting.set.name, deleting.entryCount) : ''}
	confirmLabel="Delete set"
	destructive
	rememberLabel="Do not ask again when deleting a set"
	busy={deleteBusy}
	error={deleteError}
	onconfirm={({ remember }) => confirmDelete(remember)}
/>
