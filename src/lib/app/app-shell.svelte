<!--
	The frame of every screen: a h-12 header (app name, the connected site, the scheme switch),
	then the page. After sg-task-templates' shell, without its flow steps. The site link always
	shows: the site and who reads it, or that no site is connected (OVR-7, B10).
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import { Button } from '$lib/components/ui/button/index.js';
	import { isDark, setMode } from '$lib/theme';
	import { prepareLive, type LiveState } from '$lib/live';
	import { siteHost } from '$lib/pure/site-host';

	let { children }: { children: Snippet } = $props();

	let live = $state<LiveState | null>(null);
	void prepareLive().then((value) => (live = value));

	let dark = $state(isDark());

	// In `system` mode the OS can flip the scheme under the page; the icon and label follow it.
	$effect(() => {
		const media = matchMedia('(prefers-color-scheme: dark)');
		const follow = (): void => {
			dark = isDark();
		};
		media.addEventListener('change', follow);
		return () => media.removeEventListener('change', follow);
	});

	function toggleScheme(): void {
		const next = dark ? 'light' : 'dark';
		setMode(next);
		dark = isDark(next);
	}
</script>

<div class="bg-background text-foreground flex h-dvh flex-col">
	<header class="border-border bg-background flex h-12 shrink-0 items-center gap-3 border-b px-3 sm:gap-5 sm:px-4" data-slot="app-header">
		<a href="/" class="focus-visible:ring-ring shrink-0 rounded-md text-sm whitespace-nowrap outline-none focus-visible:ring-2" translate="no">
			<span class="font-semibold">SG</span> <span class="text-muted-foreground">Fields Setup</span>
		</a>

		<div class="flex-1"></div>

		<div class="flex shrink-0 items-center gap-1 text-sm sm:gap-2">
			{#if live}
				<a
					href="/connect"
					class="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex max-w-64 min-w-0 items-center gap-1.5 truncate rounded-md px-1.5 py-1 outline-none focus-visible:ring-2"
					title={live.siteUrl ? `${live.siteUrl}${live.session ? ` · ${live.session.login}` : live.devToken ? ' · dev key' : ''}` : 'Connect a site'}
					data-slot="site-who"
				>
					{#if live.siteUrl}
						<span class="text-xs">Site</span>
						<span class="text-foreground truncate">{siteHost(live.siteUrl)}</span>
						{#if live.session}
							<span aria-hidden="true">·</span><span class="truncate">{live.session.login}</span>
						{:else if live.devToken}
							<span aria-hidden="true">·</span><span class="text-xs">Dev key</span>
						{:else}
							<span aria-hidden="true">·</span><span class="text-xs">Not signed in</span>
						{/if}
					{:else}
						<span>No site connected</span>
					{/if}
				</a>
			{/if}
			<Button size="icon" variant="ghost" onclick={toggleScheme} aria-label={dark ? 'Switch to light' : 'Switch to dark'} title={dark ? 'Switch to light' : 'Switch to dark'}>
				{#if dark}
					<Moon aria-hidden="true" />
				{:else}
					<Sun aria-hidden="true" />
				{/if}
			</Button>
		</div>
	</header>
	<main class="flex min-h-0 flex-1 flex-col">
		{@render children()}
	</main>
</div>
