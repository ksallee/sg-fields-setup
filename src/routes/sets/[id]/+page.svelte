<!--
	A set. A placeholder: the editor (specs/05-editor.md) replaces this page. It keeps the route's
	shape: the set is read from the store by the id in the path, and a set that is gone is a plain
	"not found" with the way back.
-->
<script lang="ts">
	import { page } from '$app/state';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import { errorMessage } from '$lib/app/toast';
	import { Button } from '$lib/components/ui/button/index.js';
	import { sharedSetStore } from '$lib/io/set-store';
	import { HOME_PATH } from '$lib/pure/routes';
	import { fieldCount } from '$lib/pure/set-text';

	const BACK = { href: HOME_PATH, label: 'Sets' };

	const stored = $derived(sharedSetStore().then((store) => store.getSet(page.params.id ?? '')));

	let name = $state<string | null>(null);
	$effect(() => {
		name = null;
		void stored.then((found) => (name = found?.set.name ?? null)).catch(() => {});
	});
</script>

<svelte:head><title>{name ?? 'Set'} · SG Fields Setup</title></svelte:head>

{#await stored}
	<PageState state="loading" title="Loading the set…" />
{:then found}
	{#if found}
		<PageHeader title={found.set.name} back={BACK} context={fieldCount(found.entries.length)} />
		<PageState state="empty" title="The editor is not built yet" line="This set is stored. Its fields will be edited here." />
	{:else}
		<PageState state="empty" title="Set not found" line="It may have been deleted, or it was made in another browser.">
			{#snippet action()}<Button variant="outline" href={HOME_PATH}>Back to sets</Button>{/snippet}
		</PageState>
	{/if}
{:catch error}
	<PageState state="error" title="The set did not load" line={errorMessage(error)}>
		{#snippet action()}<Button variant="outline" href={HOME_PATH}>Back to sets</Button>{/snippet}
	</PageState>
{/await}
