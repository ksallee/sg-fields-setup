<!--
	One set in the list (SET-3): its name (opens the editor), its description or a muted
	placeholder, its origin, its field count, the time since its last change, and the row actions.
	The whole row opens the editor; the actions sit above that link. Below `md` the three facts
	fold into one line under the description. No column headings: each fact names itself.
-->
<script lang="ts" module>
	const GRID =
		'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-2 md:grid-cols-[minmax(0,1fr)_7rem_5.5rem_8.5rem_6rem]';
</script>

<script lang="ts">
	import Copy from '@lucide/svelte/icons/copy';
	import Download from '@lucide/svelte/icons/download';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import IconButton from '$lib/app/icon-button.svelte';
	import RelativeTime from '$lib/app/relative-time.svelte';
	import { setPath } from '$lib/pure/routes';
	import type { SetSummary } from '$lib/pure/set-query';
	import { fieldCount, ORIGIN_LABELS } from '$lib/pure/set-text';
	import { cn } from '$lib/utils.js';

	let {
		row,
		busy = false,
		onduplicate,
		onexport,
		ondelete
	}: {
		row: SetSummary;
		/** An action on this row is in flight: its actions wait. */
		busy?: boolean;
		onduplicate: () => void;
		onexport: () => void;
		ondelete: () => void;
	} = $props();

	const set = $derived(row.set);
</script>

<li class={cn(GRID, 'border-border hover:bg-muted relative border-b py-2')} data-slot="set-row">
	<div class="flex min-w-0 flex-col gap-0.5">
		<a
			href={setPath(set.id)}
			class="focus-visible:ring-ring truncate rounded-sm text-sm font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
			title={set.name}
			data-slot="set-name"
		>
			{set.name}
		</a>
		{#if set.description}
			<p class="text-muted-foreground truncate text-sm" title={set.description}>{set.description}</p>
		{:else}
			<p class="text-muted-foreground/70 text-sm">No description</p>
		{/if}
	</div>

	<div class="text-muted-foreground col-start-1 row-start-2 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs md:contents md:text-sm">
		<span><Badge variant="outline" class="text-muted-foreground font-normal" data-slot="set-origin">{ORIGIN_LABELS[set.origin]}</Badge></span>
		<span class="md:text-foreground tabular-nums md:text-right" data-slot="set-count">{fieldCount(row.entryCount)}</span>
		<RelativeTime time={set.changedAt} label="Changed" class="truncate" />
	</div>

	<div class="relative z-10 col-start-2 row-span-2 row-start-1 flex items-center justify-end md:col-start-5 md:row-span-1">
		<IconButton label="Duplicate" icon={Copy} disabled={busy} onclick={onduplicate} />
		<IconButton label="Export as a set file" icon={Download} disabled={busy} onclick={onexport} />
		<IconButton label="Delete" icon={Trash2} destructive disabled={busy} onclick={ondelete} />
	</div>
</li>
