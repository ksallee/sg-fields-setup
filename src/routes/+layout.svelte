<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import AppShell from '$lib/app/app-shell.svelte';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { apply, mode } from '$lib/theme';

	let { children } = $props();

	// `app.html` applied the scheme before the first paint; this keeps `system` mode following the OS.
	$effect(() => {
		const media = matchMedia('(prefers-color-scheme: dark)');
		const follow = (): void => {
			if (mode() === 'system') apply();
		};
		media.addEventListener('change', follow);
		return () => media.removeEventListener('change', follow);
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<Tooltip.Provider delayDuration={400}>
	<AppShell>{@render children()}</AppShell>
</Tooltip.Provider>
<Toaster position="bottom-right" closeButton />
