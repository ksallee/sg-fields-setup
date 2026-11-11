<!--
	A header button that says why it is disabled (EDT-9 to EDT-11). A disabled button takes no
	pointer events, so the reason hangs on a wrapper that does, and that the keyboard can reach.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { Button, type ButtonVariant } from '$lib/components/ui/button/index.js';

	let {
		reason = null,
		variant = 'outline',
		busy = false,
		onclick,
		children,
		slot
	}: {
		/** Why the action cannot run, or null when it can. */
		reason?: string | null;
		variant?: ButtonVariant;
		/** Disabled with no reason to give: the action is running. */
		busy?: boolean;
		onclick: () => void;
		children: Snippet;
		/** The button's `data-slot`. */
		slot: string;
	} = $props();
</script>

{#if reason}
	<Tooltip.Root delayDuration={150}>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<span {...props} tabindex="0" class="focus-visible:ring-ring inline-flex rounded-lg outline-none focus-visible:ring-2" data-slot="{slot}-reason">
					<Button {variant} disabled aria-describedby={undefined} data-slot={slot}>{@render children()}</Button>
					<span class="sr-only">{reason}</span>
				</span>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content sideOffset={4}>{reason}</Tooltip.Content>
	</Tooltip.Root>
{:else}
	<Button {variant} disabled={busy} {onclick} data-slot={slot}>{@render children()}</Button>
{/if}
