<!--
	The bar that shows while rows are selected (EDT-41, EDT-42): the count and the bulk actions.
	Actions touch the selected rows on screen; rows a search or filter hides are counted and left
	alone. It reports what was asked; the page applies it.
-->
<script lang="ts">
	import type { SgContext } from 'sg-widgets-core';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { CREATABLE_DATA_TYPES, dataTypeLabel } from '$lib/pure/data-types';
	import { selectionText } from '$lib/pure/editor-text';
	import type { SelectionSummary } from '$lib/pure/selection';
	import TypeField from './type-field.svelte';

	let {
		summary,
		context,
		resyncing,
		onassign,
		ondatatype,
		onresync,
		ondelete,
		onclear
	}: {
		summary: SelectionSummary;
		/** The widgets' context, or null with no site: assign is typed, and re-sync is not offered. */
		context: SgContext | null;
		resyncing: boolean;
		onassign: (type: string) => void;
		ondatatype: (dataType: string) => void;
		onresync: () => void;
		ondelete: () => void;
		onclear: () => void;
	} = $props();

	/** Nothing on screen is selected: every selected row is hidden, and the actions wait. */
	const idle = $derived(summary.visible === 0);
	// Each pick is an action, not a value to hold: the controls go back to their placeholder.
	let assignKey = $state(0);
</script>

<div
	class="border-primary bg-background motion-safe:animate-in motion-safe:slide-in-from-bottom-4 motion-safe:fade-in-0 sticky bottom-0 z-20 flex flex-wrap items-center gap-2 border-t-2 px-6 py-3 shadow-[0_-10px_24px_-10px_rgb(0_0_0/0.45)] duration-200"
	role="toolbar"
	aria-label="Selected fields"
	data-slot="bulk-bar"
>
	<p class="bg-primary text-primary-foreground mr-2 rounded-full px-3 py-1 text-sm font-medium tabular-nums" aria-live="polite" data-slot="selection-count">
		{selectionText(summary)}
	</p>

	<div class="w-64 max-w-full">
		{#key assignKey}
			<TypeField
				{context}
				value=""
				onchange={(type) => {
					if (type !== '') onassign(type);
					assignKey += 1;
				}}
				placeholder="Assign to entity type"
				typedPlaceholder="Assign to entity type, then Enter"
				disabled={idle}
				label="Assign to entity type"
			/>
		{/key}
	</div>

	<Select.Root type="single" bind:value={() => '', (dataType) => dataType !== '' && ondatatype(dataType)} disabled={idle}>
		<Select.Trigger aria-label="Change data type" data-slot="bulk-data-type">
			<span class="text-muted-foreground">Change data type</span>
		</Select.Trigger>
		<Select.Content>
			{#each CREATABLE_DATA_TYPES as type (type)}
				<Select.Item value={type} label={dataTypeLabel(type)} />
			{/each}
		</Select.Content>
	</Select.Root>

	{#if context}
		<Button variant="outline" disabled={idle || resyncing} onclick={onresync} data-slot="bulk-resync">
			<RefreshCw data-icon="inline-start" class={resyncing ? 'motion-safe:animate-spin' : undefined} />Re-sync from site
		</Button>
	{/if}

	<Button
		variant="outline"
		class="hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20"
		disabled={idle}
		onclick={ondelete}
		data-slot="bulk-delete"
	>
		<Trash2 data-icon="inline-start" />Delete
	</Button>

	<Button variant="ghost" class="ml-auto" onclick={onclear} data-slot="bulk-clear"><X data-icon="inline-start" />Clear selection</Button>
</div>
