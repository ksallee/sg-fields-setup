<!--
	The install of a set. A placeholder: the install screen (specs/08-install-run.md, issue #18)
	replaces this page. It keeps the route's shape and the hand-over from the editor: with
	`?selection=1` the entries to install are the ids the editor stored through
	`$lib/io/install-selection` (EDT-10, PLN-1); otherwise, or when nothing was stored, the whole set.
-->
<script lang="ts">
	import { page } from '$app/state';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import { errorMessage } from '$lib/app/toast';
	import { Button } from '$lib/components/ui/button/index.js';
	import { readInstallSelection } from '$lib/io/install-selection';
	import { sharedSetStore } from '$lib/io/set-store';
	import { HOME_PATH, setPath } from '$lib/pure/routes';
	import { countText, fieldCount } from '$lib/pure/set-text';

	const id = $derived(page.params.id ?? '');
	const stored = $derived(sharedSetStore().then((store) => store.getSet(id)));
	const selection = $derived(page.url.searchParams.get('selection') === '1' ? readInstallSelection(id) : null);
</script>

<svelte:head><title>Install · SG Fields Setup</title></svelte:head>

{#await stored}
	<PageState state="loading" title="Loading the set…" />
{:then found}
	{#if found}
		{@const wanted = selection ? found.entries.filter((entry) => selection.includes(entry.id)) : found.entries}
		<PageHeader
			title="Install"
			back={{ href: setPath(id), label: found.set.name }}
			context={selection ? `${countText(wanted.length, 'field')} of ${found.entries.length} selected` : fieldCount(wanted.length)}
		/>
		<PageState state="empty" title="The install screen is not built yet" line="The set is stored. Its fields will be installed from here.">
			{#snippet action()}<Button variant="outline" href={setPath(id)}>Back to the set</Button>{/snippet}
		</PageState>
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
