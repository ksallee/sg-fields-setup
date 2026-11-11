<!--
	Per-project visibility (VIS-1 to VIS-3, VIS-12): what the picker decides, the picker, and what
	the scope needs said. The picker searches eligible projects only (`ELIGIBLE_PROJECT_FILTERS`);
	what it holds still goes through `resolveScope`, whose notes show here.
-->
<script lang="ts">
	import type { EntityRef, SgContext } from 'sg-widgets-core';
	import Notice from '$lib/app/notice.svelte';
	import ProjectMultiPicker from '$lib/components/project-multi-picker.svelte';
	import { ELIGIBLE_PROJECT_FILTERS, VISIBILITY_EXPLANATION } from '$lib/pure/visibility-scope';

	let {
		context,
		value,
		disabled,
		notes,
		analysisFailed,
		onchange
	}: {
		context: SgContext;
		value: EntityRef[];
		disabled: boolean;
		/** `scopeNotes(resolved)`. */
		notes: readonly string[];
		/** The analysis could not read every project. The run is still allowed (VIS-12). */
		analysisFailed: boolean;
		onchange: (value: EntityRef[]) => void;
	} = $props();

	const labelId = $props.id();
</script>

<section class="flex flex-col gap-3" data-slot="visibility-panel">
	<div class="flex flex-col gap-1.5">
		<h2 id={labelId} class="text-sm font-semibold">Visible on</h2>
		<p class="text-muted-foreground text-sm">{VISIBILITY_EXPLANATION}</p>
	</div>
	<ProjectMultiPicker
		{context}
		bind:value={() => value, (next) => onchange(next)}
		filters={ELIGIBLE_PROJECT_FILTERS}
		placeholder="All eligible projects"
		{disabled}
		role="group"
		aria-labelledby={labelId}
	/>
	{#each notes as note (note)}
		<Notice tone="warning" data-slot="scope-note">{note}</Notice>
	{/each}
	{#if analysisFailed}
		<Notice tone="info" data-slot="analysis-note">Some projects could not be read. Their counters stay on analysing. Install still checks each project.</Notice>
	{/if}
</section>
