<!--
	One field in the list (EDT-20): a line with its checkbox, names, data type, markers and delete,
	and its form when expanded. It keeps no state: the page holds what is selected and expanded.
	The form is only drawn while the row is open, so 500 collapsed rows stay light (MOD-21).
-->
<script lang="ts">
	import type { SgContext } from 'sg-widgets-core';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import type { RowComparison } from '$lib/pure/compare';
	import { dataTypeLabel, isMirror } from '$lib/pure/data-types';
	import { rowBadges, type BadgeTone } from '$lib/pure/editor-row';
	import { selectRowLabel } from '$lib/pure/editor-text';
	import type { EntryDefinition } from '$lib/pure/model';
	import type { NameMode, Row } from '$lib/pure/working-copy';
	import { cn } from '$lib/utils.js';
	import EntryForm from './entry-form.svelte';

	let {
		row,
		comparison,
		incomplete,
		duplicated,
		selected,
		expanded,
		context,
		ontoggle,
		onselect,
		onedit,
		onnamemode,
		ondelete
	}: {
		row: Row;
		comparison: RowComparison | undefined;
		incomplete: boolean;
		duplicated: boolean;
		selected: boolean;
		expanded: boolean;
		context: SgContext | null;
		ontoggle: (key: string) => void;
		/** A click on the checkbox, with whether shift was held (EDT-39). */
		onselect: (key: string, shift: boolean) => void;
		onedit: (key: string, patch: Partial<EntryDefinition>) => void;
		onnamemode: (key: string, mode: NameMode) => void;
		ondelete: (key: string) => void;
	} = $props();

	const DOT: Record<BadgeTone, string> = {
		neutral: 'bg-muted-foreground',
		success: 'bg-success',
		warning: 'bg-warning',
		destructive: 'bg-destructive'
	};

	const badges = $derived(rowBadges({ mirror: isMirror(row), incomplete, duplicated, markers: comparison?.markers ?? [] }));
	const title = $derived(row.displayName.trim());
</script>

<li class="border-border border-b" data-slot="entry-row" data-row-key={row.key} data-expanded={expanded ? '' : undefined}>
	<div class={cn('hover:bg-muted flex items-center gap-2 px-2 py-1', selected && 'bg-muted/60')}>
		<Checkbox
			bind:checked={() => selected, () => {}}
			onclick={(event: MouseEvent) => onselect(row.key, event.shiftKey)}
			aria-label={selectRowLabel(row.displayName)}
			class="select-none"
			data-slot="row-check"
		/>
		<button
			type="button"
			class="focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2"
			aria-expanded={expanded}
			onclick={() => ontoggle(row.key)}
			data-slot="row-toggle"
		>
			<ChevronRight class={cn('text-muted-foreground size-4 shrink-0 transition-transform', expanded && 'rotate-90')} aria-hidden="true" />
			<span class="grid min-w-0 flex-1 grid-cols-1 items-center gap-x-4 gap-y-0.5 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
				{#if title}
					<span class="truncate text-sm font-medium" title={title} data-slot="row-title">{title}</span>
				{:else}
					<span class="text-muted-foreground/70 truncate text-sm" data-slot="row-title">New field</span>
				{/if}
				<span class="flex min-w-0 items-center gap-x-4 gap-y-0.5">
					<span class="text-muted-foreground min-w-0 shrink truncate font-mono text-xs sm:w-72" title={row.programmaticName} data-slot="row-name">
						{row.programmaticName || 'No name'}
					</span>
					<span class="text-muted-foreground shrink-0 text-xs" data-slot="row-data-type">
						{row.dataType ? dataTypeLabel(row.dataType) : 'No data type'}
					</span>
					{#if badges.length > 0}
						<span class="ml-auto flex shrink-0 items-center gap-1" data-slot="row-badges">
							{#each badges as badge (badge.kind)}
								<Badge variant="outline" class="text-muted-foreground font-normal" data-badge={badge.kind}>
									<span class={cn('size-1.5 rounded-full', DOT[badge.tone])} aria-hidden="true"></span>
									<span class="max-sm:sr-only">{badge.label}</span>
								</Badge>
							{/each}
						</span>
					{/if}
				</span>
			</span>
		</button>
		<Button
			variant="ghost"
			size="icon-sm"
			class="text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive dark:hover:bg-destructive/20"
			aria-label="Delete field"
			title="Delete field"
			onclick={() => ondelete(row.key)}
			data-slot="row-delete"
		>
			<Trash2 aria-hidden="true" />
		</Button>
	</div>
	{#if expanded}
		<EntryForm
			{row}
			{comparison}
			{duplicated}
			{context}
			onedit={(patch) => onedit(row.key, patch)}
			onnamemode={(mode) => onnamemode(row.key, mode)}
		/>
	{/if}
</li>
