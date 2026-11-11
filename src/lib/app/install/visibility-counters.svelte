<!--
	A row's visibility counters (VIS-9): "2 visible", "1 to add", on a create "visible on 14", each with the project names in a
	tooltip. The counters and their tooltips come from `visibility-text.rowCounters`.
-->
<script lang="ts">
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import type { VisibilityCounter } from '$lib/pure/visibility-text';
	import { cn } from '$lib/utils.js';

	let { counters }: { counters: readonly VisibilityCounter[] } = $props();

	const TONE: Record<VisibilityCounter['kind'], string> = {
		visible: 'text-muted-foreground',
		toAdd: 'text-foreground',
		analysing: 'text-muted-foreground/70',
		locked: 'text-warning',
		outside: 'text-muted-foreground',
		toHide: 'text-foreground',
		newVisible: 'text-muted-foreground'
	};
</script>

{#if counters.length > 0}
	<span class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs tabular-nums" data-slot="visibility-counters">
		{#each counters as counter (counter.kind)}
			<Tooltip.Root>
				<Tooltip.Trigger
					class={cn('focus-visible:ring-ring cursor-default rounded-sm underline decoration-dotted underline-offset-2 outline-none focus-visible:ring-2', TONE[counter.kind])}
					data-kind={counter.kind}
				>
					{counter.label}
				</Tooltip.Trigger>
				<Tooltip.Content sideOffset={4} class="max-w-xs text-pretty">{counter.tooltip}</Tooltip.Content>
			</Tooltip.Root>
		{/each}
	</span>
{/if}
