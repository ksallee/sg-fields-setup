<!--
	The entity types a link field may point to (EDT-27, MOD-11, MOD-12): one for a multi-entity
	link, one or several for an entity link. Chosen from the site's types when a site is connected;
	typed as API names otherwise, comma-separated for an entity link.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import type { SgContext } from 'sg-widgets-core';
	import EntityTypeMultiPicker from '$lib/components/entity-type-multi-picker.svelte';
	import EntityTypePicker from '$lib/components/entity-type-picker.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { commaListText, parseCommaList, sameItems } from '$lib/pure/list-text';

	let {
		context,
		single,
		value,
		onchange,
		disabled = false,
		id,
		labelledby
	}: {
		context: SgContext | null;
		/** A multi-entity link: exactly one type. */
		single: boolean;
		value: string[];
		onchange: (value: string[]) => void;
		disabled?: boolean;
		/** The typed box's id, for a `<label for>`. */
		id?: string;
		/** The id of the visible label. It names the picker's group: the picker takes no `id` (sg-widgets #374). */
		labelledby?: string;
	} = $props();

	const parse = (text: string): string[] => (single ? (text.trim() === '' ? [] : [text.trim()]) : parseCommaList(text));

	// As in the valid values box: the text follows `value` only when the two disagree.
	let text = $state(untrack(() => commaListText(value)));
	$effect(() => {
		const next = value;
		if (!sameItems(parse(untrack(() => text)), next)) text = commaListText(next);
	});
</script>

{#if context && single}
	<EntityTypePicker
		{context}
		value={value[0] ?? null}
		onValueChange={(next) => onchange(next ? [next] : [])}
		placeholder="Select the entity type"
		{disabled}
		role="group"
		aria-labelledby={labelledby}
		data-slot="valid-types-field"
	/>
{:else if context}
	<EntityTypeMultiPicker
		{context}
		{value}
		onValueChange={(next) => onchange(next)}
		summary="chips"
		placeholder="Select entity types"
		{disabled}
		role="group"
		aria-labelledby={labelledby}
		data-slot="valid-types-field"
	/>
{:else}
	<Input
		{id}
		value={text}
		oninput={(event) => {
			text = event.currentTarget.value;
			onchange(parse(text));
		}}
		placeholder={single ? 'Entity type, for example Asset' : 'Entity types, for example Shot, Asset'}
		{disabled}
		autocomplete="off"
		spellcheck={false}
		data-slot="valid-types-field"
	/>
{/if}
