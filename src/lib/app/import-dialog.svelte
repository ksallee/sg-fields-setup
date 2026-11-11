<!--
	The spreadsheet import (specs/04-import.md, IMP-1 to IMP-16, IMP-26, IMP-49 to IMP-52). Wiring
	only: the dialog's state is `$lib/pure/import-dialog`, the entries `$lib/pure/import-build`, the
	file read `$lib/io/read-spreadsheet`.

	The contract with the set list: `open` is bound by the list's header action and its empty
	state; `oncreated` is called with the id of the set the import stored, after the dialog has
	closed. The list then opens the editor on it, which shows the banner `$lib/io/import-banner`
	hands over (IMP-50).

	Buckets show as soon as their file is parsed. The schema is read after, for the inferred
	fallbacks, and again on confirm for the types the import resolves to: neither holds a bucket
	back (IMP-7).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import EntityTypePicker from '$lib/components/entity-type-picker.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { writeImportBanner } from '$lib/io/import-banner';
	import { readSpreadsheet } from '$lib/io/read-spreadsheet';
	import { commonFields, readImportSite } from '$lib/io/import-site';
	import { sharedSetStore } from '$lib/io/set-store';
	import { liveContext, liveSchema, prepareLive } from '$lib/live';
	import { COMMON_ENTITY_TYPES } from '$lib/pure/common-entity-types';
	import {
		bucketColumnCount,
		buildEntries,
		importFooterText,
		importSuccessText,
		inferFallback
	} from '$lib/pure/import-build';
	import {
		acceptFile,
		applyInferredFallback,
		bucketsFromFile,
		bucketsOf,
		confirmEnabled,
		finishAdding,
		failSaving,
		fallbackLabel,
		IMPORT_ACCEPT,
		initialImportDialog,
		NO_COLUMNS_TEXT,
		problemText,
		refuseFile,
		removeBucket,
		setFallback,
		startAdding,
		startSaving,
		TYPES_UNREAD_TEXT,
		type BucketRow
	} from '$lib/pure/import-dialog';
	import { IMPORT_MODE_LABELS, IMPORT_MODES, importModeHint, type ImportMode } from '$lib/pure/import-entity-type';
	import { refusalMessage } from '$lib/pure/set-plan';
	import { countText } from '$lib/pure/set-text';
	import { isConnected } from '$lib/pure/site';
	import FileDrop from './file-drop.svelte';
	import IconButton from './icon-button.svelte';
	import Notice from './notice.svelte';
	import { errorMessage, notify } from './toast';

	let {
		open = $bindable(false),
		oncreated
	}: { open?: boolean; oncreated?: (setId: string) => void } = $props();

	let dialog = $state.raw(initialImportDialog());
	/** The site's URL when it can be read, else null: no matching, no inference, typed fallbacks (IMP-52). */
	let site = $state<string | null>(null);

	/**
	 * A fallback chooser's list is showing. Escape then closes that list and not the dialog, which
	 * would throw the buckets away. Cleared a moment after the list, so the same key press still
	 * finds it set.
	 */
	let choosing = $state(false);
	function onChooserOpen(isOpen: boolean): void {
		if (isOpen) choosing = true;
		else setTimeout(() => (choosing = false));
	}

	const saving = $derived(dialog.saving);
	const problem = $derived(problemText(dialog));
	const buckets = $derived(bucketsOf(dialog));

	// Every opening starts empty, and closing discards the buckets (IMP-13). The new session
	// number makes a file or an inference still on its way answer to nobody.
	$effect(() => {
		const opened = open;
		untrack(() => {
			dialog = initialImportDialog(dialog.session + 1);
			choosing = false;
			if (!opened) return;
			const session = dialog.session;
			void prepareLive().then((live) => {
				if (dialog.session !== session) return;
				site = isConnected(live) ? live.siteUrl : null;
				// Ahead of the confirm, which needs the type list. A failure waits for the confirm to say so.
				if (site !== null) void liveSchema().entityTypes().catch(() => {});
			});
		});
	});

	/* Files in (IMP-1 to IMP-7, IMP-12). One after the other, so buckets keep the order of the drop. */

	async function addFiles(files: File[]): Promise<void> {
		if (dialog.saving) return;
		dialog = startAdding(dialog);
		const session = dialog.session;
		try {
			for (const file of files) {
				const read = await readSpreadsheet(file);
				if (dialog.session !== session) return;
				const parsed = read.ok ? bucketsFromFile(file.name, read.content) : read;
				if (!parsed.ok) {
					dialog = refuseFile(dialog, session, parsed.problem, file.name);
					continue;
				}
				const accepted = acceptFile(dialog, session, file.name, parsed.buckets);
				dialog = accepted.state;
				if (site !== null) void infer(accepted.added, session);
			}
		} finally {
			dialog = finishAdding(dialog, session);
		}
	}

	/** Pre-fills the new buckets' fallbacks from the common types' fields, when they answer (IMP-15, IMP-16). */
	async function infer(rows: readonly BucketRow[], session: number): Promise<void> {
		const fieldsByType = await commonFields(liveSchema());
		for (const row of rows) {
			const inferred = inferFallback(row.bucket, fieldsByType, COMMON_ENTITY_TYPES, dialog.delimiter);
			dialog = applyInferredFallback(dialog, session, row.id, inferred);
		}
	}

	/* Confirm (IMP-11, IMP-29, IMP-49 to IMP-51). */

	async function confirm(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const started = startSaving(dialog);
		if (!started) return;
		dialog = started;
		const { session, mode, delimiter, setName } = started;
		const from = bucketsOf(started);
		const fail = (message: string): void => {
			dialog = failSaving(dialog, session, message);
		};
		try {
			// The site's types, and the fields of the types this import resolves to and no others (IMP-29).
			const live = site === null ? null : await readImportSite(liveSchema(), site, from, mode, delimiter);
			if (site !== null && live === null) return fail(TYPES_UNREAD_TEXT);
			const built = buildEntries({ buckets: from, mode, delimiter, site: live, importedAt: new Date().toISOString() });
			if (built.entries.length === 0) return fail(NO_COLUMNS_TEXT);
			const store = await sharedSetStore();
			const result = await store.createSet({ name: setName, origin: 'import', originDetails: built.originDetails, entries: built.entries });
			if (!result.ok) return fail(refusalMessage(result));
			writeImportBanner(result.set.id, result.entries.length);
			open = false;
			notify.success(importSuccessText(result.entries.length, built.dropped));
			oncreated?.(result.set.id);
		} catch (caught) {
			fail(errorMessage(caught));
		}
	}
