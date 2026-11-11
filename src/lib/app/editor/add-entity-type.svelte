<!--
	"Add entity type" (EDT-19): names a type so fields can be added to it. With a site connected the
	type is picked from the site's list; without, it is typed. The group it adds is not stored
	until it holds a field.
-->
<script lang="ts">
	import type { SgContext } from 'sg-widgets-core';
	import { Button } from '$lib/components/ui/button/index.js';
	import TypeField from './type-field.svelte';

	let {
		context,
		taken,
		onadd,
		oncancel
	}: {
		context: SgContext | null;
		/** Types that already have a group: the picker withholds them. */
		taken: string[];
		onadd: (type: string) => void;
		oncancel: () => void;
	} = $props();

	/** The picker or the text box takes the caret as it appears. */
	function focusFirst(node: HTMLElement): void {
		node.querySelector<HTMLElement>('input, [role="combobox"], button')?.focus();
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="border-border flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2"
	role="group"
	aria-label="Add entity type"
	onkeydown={(event) => event.key === 'Escape' && oncancel()}
	data-slot="add-entity-type"
>
	<p class="text-sm font-medium">Add entity type</p>
	<div class="w-64 max-w-full" use:focusFirst>
		<TypeField
			{context}
			value=""
			onchange={(type) => type !== '' && onadd(type)}
			deny={taken}
			placeholder="Select an entity type"
			typedPlaceholder="API name, for example Shot, then Enter"
			label="Entity type to add"
		/>
	</div>
	{#if !context}<p class="text-muted-foreground text-xs">No site is connected, so the type is typed as its API name.</p>{/if}
	<Button variant="ghost" class="ml-auto" onclick={oncancel}>Cancel</Button>
</div>
