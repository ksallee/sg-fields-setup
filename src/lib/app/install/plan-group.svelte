<!--
	One group of the install plan (RUN-2): a header with its title and count that folds its rows.
	"Already matches" starts folded; `install-view.GROUPS` says which.
-->
<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import type { Snippet } from 'svelte';
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import type { InstallGroup } from '$lib/pure/install-view';

	let { group, children }: { group: InstallGroup; children: Snippet } = $props();

	// svelte-ignore state_referenced_locally
	let open = $state(group.open);
</script>

<Collapsible.Root bind:open class="border-border rounded-lg border" data-slot="plan-group" data-group={group.id}>
	<Collapsible.Trigger
		class="hover:bg-muted focus-visible:ring-ring flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left outline-none focus-visible:ring-2"
	>
		<ChevronRight class={['text-muted-foreground size-4 shrink-0 transition-transform', open && 'rotate-90']} aria-hidden="true" />
		<span class="text-sm font-semibold">{group.title}</span>
		<span class="text-muted-foreground text-sm tabular-nums" data-slot="group-count">{group.count}</span>
	</Collapsible.Trigger>
	<Collapsible.Content>
		<ul class="border-border border-t">{@render children()}</ul>
	</Collapsible.Content>
</Collapsible.Root>
