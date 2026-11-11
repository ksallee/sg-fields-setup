<!--
	The fields that already exist on one entity type of the site (EDT-21): custom, then standard,
	each sorted by display name. Collapsed until asked for; the listing is read when it opens, from
	the session's schema cache.
-->
<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import StateLine from '$lib/components/state-line.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { liveSchema } from '$lib/live';
	import { dataTypeLabel } from '$lib/pure/data-types';
	import { splitFields, type LiveField } from '$lib/pure/live-field';
	import { countText } from '$lib/pure/set-text';
	import { cn } from '$lib/utils.js';

	let { type, label }: { type: string; label: string } = $props();

	let open = $state(false);
	let fields = $state.raw<readonly LiveField[] | null>(null);
	let failed = $state(false);
	const split = $derived(fields ? splitFields(fields) : null);

	async function load(): Promise<void> {
		failed = false;
		try {
			fields = await liveSchema().fields(type);
		} catch {
			failed = true;
		}
	}

	function toggle(): void {
		open = !open;
		if (open && fields === null) void load();
	}
</script>

{#snippet list(title: string, items: LiveField[])}
	<section class="flex flex-col gap-1" data-slot="reference-list">
		<h4 class="text-muted-foreground text-xs font-medium">{title} <span class="tabular-nums">{items.length}</span></h4>
		{#if items.length === 0}
			<p class="text-muted-foreground/70 text-xs">None</p>
		{:else}
			<ul class="flex flex-col">
				{#each items as field (field.name)}
					<li class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem] items-baseline gap-x-3 py-0.5 text-xs">
						<span class="truncate" title={field.displayName.trim()}>{field.displayName.trim() || field.name}</span>
						<span class="text-muted-foreground truncate font-mono" title={field.name}>{field.name}</span>
						<span class="text-muted-foreground truncate">{dataTypeLabel(field.dataType)}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/snippet}

<div class="px-2" data-slot="reference-panel">
	<Button variant="ghost" size="xs" class="text-muted-foreground -ml-1" aria-expanded={open} onclick={toggle} data-slot="reference-toggle">
		<ChevronRight class={cn('transition-transform', open && 'rotate-90')} data-icon="inline-start" />
		Fields already on {label}{#if fields}<span class="tabular-nums">· {countText(fields.length, 'field')}</span>{/if}
	</Button>
	{#if open}
		<div class="border-border mt-1 mb-2 max-h-72 overflow-y-auto rounded-lg border px-3 py-2">
			{#if failed}
				<StateLine state="error" label="The fields of {label} did not load." pad="none">
					<Button variant="outline" size="xs" onclick={load}>Try again</Button>
				</StateLine>
			{:else if split === null}
				<p class="text-muted-foreground py-1 text-xs" role="status">Loading the fields…</p>
			{:else}
				<div class="grid gap-x-8 gap-y-3 lg:grid-cols-2">
					{@render list('Custom', split.custom)}
					{@render list('Standard', split.stock)}
				</div>
			{/if}
		</div>
	{/if}
</div>
