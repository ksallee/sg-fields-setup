<!--
	The install screen (specs/08-install-run.md, issues #18 and #19): the plan of a set against the
	connected site, the rows and projects to install on, and the run. The only screen that writes
	to a site.

	A view and nothing more. `session.svelte.ts` holds the state and calls the pure modules; the
	components beside this one render what they are given.
-->
<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
	import ConfirmDialog from '$lib/app/confirm-dialog.svelte';
	import Notice from '$lib/app/notice.svelte';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { SELECTION_LOST } from '$lib/pure/install-entries';
	import { leaveQuestion, siteHost } from '$lib/pure/install-text';
	import { CONNECT_PATH, HOME_PATH, setPath } from '$lib/pure/routes';
	import { fieldCount } from '$lib/pure/set-text';
	import { rowCounters } from '$lib/pure/visibility-text';
	import { cn } from '$lib/utils.js';
	import InstallConfirm from './confirm.svelte';
	import InstallFooter from './footer.svelte';
	import PickerPanel from './picker-panel.svelte';
	import PlanGroup from './plan-group.svelte';
	import PlanRow from './plan-row.svelte';
	import { InstallSession } from './session.svelte';
	import InstallSummary from './summary.svelte';

	let { id, url }: { id: string; url: URL } = $props();

	const session = new InstallSession();
	// svelte-ignore state_referenced_locally
	const editor = setPath(id);

	onMount(() => void session.open(id, url));
	onDestroy(() => session.dispose());

	let confirmOpen = $state(false);

	/* Leaving while a run is in progress (in-app navigation and the tab). */
	let leaveOpen = $state(false);
	let leaveTo: URL | null = null;
	let leaving = false;

	beforeNavigate((navigation) => {
		if (!session.running || leaving) return;
		navigation.cancel();
		// Closing the tab or leaving the app: the browser asks in its own words.
		if (navigation.willUnload || !navigation.to) return;
		leaveTo = navigation.to.url;
		leaveOpen = true;
	});

	function leave(): void {
		leaving = true;
		leaveOpen = false;
		session.cancel();
		if (leaveTo) void goto(leaveTo);
	}

	function act(name: 'refresh' | 'apply' | 'cancel' | 'retry' | 'resume' | 'report'): void {
		if (name === 'apply') confirmOpen = true;
		else if (name === 'refresh') void session.refresh();
		else if (name === 'cancel') session.cancel();
		else if (name === 'retry') void session.retry();
		else if (name === 'resume') void session.resume();
		else session.downloadReport();
	}

	const load = $derived(session.load);
	const title = $derived(session.setName === '' ? 'Install' : `Install "${session.setName}"`);
</script>

<svelte:head><title>{title} · SG Fields Setup</title></svelte:head>

{#if load.status === 'not-found'}
	<PageState state="empty" title="Set not found" line="It may have been deleted, or it was made in another browser.">
		{#snippet action()}<Button variant="outline" href={HOME_PATH}>Back to sets</Button>{/snippet}
	</PageState>
{:else if load.status === 'selection-lost'}
	<PageState state="empty" title={SELECTION_LOST.title} line={SELECTION_LOST.line}>
		{#snippet action()}<Button variant="outline" href={editor}>Back to the set</Button>{/snippet}
	</PageState>
{:else if load.status === 'set-failed'}
	<PageState state="error" title="The set did not load" line={load.message}>
		{#snippet action()}<Button variant="outline" href={HOME_PATH}>Back to sets</Button>{/snippet}
	</PageState>
{:else if load.status === 'loading' && load.what === 'set'}
	<PageState state="loading" title="Loading the set…" />
{:else}
	<PageHeader {title} back={{ href: editor, label: session.setName || 'Set' }} context={session.context} />

	{#if load.status === 'loading'}
		<PageState
			state="loading"
			title={load.what === 'site' ? 'Connecting to Flow PT…' : 'Checking the live schema…'}
			line={load.what === 'plan' && session.site ? `Reading ${fieldCount(session.entries.length).toLowerCase()} on ${siteHost(session.site.siteUrl)}.` : undefined}
		/>
	{:else if load.status === 'disconnected'}
		<PageState state="empty" title="No site connected" line={`${load.problem} An install needs a site to compare with and to write to.`}>
			{#snippet action()}
				<Button variant="outline" href={editor}>Back to the set</Button>
				<Button href={CONNECT_PATH}>Connect a site</Button>
			{/snippet}
		</PageState>
	{:else if load.status === 'plan-failed'}
		<PageState state="error" title="The live schema could not be read" line={`${load.message} No plan was made.`}>
			{#snippet action()}<Button variant="outline" onclick={() => void session.refresh()}>Try again</Button>{/snippet}
		</PageState>
	{:else if session.emptyText !== null}
		<PageState state="empty" title={session.emptyText}>
			{#snippet action()}<Button variant="outline" href={editor}>Back to the set</Button>{/snippet}
		</PageState>
	{:else if session.site}
		<div class="flex min-h-0 flex-1 flex-col overflow-y-auto" data-slot="install-pane">
			<div class={cn('flex flex-col gap-6 py-4', session.refreshing && 'opacity-60')} aria-busy={session.refreshing}>
				<div class="flex max-w-3xl flex-col gap-6 px-6">
					{#if session.site.kind === 'fake'}
						<Notice tone="info" title="Fake site." data-slot="fake-notice">Nothing here reaches Flow PT. This is the dev build's in-memory site.</Notice>
					{/if}
					{#if session.run.error !== null}
						<Notice tone="destructive" title="Install stopped." data-slot="run-error">{session.run.error}</Notice>
					{/if}
					<InstallSummary
						items={session.summary}
						scope={session.scopeText}
						visibility={session.visibilityCount.text}
						upperBound={session.visibilityCount.upperBound && session.analysisState === 'analysing'}
					/>
					<PickerPanel
						context={session.site.pickerContext}
						value={session.chosen}
						disabled={session.locked}
						notes={session.scopeNotes}
						analysisFailed={session.analysisState === 'failed'}
						onchange={(value) => session.choose(value)}
					/>
				</div>

				<section class="flex flex-col gap-3 px-4" aria-label="Plan" data-slot="install-plan">
					<div class="flex items-center gap-3 px-2">
						<h2 class="flex-1 text-sm font-semibold">Plan</h2>
						<label class="text-muted-foreground flex items-center gap-2 text-sm tabular-nums" data-slot="select-all">
							<Checkbox
								bind:checked={() => session.selectAll.state === 'all', () => session.setAll(session.selectAll.state !== 'all')}
								indeterminate={session.selectAll.state === 'some'}
								disabled={session.locked || session.selectAll.total === 0}
								aria-label="Select all"
							/>
							{session.selectAll.text}
						</label>
					</div>
					{#each session.groups as group (group.id)}
						<PlanGroup {group}>
							{#each group.rows as row (row.entryId)}
								{@const visibility = session.visibility.get(row.entryId)}
								<PlanRow
									{row}
									run={session.run}
									ticked={session.ticked.has(row.entryId)}
									disabled={session.disabled.has(row.entryId)}
									locked={session.locked}
									counters={visibility ? rowCounters(visibility) : []}
									ontoggle={() => session.toggle(row.entryId)}
									onretryvisibility={() => void session.retryVisibility(row.entryId)}
								/>
							{/each}
						</PlanGroup>
					{/each}
				</section>
			</div>
		</div>
	{/if}

	{#if session.site && load.status !== 'disconnected'}
		<InstallFooter footer={session.footer} run={session.run} selected={session.selectAll.text} closeHref={editor} onaction={act} />
	{/if}
{/if}

<InstallConfirm bind:open={confirmOpen} text={session.confirm} onconfirm={() => void session.apply()} />

<ConfirmDialog bind:open={leaveOpen} title="Leave the install?" message={leaveQuestion()} confirmLabel="Leave" cancelLabel="Stay" destructive onconfirm={leave} />
