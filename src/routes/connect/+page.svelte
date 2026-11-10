<!--
	Connect: name a Flow PT site and sign in as yourself through the App Session Launcher.
	Adapted from sg-task-templates' connect page. One site at a time (OVR-7): the build's default
	site only fills the form, the person names the site (B10).
-->
<script lang="ts">
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Globe from '@lucide/svelte/icons/globe';
	import UserRound from '@lucide/svelte/icons/user-round';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import Notice from '$lib/app/notice.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { prepareLive, setSiteUrl, signIn, signOut, suggestedSiteUrl, type LiveState } from '$lib/live';

	let editingSite = $state(false);
	let siteDraft = $state(suggestedSiteUrl());
	let approving = $state(false);
	let refusal = $state<string | null>(null);

	const live = prepareLive();

	function useSite(): void {
		const value = siteDraft.trim();
		if (!value) return;
		setSiteUrl(value);
		location.reload();
	}

	async function onSignIn(state: LiveState): Promise<void> {
		refusal = null;
		approving = true;
		try {
			await signIn(state.siteUrl, (url) => window.open(url, '_blank', 'noopener'));
			location.reload();
		} catch (error) {
			refusal = error instanceof Error ? error.message : String(error);
		} finally {
			approving = false;
		}
	}

	function onSignOut(): void {
		signOut();
		location.reload();
	}
</script>

<svelte:head><title>Connect · SG Fields Setup</title></svelte:head>

{#await live}
	<PageState state="loading" title="Connecting to Flow PT…" />
{:then state}
	{@const editing = editingSite || state.siteUrl === ''}
	<PageHeader title="Connect" context="Name the Flow PT site and sign in as yourself. Nothing is written before the install plan.">
		{#snippet actions()}
			{#if state.problem === null}
				<Button href="/">Sets <ArrowRight data-icon="inline-end" /></Button>
			{/if}
		{/snippet}
	</PageHeader>

	<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
		<div class="flex w-full max-w-3xl flex-col gap-6 px-6 py-6">
			<section class="bg-card text-card-foreground flex flex-col rounded-lg border" aria-label="Connection">
				<div class="flex flex-wrap items-center gap-x-4 gap-y-2 p-4" data-slot="connect-site">
					<Globe class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
					<div class="flex min-w-0 flex-1 flex-col gap-0.5">
						<span class="text-muted-foreground text-xs font-medium">Site</span>
						{#if editing}
							<Input
								class="h-8 max-w-md"
								type="url"
								placeholder="https://studio.shotgrid.autodesk.com"
								bind:value={siteDraft}
								onkeydown={(event) => event.key === 'Enter' && useSite()}
								aria-label="Site URL"
							/>
						{:else}
							<span class="truncate text-sm font-medium" title={state.siteUrl}>{state.siteUrl}</span>
						{/if}
					</div>
					{#if editing}
						<Button size="sm" onclick={useSite}>Use site</Button>
						{#if state.siteUrl}
							<Button size="sm" variant="ghost" onclick={() => (editingSite = false)}>Cancel</Button>
						{/if}
					{:else}
						<Button size="sm" variant="outline" onclick={() => ((siteDraft = state.siteUrl), (editingSite = true))}>Change site</Button>
					{/if}
				</div>

				{#if state.siteUrl && !editing}
					<div class="border-border flex flex-wrap items-center gap-x-4 gap-y-2 border-t p-4" data-slot="connect-who">
						{#if state.session}
							<UserRound class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
							<div class="flex min-w-0 flex-1 flex-col gap-0.5">
								<span class="text-muted-foreground text-xs font-medium">Signed in as</span>
								<span class="truncate text-sm font-medium">{state.session.login}</span>
							</div>
							<Button size="sm" variant="ghost" onclick={onSignOut}>Sign out</Button>
						{:else}
							<UserRound class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
							<div class="flex min-w-0 flex-1 flex-col gap-0.5">
								<span class="text-muted-foreground text-xs font-medium">Account</span>
								<span class="text-sm">
									{#if approving}
										Approve the request in the tab that opened.
									{:else if state.devToken}
										Reading with the dev key. Sign in to write as yourself.
									{:else}
										Not signed in. Sign in to read and write as yourself.
									{/if}
								</span>
							</div>
							<Button size="sm" variant={state.devToken ? 'outline' : 'default'} onclick={() => onSignIn(state)} disabled={approving}>
								{approving ? 'Waiting for approval…' : state.devToken ? 'Sign in as yourself' : 'Sign in'}
							</Button>
						{/if}
					</div>
				{/if}
			</section>

			{#if refusal}
				<Notice tone="destructive" title="Sign-in refused.">{' '}{refusal}</Notice>
			{/if}
			{#if state.problem}
				<Notice tone="warning">{state.problem}</Notice>
			{:else}
				<p class="text-muted-foreground flex items-center gap-1.5 text-sm" data-slot="connect-ready">
					<CircleCheck class="text-success size-4" aria-hidden="true" />
					Connected.
				</p>
			{/if}
		</div>
	</div>
{:catch error}
	<PageState state="error" title="Could not connect to Flow PT" line={error.message} />
{/await}