</script>

<Dialog.Root
	bind:open={
		() => open,
		(next) => {
			if (!saving) open = next;
		}
	}
>
	<Dialog.Content
		data-slot="import-dialog"
		class="max-h-[calc(100dvh_-_2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-xl"
		showCloseButton={!saving}
		escapeKeydownBehavior={saving || choosing ? 'ignore' : 'close'}
		interactOutsideBehavior={saving ? 'ignore' : 'close'}
	>
		<form class="contents" onsubmit={confirm}>
			<Dialog.Header>
				<Dialog.Title>Import a spreadsheet</Dialog.Title>
				<Dialog.Description>Each column header becomes one field of a new set.</Dialog.Description>
			</Dialog.Header>

			<!-- The padding and its negative margin keep focus rings from being cut by the scroll box. -->
			<div class="-mx-4 flex flex-col gap-4 overflow-y-auto px-4 py-0.5">
				<FileDrop
					title={buckets.length > 0 ? 'Drop more files here' : 'Drop CSV or XLSX files here'}
					hint="One set from all of them. Only the headers and a few rows are read."
					accept={IMPORT_ACCEPT}
					compact={buckets.length > 0}
					busy={dialog.reading > 0}
					disabled={saving}
					onfiles={(files) => void addFiles(files)}
				/>

				{#if problem}<Notice tone="destructive" data-slot="import-problem">{problem}</Notice>{/if}

				{#if dialog.rows.length > 0}
					<section class="flex flex-col" aria-label="Files" data-slot="import-buckets">
						<div class="text-muted-foreground flex items-center gap-2 border-b pb-1.5 text-xs max-sm:hidden">
							<span class="min-w-0 flex-1">File or sheet</span>
							<span class="w-52">Fallback entity type</span>
							<span class="w-7"></span>
						</div>
						<ul class="flex flex-col">
							{#each dialog.rows as row (row.id)}
								<li
									class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 border-b py-2 sm:grid-cols-[minmax(0,1fr)_13rem_auto]"
									data-slot="import-bucket"
								>
									<div class="flex min-w-0 flex-col">
										<span class="truncate text-sm font-medium" title={row.bucket.label}>{row.bucket.label}</span>
										<span class="text-muted-foreground text-xs tabular-nums">{countText(bucketColumnCount(row.bucket), 'column')}</span>
									</div>
									<div class="flex flex-col gap-1 max-sm:col-span-2 max-sm:row-start-2" data-slot="import-fallback">
										<span class="text-muted-foreground text-xs sm:hidden">Fallback entity type</span>
										{#if site !== null}
											<EntityTypePicker
												context={liveContext()}
												value={row.bucket.fallback === '' ? null : row.bucket.fallback}
												onValueChange={(value) => (dialog = setFallback(dialog, row.id, value ?? ''))}
												onOpenChange={onChooserOpen}
												placeholder="Fallback entity type"
												disabled={saving}
											/>
										{:else}
											<Input
												value={row.bucket.fallback}
												oninput={(event) => (dialog = setFallback(dialog, row.id, event.currentTarget.value))}
												placeholder="Fallback entity type"
												aria-label={fallbackLabel(row.bucket.label)}
												autocomplete="off"
												spellcheck={false}
												disabled={saving}
											/>
										{/if}
									</div>
									<IconButton
										label="Remove"
										icon={Trash2}
										destructive
										disabled={saving}
										class="max-sm:col-start-2 max-sm:row-start-1"
										onclick={() => (dialog = removeBucket(dialog, row.id))}
									/>
								</li>
							{/each}
						</ul>
						<p class="text-muted-foreground pt-1.5 text-xs tabular-nums" data-slot="import-totals">{importFooterText(buckets)}</p>
					</section>
				{/if}

				<Tabs.Root
					value={dialog.mode}
					onValueChange={(value) => (dialog = { ...dialog, mode: value as ImportMode })}
					class="flex flex-col gap-1.5"
					data-slot="import-mode"
				>
					<Label id="import-mode-label">Entity type of each column</Label>
					<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
						<Tabs.List aria-labelledby="import-mode-label">
							{#each IMPORT_MODES as mode (mode)}
								<Tabs.Trigger value={mode} disabled={saving} class="px-2.5">{IMPORT_MODE_LABELS[mode]}</Tabs.Trigger>
							{/each}
						</Tabs.List>
						{#if dialog.mode !== 'worksheet'}
							<div class="flex items-center gap-2">
								<Label for="import-delimiter" class="text-muted-foreground font-normal">Prefix delimiter</Label>
								<Input
									id="import-delimiter"
									value={dialog.delimiter}
									oninput={(event) => (dialog = { ...dialog, delimiter: event.currentTarget.value })}
									class="w-16 font-mono"
									autocomplete="off"
									spellcheck={false}
									disabled={saving}
								/>
							</div>
						{/if}
					</div>
					{#each IMPORT_MODES as mode (mode)}
						<Tabs.Content value={mode} class="text-muted-foreground text-xs" data-slot="import-mode-hint">{importModeHint(mode)}</Tabs.Content>
					{/each}
				</Tabs.Root>

				<div class="flex flex-col gap-1.5">
					<Label for="import-set-name">Set name</Label>
					<Input
						id="import-set-name"
						value={dialog.setName}
						oninput={(event) => (dialog = { ...dialog, setName: event.currentTarget.value })}
						autocomplete="off"
						disabled={saving}
					/>
				</div>
			</div>

			<Dialog.Footer>
				<Button variant="ghost" disabled={saving} onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" disabled={!confirmEnabled(dialog)} data-slot="import-confirm">{saving ? 'Importing…' : 'Import'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
