<!--
	The list's search box, origin filter and sort choice (SET-2). It holds no state of its own
	beyond the text being typed: each change is reported and the page reloads.
-->
<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { ORIGINS, type Origin } from '$lib/pure/model';
	import type { SetListFilters } from '$lib/pure/set-list';
	import { SET_SORTS, type SetSort } from '$lib/pure/set-query';
	import { ORIGIN_LABELS, SORT_LABELS } from '$lib/pure/set-text';

	let {
		search = $bindable(''),
		filters,
		summary,
		onsearch,
		onorigin,
		onsort
	}: {
		/** The text in the box, as typed. */
		search?: string;
		filters: SetListFilters;
		/** The count line on the right: "24 sets", "3 sets match". */
		summary?: string;
		onsearch: (text: string) => void;
		onorigin: (origin: Origin | null) => void;
		onsort: (sort: SetSort) => void;
	} = $props();

	const ALL = 'all';
</script>

<div class="flex flex-wrap items-center gap-2" data-slot="set-toolbar">
	<div class="relative min-w-40 flex-1 sm:max-w-72">
		<Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden="true" />
		<Input
			type="search"
			bind:value={search}
			oninput={() => onsearch(search)}
			placeholder="Search by name or description"
			aria-label="Search sets"
			autocomplete="off"
			class="pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
		/>
		{#if search !== ''}
			<button
				type="button"
				class="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm outline-none focus-visible:ring-2"
				aria-label="Clear the search"
				onclick={() => {
					search = '';
					onsearch('');
				}}
			>
				<X class="size-3.5" aria-hidden="true" />
			</button>
		{/if}
	</div>

	<Select.Root type="single" value={filters.origin ?? ALL} onValueChange={(value) => onorigin(value === ALL ? null : (value as Origin))}>
		<Select.Trigger aria-label="Origin" data-slot="origin-filter">
			<span class="text-muted-foreground">Origin</span>
			{filters.origin ? ORIGIN_LABELS[filters.origin] : 'All'}
		</Select.Trigger>
		<Select.Content>
			<Select.Item value={ALL} label="All" />
			{#each ORIGINS as origin (origin)}
				<Select.Item value={origin} label={ORIGIN_LABELS[origin]} />
			{/each}
		</Select.Content>
	</Select.Root>

	<Select.Root type="single" value={filters.sort} onValueChange={(value) => onsort(value as SetSort)}>
		<Select.Trigger aria-label="Sort" data-slot="sort-choice">
			<span class="text-muted-foreground">Sort</span>
			{SORT_LABELS[filters.sort]}
		</Select.Trigger>
		<Select.Content>
			{#each SET_SORTS as sort (sort)}
				<Select.Item value={sort} label={SORT_LABELS[sort]} />
			{/each}
		</Select.Content>
	</Select.Root>

	{#if summary}
		<p class="text-muted-foreground ml-auto text-sm tabular-nums" data-slot="set-total" aria-live="polite">{summary}</p>
	{/if}
</div>
