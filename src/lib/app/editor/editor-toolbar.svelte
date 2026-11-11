<!--
	The entry list's search box, status filter and on-site-first toggle (EDT-34 to EDT-36). It holds
	no state: each change is reported and the page builds the view again.
-->
<script lang="ts">
	import ArrowUpNarrowWide from '@lucide/svelte/icons/arrow-up-narrow-wide';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { FILTER_LABELS } from '$lib/pure/editor-text';
	import { STATUS_FILTERS, type FilterCounts, type StatusFilter } from '$lib/pure/editor-view';
	import { cn } from '$lib/utils.js';

	let {
		search,
		filter,
		onSiteFirst,
		counts,
		highlightNeedsAttention,
		onsearch,
		onfilter,
		ononsitefirst
	}: {
		search: string;
		filter: StatusFilter;
		onSiteFirst: boolean;
		counts: FilterCounts;
		highlightNeedsAttention: boolean;
		onsearch: (text: string) => void;
		onfilter: (filter: StatusFilter) => void;
		ononsitefirst: (on: boolean) => void;
	} = $props();
</script>

<div class="flex flex-wrap items-center gap-2" data-slot="editor-toolbar">
	<div class="relative min-w-40 flex-1 sm:max-w-72">
		<Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden="true" />
		<Input
			type="search"
			value={search}
			oninput={(event) => onsearch(event.currentTarget.value)}
			placeholder="Search by name or entity type"
			aria-label="Search fields"
			autocomplete="off"
			class="pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
			data-slot="field-search"
		/>
		{#if search !== ''}
			<button
				type="button"
				class="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm outline-none focus-visible:ring-2"
				aria-label="Clear the search"
				onclick={() => onsearch('')}
			>
				<X class="size-3.5" aria-hidden="true" />
			</button>
		{/if}
	</div>

	<div class="border-border flex items-center rounded-lg border p-0.5" role="group" aria-label="Status filter" data-slot="status-filter">
		{#each STATUS_FILTERS as choice (choice)}
			{@const active = filter === choice}
			{@const flagged = choice === 'needs_attention' && highlightNeedsAttention}
			<Button
				variant={active ? 'secondary' : 'ghost'}
				size="sm"
				class={cn('h-6.5 gap-1.5 px-2', !active && 'text-muted-foreground')}
				aria-pressed={active}
				onclick={() => onfilter(choice)}
				data-filter={choice}
				data-flagged={flagged ? '' : undefined}
			>
				{#if flagged}<span class="bg-warning size-1.5 rounded-full" aria-hidden="true"></span>{/if}
				{FILTER_LABELS[choice]}
				<span class={cn('tabular-nums', flagged ? 'text-foreground font-semibold' : 'text-muted-foreground')}>{counts[choice]}</span>
			</Button>
		{/each}
	</div>

	<Button
		variant={onSiteFirst ? 'secondary' : 'ghost'}
		size="sm"
		class={cn(!onSiteFirst && 'text-muted-foreground')}
		aria-pressed={onSiteFirst}
		title="In each entity type: on site, then new, then needs attention"
		onclick={() => ononsitefirst(!onSiteFirst)}
		data-slot="on-site-first"
	>
		<ArrowUpNarrowWide data-icon="inline-start" />On site first
	</Button>
</div>
