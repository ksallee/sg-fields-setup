<!--
	An icon-only action (docs/design.md): ghost, with its name as the accessible label and as a
	tooltip. For row actions and toolbars.

	    <IconButton label="Duplicate" icon={Copy} onclick={duplicate} />
-->
<script lang="ts">
	import type { Component } from 'svelte';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { Button, type ButtonSize } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	let {
		label,
		icon: Icon,
		onclick,
		disabled = false,
		destructive = false,
		size = 'icon-sm',
		class: className
	}: {
		label: string;
		icon: Component;
		onclick?: (event: MouseEvent) => void;
		disabled?: boolean;
		/** Turns destructive on hover and focus only: quiet until reached for. */
		destructive?: boolean;
		size?: ButtonSize;
		class?: string;
	} = $props();
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="ghost"
				{size}
				{disabled}
				aria-label={label}
				class={cn(
					'text-muted-foreground',
					destructive && 'hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive dark:hover:bg-destructive/20',
					className
				)}
				onclick={(event: MouseEvent) => {
					(props.onclick as ((event: MouseEvent) => void) | undefined)?.(event);
					onclick?.(event);
				}}
			>
				<Icon aria-hidden="true" />
			</Button>
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Content sideOffset={4}>{label}</Tooltip.Content>
</Tooltip.Root>
