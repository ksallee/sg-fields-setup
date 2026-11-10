<!--
	A whole pane's empty, loading or error state (docs/design.md): an icon in a muted circle, one
	title, one line, one action. Loading shows its spinner only after 150 ms (sg-widgets rule 4).
	Inside a widget, use its own StateLine instead.
-->
<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Inbox from '@lucide/svelte/icons/inbox';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { cn } from '$lib/utils.js';

	let {
		state,
		title,
		line,
		icon,
		action,
		class: className
	}: {
		state: 'empty' | 'loading' | 'error';
		title: string;
		line?: string;
		icon?: Component;
		action?: Snippet;
		class?: string;
	} = $props();

	const Icon = $derived(icon ?? (state === 'error' ? CircleAlert : state === 'loading' ? LoaderCircle : Inbox));
</script>

<div
	class={cn('flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center', state === 'loading' && 'page-state-delay', className)}
	role={state === 'error' ? 'alert' : 'status'}
	data-slot="page-state"
	data-state={state}
>
	<span class={cn('bg-muted flex size-10 items-center justify-center rounded-full', state === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
		<Icon class={cn('size-5', state === 'loading' && 'motion-safe:animate-spin')} aria-hidden="true" />
	</span>
	<div class="flex max-w-md flex-col gap-1">
		<p class="text-sm font-medium">{title}</p>
		{#if line}<p class={cn('text-sm', state === 'error' ? 'text-destructive' : 'text-muted-foreground')}>{line}</p>{/if}
	</div>
	{#if action}<div class="flex items-center gap-2">{@render action()}</div>{/if}
</div>

<style>
	.page-state-delay {
		animation: page-state-in 100ms ease-out 150ms both;
	}
	@keyframes page-state-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
</style>
