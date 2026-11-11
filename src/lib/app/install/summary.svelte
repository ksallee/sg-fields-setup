<!--
	The install summary (RUN-5, VIS-10): the counts of what is selected and what is skipped, the
	visibility scope and the number of visibility changes. Words from `install-text`,
	`visibility-scope` and `visibility-text`.
-->
<script lang="ts">
	import type { SummaryItem } from '$lib/pure/install-text';
	import { cn } from '$lib/utils.js';

	let {
		items,
		scope,
		visibility,
		upperBound
	}: {
		items: readonly SummaryItem[];
		/** "All eligible projects (12)". */
		scope: string;
		/** "Up to 24 visibility changes". */
		visibility: string;
		/** True while the analysis is out: the count is an upper bound (VIS-10). */
		upperBound: boolean;
	} = $props();
</script>

<section class="flex flex-col gap-3" aria-label="Summary" data-slot="install-summary">
	<h2 class="text-sm font-semibold">Summary</h2>
	<ul class="flex flex-wrap gap-x-6 gap-y-2 text-sm">
		{#each items as item (item.key)}
			<li class={cn('tabular-nums', item.count === 0 && 'text-muted-foreground')} data-summary={item.key}>{item.text}</li>
		{/each}
	</ul>
	<p class="text-muted-foreground text-sm" data-slot="summary-visibility">
		<span class="text-foreground">{scope}</span> · <span class="tabular-nums">{visibility}</span>{#if upperBound}<span>
				· still reading where fields are visible</span
			>{/if}
	</p>
</section>
