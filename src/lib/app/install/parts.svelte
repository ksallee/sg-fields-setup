<!--
	A reason or an error as text and links (RUN-21). The parts come from `plan-reason` and
	`run-text` as data. Text is rendered as text, a link opens in a new tab. No HTML is ever
	injected: a server's message shows exactly as it was sent.
-->
<script lang="ts">
	import type { ReasonPart } from '$lib/pure/plan-reason';

	let { parts }: { parts: readonly ReasonPart[] } = $props();
</script>

{#each parts as part, index (index)}{#if part.kind === 'link'}<a
			href={part.href}
			target="_blank"
			rel="noopener noreferrer"
			class="text-foreground focus-visible:ring-ring rounded-sm underline underline-offset-2 outline-none focus-visible:ring-2">{part.text}</a
		>{:else}{part.text}{/if}{/each}
