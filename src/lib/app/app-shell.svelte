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
	import { connectNudge, siteTitle, siteWho } from '$lib/pure/site';
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
			{#if live && connectNudge(live)}
				{@const nudge = connectNudge(live)}
				<a
					href="/connect"
					class="border-warning/60 bg-warning/10 hover:bg-warning/20 text-foreground focus-visible:ring-ring flex max-w-72 min-w-0 items-center gap-2 rounded-md border px-2.5 py-1 font-medium outline-none focus-visible:ring-2"
					title={siteTitle(live)}
					data-slot="site-who"
					data-connected="false"
				>
					<span class="bg-warning size-2 shrink-0 rounded-full" aria-hidden="true"></span>
					<span class="truncate">{nudge?.title.replace(/\.$/, '')}</span>
					<span class="text-primary max-sm:hidden">{nudge?.action}</span>
				</a>
			{:else if live}
				<a
					href="/connect"
					class="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex max-w-64 min-w-0 items-center gap-1.5 truncate rounded-md px-1.5 py-1 outline-none focus-visible:ring-2"
					title={siteTitle(live)}
					data-slot="site-who"
				>
					{#if live.siteUrl}
						{@const who = siteWho(live)}
						<span class="text-xs">Site</span>
						<span class="text-foreground truncate">{siteHost(live.siteUrl)}</span>
						<span aria-hidden="true">·</span><span class={who.kind === 'person' ? 'truncate' : 'text-xs'}>{who.text}</span>
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
