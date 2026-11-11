<!--
	One entity type (EDT-23, EDT-19, EDT-41): chosen from the site's types when a site is connected,
	typed otherwise. Typed text is reported when the box is left or Enter is pressed, since a row
	changes group with its type and must not move under the caret.
-->
<script lang="ts">
	import type { SgContext } from 'sg-widgets-core';
	import EntityTypePicker from '$lib/components/entity-type-picker.svelte';
	import { Input } from '$lib/components/ui/input/index.js';

	let {
		context,
		value,
		onchange,
		deny,
		placeholder,
		typedPlaceholder = 'Entity type, for example Shot',
		clearable = false,
		disabled = false,
		invalid = false,
		label,
		id
	}: {
		/** The widgets' context, or null with no site connected. */
		context: SgContext | null;
		/** The type's API name; '' for none. */
		value: string;
		onchange: (value: string) => void;
		/** Types the picker withholds. */
		deny?: string[];
		placeholder?: string;
		typedPlaceholder?: string;
		clearable?: boolean;
		disabled?: boolean;
		invalid?: boolean;
		/** The accessible name, when no visible label points here. */
		label?: string;
		id?: string;
	} = $props();
</script>

{#if context}
	<EntityTypePicker
		{context}
		value={value === '' ? null : value}
		onValueChange={(next) => onchange(next ?? '')}
		{deny}
		{placeholder}
		{clearable}
		{disabled}
		{invalid}
		aria-label={label}
		class={disabled ? 'pointer-events-none opacity-50' : undefined}
		data-slot="type-field"
	/>
{:else}
	<Input
		{id}
		{value}
		onchange={(event) => onchange(event.currentTarget.value.trim())}
		placeholder={typedPlaceholder}
		{disabled}
		aria-label={label}
		aria-invalid={invalid || undefined}
		autocomplete="off"
		spellcheck={false}
		data-slot="type-field"
	/>
{/if}
