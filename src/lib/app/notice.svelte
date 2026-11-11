<!--
	An inline warning, error or note (docs/design.md): bordered, tinted in its tone, an icon, one
	sentence, then an optional action on the right. Tokens only, no raw amber.
-->
<script lang="ts" module>
	export type NoticeTone = 'warning' | 'destructive' | 'info';
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Info from '@lucide/svelte/icons/info';
	import { cn } from '$lib/utils.js';

	let {
		tone = 'warning',
		title,
		children,
		action,
		class: className,
		...rest
	}: {
		tone?: NoticeTone;
		/** A bold lead-in, in the same line. */
		title?: string;
		children?: Snippet;
		action?: Snippet;
		class?: string;
		[key: `data-${string}`]: string | undefined;
	} = $props();

	const TONE: Record<NoticeTone, string> = {
		warning: 'border-warning/60 bg-warning/10',
		destructive: 'border-destructive/50 bg-destructive/10',
		info: 'border-info/50 bg-info/10'
	};
	const ICON_TONE: Record<NoticeTone, string> = {
		warning: 'text-warning',
		destructive: 'text-destructive',
		info: 'text-info'
	};
	const Icon = $derived(tone === 'destructive' ? CircleAlert : tone === 'info' ? Info : TriangleAlert);
</script>

<div
	class={cn('text-foreground flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 text-sm', TONE[tone], className)}
	role={tone === 'info' ? 'status' : 'alert'}
	data-slot="notice"
	data-tone={tone}
	{...rest}
>
	<Icon class={cn('size-4 shrink-0', ICON_TONE[tone])} aria-hidden="true" />
	<p class="min-w-0 flex-1">
		{#if title}<span class="font-medium">{title}</span>{/if}
		{#if children}{@render children()}{/if}
	</p>
	{#if action}<div class="flex shrink-0 items-center gap-2">{@render action()}</div>{/if}
</div>
