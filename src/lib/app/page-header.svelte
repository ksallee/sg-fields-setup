<!--
	The top of every screen's page (docs/design.md): the title, one line of context, the actions on
	the right with the primary last. Next steps live here, never in a footer.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';

	let {
		title,
		context,
		actions,
		children,
		class: className
	}: {
		title: string;
		/** One line under the title: a string, or a snippet for links and chips. */
		context?: string | Snippet;
		/** Buttons on the right, primary last. */
		actions?: Snippet;
		/** A row under the title, full width: a toolbar, a notice. */
		children?: Snippet;
		class?: string;
	} = $props();
</script>

<header class={cn('border-border flex shrink-0 flex-col gap-3 border-b px-6 py-4', className)} data-slot="page-header">
	<div class="flex flex-wrap items-center gap-x-6 gap-y-3">
		<div class="flex min-w-0 flex-1 flex-col gap-1">
			<h1 class="truncate text-lg leading-tight font-semibold" title={title}>{title}</h1>
			{#if typeof context === 'string'}
				<p class="text-muted-foreground truncate text-sm" title={context}>{context}</p>
			{:else if context}
				<div class="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">{@render context()}</div>
			{/if}
		</div>
		{#if actions}
			<div class="flex max-w-full min-w-0 flex-wrap items-center gap-2" data-slot="page-actions">{@render actions()}</div>
		{/if}
	</div>
	{#if children}{@render children()}{/if}
</header>
