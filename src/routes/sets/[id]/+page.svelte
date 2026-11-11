<!--
	The editor (specs/05-editor.md, specs/06-site-comparison.md): one set, all its fields, edited
	locally until Save. Markup and wiring only. What the screen holds and does is
	`$lib/app/editor/session.svelte.ts`, which calls the pure modules. The pieces are in
	`$lib/app/editor/`.

	Wired here, because it needs the page: the route's id, the navigation guard, Ctrl+S, the
	background reads of the site's fields, and where the keyboard's focus goes.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
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
	import { blockInput } from '$lib/app/block-input';
	import ConfirmDialog from '$lib/app/confirm-dialog.svelte';
	import AddEntityType from '$lib/app/editor/add-entity-type.svelte';
	import BulkBar from '$lib/app/editor/bulk-bar.svelte';
	import EditorToolbar from '$lib/app/editor/editor-toolbar.svelte';
	import EntryGroup from '$lib/app/editor/entry-group.svelte';
	import { focusTargetElement, holdRowFocus } from '$lib/app/editor/focus';
	import HeaderAction from '$lib/app/editor/header-action.svelte';
	import { EditorSession } from '$lib/app/editor/session.svelte';
	import SetDetails from '$lib/app/editor/set-details.svelte';
	import { EditorSite } from '$lib/app/editor/site-data.svelte';
	import IconButton from '$lib/app/icon-button.svelte';
	import Notice from '$lib/app/notice.svelte';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { blockText } from '$lib/pure/editor-reasons';
	import { duplicateLabel, installLabel, notSavedText, STATUS_TEXT } from '$lib/pure/editor-text';
	import { importBannerText } from '$lib/pure/import-build';
	import { HOME_PATH } from '$lib/pure/routes';
	import { groupCheckState } from '$lib/pure/selection';
	import { fieldCount } from '$lib/pure/set-text';
	import { cn } from '$lib/utils.js';

	const BACK = { href: HOME_PATH, label: 'Sets' };

	/* The site, read once per session and only in the background (CMP-1, CMP-2). */

	const site = new EditorSite();
	void site.connect();

	const session = new EditorSession({
		site,
		goto: (to) => goto(to),
		openTab(path) {
			const tab = window.open(path, '_blank');
			if (tab) tab.opener = null;
			return tab !== null;
		}
	});

	// EDT-1: the route keeps this page when only the id changes, so loading follows the id.
	$effect(() => {
		const id = page.params.id ?? '';
		untrack(() => void session.load(id));
	});

	// CMP-2: each distinct target type's fields, read once, in the background.
	$effect(() => site.ensureFields(session.targetTypes));

	// EDT-5: leaving while dirty asks first.
	beforeNavigate((navigation) => {
		if (session.blocksLeaving({ willUnload: navigation.willUnload, to: navigation.to?.url ?? null })) navigation.cancel();
	});

	/* The keyboard. */

	let pane = $state<HTMLElement | null>(null);

	/** Save, with focus kept on the field it was on: a row stored for the first time is drawn again. */
	async function save(): Promise<void> {
		const held = holdRowFocus(pane);
		const keys = await session.save();
		if (!keys) return;
		await tick();
		held.restore(keys);
	}

	function onkeydown(event: KeyboardEvent): void {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && session.phase === 'ready') {
			event.preventDefault();
			void save();
		}
	}

	// EDT-33: a deleted row's neighbour takes the focus its delete button had.
	$effect(() => {
		const ask = session.focus;
		if (ask && pane) focusTargetElement(pane, ask.target)?.focus();
	});

	const wc = $derived(session.wc);
	const view = $derived(session.view);
	const status = $derived(session.status);
</script>

<svelte:head><title>{session.title} · SG Fields Setup</title></svelte:head>
<svelte:window {onkeydown} />

