<!--
	One entity type's fields (EDT-16 to EDT-22, EDT-40, CMP-10): a header with the type's name,
	glyph, count and its actions, the mark of a type the site lacks, the reference panel, then the
	rows. It draws what the page hands it and reports what was clicked.
-->
<script lang="ts">
	import type { SgContext } from 'sg-widgets-core';
	import Plus from '@lucide/svelte/icons/plus';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Notice from '$lib/app/notice.svelte';
	import { entityGlyph } from '$lib/components/entity-glyphs.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { explanationText, type RowComparison } from '$lib/pure/compare';
	import { selectGroupLabel } from '$lib/pure/editor-text';
	import { groupCountText, type EditorGroup } from '$lib/pure/editor-view';
	import type { LiveField } from '$lib/pure/live-field';
	import type { EntryDefinition } from '$lib/pure/model';
	import type { GroupCheckState } from '$lib/pure/selection';
	import type { NameMode, Row } from '$lib/pure/working-copy';
	import EntryRow from './entry-row.svelte';
	import ReferencePanel from './reference-panel.svelte';

	let {
		group,
		rowOf,
		comparisonOf,
		incomplete,
		duplicated,
		selected,
		expanded,
		checkState,
		notOnSite,
		rechecking,
		context,
		referenceFields,
		onloadfields,
		onadd,
		ontogglegroup,
		onrecheck,
		ontoggle,
		onselect,
		onedit,
		onnamemode,
		ondelete
	}: {
		group: EditorGroup;
		rowOf: ReadonlyMap<string, Row>;
		comparisonOf: ReadonlyMap<string, RowComparison>;
		incomplete: ReadonlySet<string>;
		duplicated: ReadonlySet<string>;
		selected: ReadonlySet<string>;
		expanded: ReadonlySet<string>;
		checkState: GroupCheckState;
		/** A site is connected and lacks this type (CMP-10). */
		notOnSite: boolean;
		rechecking: boolean;
		context: SgContext | null;
		/** This type's fields on the site as the editor holds them, for the reference panel (EDT-21). */
		referenceFields: readonly LiveField[] | null;
		onloadfields: (type: string) => Promise<void>;
		onadd: (type: string) => void;
		ontogglegroup: (keys: string[]) => void;
		onrecheck: () => void;
		ontoggle: (key: string) => void;
		onselect: (key: string, shift: boolean) => void;
		onedit: (key: string, patch: Partial<EntryDefinition>) => void;
		onnamemode: (key: string, mode: NameMode) => void;
		ondelete: (key: string) => void;
	} = $props();

	const Glyph = $derived(entityGlyph(group.unassigned ? null : group.type));
</script>

<section class="flex flex-col" data-slot="entry-group" data-type={group.type}>
	<header class="bg-background border-border sticky top-0 z-10 flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 border-b px-2 py-1.5">
		<Checkbox
			bind:checked={() => checkState === 'all', () => {}}
			indeterminate={checkState === 'some'}
			onclick={() => ontogglegroup(group.keys)}
			disabled={group.keys.length === 0}
			aria-label={selectGroupLabel(group.label)}
			data-slot="group-check"
		/>
		<Glyph class="text-muted-foreground ml-0.5 size-4 shrink-0" aria-hidden="true" />
		<h3 class="truncate text-sm font-semibold" title={group.label}>{group.label}</h3>
		{#if !group.unassigned && group.label !== group.type}
			<span class="text-muted-foreground truncate font-mono text-xs max-sm:hidden">{group.type}</span>
		{/if}
		<span class="text-muted-foreground text-xs tabular-nums" data-slot="group-count">{groupCountText(group)}</span>
		{#if notOnSite}
			<Badge variant="outline" class="text-muted-foreground font-normal" data-slot="not-on-site">
				<span class="bg-warning size-1.5 rounded-full" aria-hidden="true"></span>Not on this site
			</Badge>
		{/if}
		<Button variant="ghost" size="sm" class="ml-auto" onclick={() => onadd(group.type)} data-slot="add-field">
			<Plus data-icon="inline-start" />Add field
		</Button>
	</header>

	{#if notOnSite}
		<Notice tone="warning" class="mx-2 mt-2" data-slot="not-on-site-note">
			{explanationText({ kind: 'type_not_on_site', entityType: group.type })}
			{#snippet action()}
				<Button variant="outline" size="sm" disabled={rechecking} onclick={onrecheck} data-slot="recheck">
					<RefreshCw data-icon="inline-start" class={rechecking ? 'motion-safe:animate-spin' : undefined} />Re-check
				</Button>
			{/snippet}
		</Notice>
	{/if}

	{#if context && !group.unassigned && !notOnSite}
		<div class="pt-1"><ReferencePanel type={group.type} label={group.label} fields={referenceFields} onload={onloadfields} /></div>
	{/if}

	{#if group.emptyHint}
		<p class="text-muted-foreground px-2 py-3 text-sm" data-slot="group-hint">
			No fields yet. Add a field, or assign fields to this entity type. An empty entity type is not saved.
		</p>
	{:else}
		<ul class="flex flex-col" data-slot="entry-rows">
			{#each group.keys as key (key)}
				{@const row = rowOf.get(key)}
				{#if row}
					<EntryRow
						{row}
						comparison={comparisonOf.get(key)}
						incomplete={incomplete.has(key)}
						duplicated={duplicated.has(key)}
						selected={selected.has(key)}
						expanded={expanded.has(key)}
						{context}
						{ontoggle}
						{onselect}
						{onedit}
						{onnamemode}
						{ondelete}
					/>
				{/if}
			{/each}
		</ul>
	{/if}
</section>
