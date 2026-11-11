<!--
	The install of a set (specs/08-install-run.md). Thin: the screen is
	`$lib/app/install/install-screen.svelte`, made again when the set in the path changes. With
	`?selection=1` it installs the entries the editor stored through `$lib/io/install-selection`
	(EDT-10, PLN-1); otherwise the whole set.
-->
<script lang="ts">
	import { page } from '$app/state';
	import InstallScreen from '$lib/app/install/install-screen.svelte';

	const id = $derived(page.params.id ?? '');
</script>

{#key id}
	<InstallScreen {id} url={page.url} />
{/key}