{#if session.phase === 'loading'}
	<PageState state="loading" title="Loading the set…" />
{:else if session.phase === 'missing'}
	<PageState state="empty" title="Set not found" line="It may have been deleted, or it was made in another browser.">
		{#snippet action()}<Button variant="outline" href={HOME_PATH}>Back to sets</Button>{/snippet}
	</PageState>
{:else if session.phase === 'failed' || !wc}
	<PageState state="error" title="The set did not load" line={session.loadError}>
		{#snippet action()}<Button variant="outline" href={HOME_PATH}>Back to sets</Button>{/snippet}
	</PageState>
{:else}
	<PageHeader title={session.title} back={BACK}>
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
			<span class="tabular-nums" data-slot="field-count">{fieldCount(session.rows.length)}</span>
		{/snippet}
		{#snippet actions()}
			<Button variant="ghost" class="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onclick={() => session.askDelete()} data-slot="delete-set">
				<Trash2 data-icon="inline-start" /><span class="max-sm:sr-only">Delete set</span>
			</Button>
			<HeaderAction slot="duplicate" reason={session.duplicateReason && blockText(session.duplicateReason)} busy={session.duplicating} onclick={() => session.duplicate()}>
				<Copy data-icon="inline-start" />{duplicateLabel(session.selectedKeys.length)}
			</HeaderAction>
			<HeaderAction slot="install" reason={session.installReason && blockText(session.installReason)} onclick={() => session.install()}>
				<Download data-icon="inline-start" />{installLabel(session.selectedKeys.length)}
			</HeaderAction>
			<HeaderAction slot="save" variant="default" reason={session.saveReason && blockText(session.saveReason)} busy={session.saving} onclick={save}>
				<Save data-icon="inline-start" />Save
			</HeaderAction>
		{/snippet}
		{#if view.showToolbar}
			<EditorToolbar
				search={session.search}
				filter={session.filter}
				onSiteFirst={session.onSiteFirst}
				counts={view.counts}
				highlightNeedsAttention={view.highlightNeedsAttention}
				onsearch={(text) => (session.search = text)}
				onfilter={(next) => (session.filter = next)}
				ononsitefirst={(on) => (session.onSiteFirst = on)}
			/>
		{/if}
	</PageHeader>

	<!-- While a save is on its way the pane takes no input and keeps its focus (`block-input`). -->
	<div
		bind:this={pane}
		use:blockInput={() => session.saving}
		class="relative flex min-h-0 flex-1 flex-col overflow-y-auto"
		aria-busy={session.saving}
		data-slot="editor-pane"
	>
		<div class="flex flex-1 flex-col gap-6 py-4">
			{#if session.banner !== null || session.saveError !== null}
				<div class="flex flex-col gap-3 px-6">
					{#if session.saveError !== null}
						<Notice tone="destructive" title="Not saved." data-slot="save-error">{notSavedText(session.saveError)}</Notice>
					{/if}
					{#if session.banner !== null}
						<Notice tone="info" data-slot="import-banner">
							{importBannerText(session.banner)}
							{#snippet action()}<IconButton label="Dismiss" icon={X} onclick={() => session.dismissBanner()} />{/snippet}
						</Notice>
					{/if}
				</div>
			{/if}

			<div class="px-6">
				<SetDetails
					name={wc.name}
					description={wc.description}
					onname={(name) => session.rename(name)}
					ondescription={(description) => session.describe(description)}
				/>
			</div>

			<section class="flex flex-1 flex-col gap-3" aria-label="Fields" data-slot="entry-list">
				<div class="flex items-center gap-3 px-6">
					<h2 class="text-sm font-semibold">Fields</h2>
					<Button variant="outline" class="ml-auto" disabled={session.adding} onclick={() => (session.adding = true)} data-slot="add-entity-type-button">
						<Plus data-icon="inline-start" />Add entity type
					</Button>
				</div>

				{#if session.adding}
					<div class="px-6">
						<AddEntityType
							context={site.context}
							taken={view.groups.filter((group) => !group.unassigned).map((group) => group.type)}
							onadd={(type) => session.addGroup(type)}
							oncancel={() => (session.adding = false)}
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
							<Button variant="outline" onclick={() => (session.adding = true)}><Plus data-icon="inline-start" />Add entity type</Button>
						{/snippet}
					</PageState>
				{:else if view.emptyState === 'no_matches'}
					<PageState state="empty" icon={SearchX} title="No field matches" line="Try another search, or clear the search and the filter.">
						{#snippet action()}
							<Button variant="outline" onclick={() => session.clearFilters()}>Clear search and filter</Button>
						{/snippet}
					</PageState>
				{/if}

				<div class="flex flex-col gap-4 px-4">
					{#each view.groups as group (group.type)}
						<EntryGroup
							{group}
							rowOf={session.rowOf}
							comparisonOf={session.comparison.byKey}
							incomplete={session.incomplete}
							duplicated={session.duplicated}
							selected={session.selection.selected}
							expanded={session.expanded}
							checkState={groupCheckState(session.selection, group.keys)}
							notOnSite={session.comparison.notOnSite.has(group.type)}
							rechecking={site.rechecking}
							context={site.context}
							referenceFields={site.fieldsOf(group.type)}
							onloadfields={site.loadFields}
							onadd={(type) => session.addField(type)}
							ontogglegroup={(keys) => session.selectGroup(keys)}
							onrecheck={() => session.recheck()}
							ontoggle={(key) => session.toggle(key)}
							onselect={(key, shift) => session.select(key, shift)}
							onedit={(key, patch) => session.edit(key, patch)}
							onnamemode={(key, mode) => session.nameMode(key, mode)}
							ondelete={(key) => session.deleteRow(key)}
						/>
					{/each}
				</div>
			</section>
		</div>

		{#if session.selection.selected.size > 0}
			<BulkBar
				summary={session.summary}
				context={site.context}
				resyncing={session.resyncing}
				onassign={(type) => session.assign(type)}
				ondatatype={(dataType) => session.changeDataType(dataType)}
				onresync={() => session.resync()}
				ondelete={() => session.deleteSelected()}
				onclear={() => session.clearSelection()}
			/>
		{/if}
	</div>

	<ConfirmDialog
		bind:open={session.deleting.open}
		title="Delete this set?"
		message={session.deleting.question}
		confirmLabel="Delete set"
		destructive
		rememberLabel="Do not ask again when deleting a set"
		busy={session.deleting.busy}
		error={session.deleting.error}
		onconfirm={({ remember }) => session.deleting.confirm(remember)}
	/>

	<ConfirmDialog
		bind:open={session.discardOpen}
		title="Discard unsaved changes?"
		message="This set has changes that are not saved. Leaving discards them."
		confirmLabel="Discard changes"
		cancelLabel="Keep editing"
		destructive
		onconfirm={() => session.discard()}
	/>
{/if}
