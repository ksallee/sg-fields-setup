<!--
	The data type of one field (EDT-26): a choice among `types`, or read-only text for a type that
	cannot be picked, such as a mirror's live type.

	A host stand-in for sg-widgets' `data-type-picker`, which needs sg-widgets-core 0.4.0. It takes
	the same props (`types`, `value`, `onValueChange`, `labels`, `placeholder`, `readonly`,
	`disabled`, `invalid`), so the widget drops in behind them.
-->
<script lang="ts">
	import * as Select from '$lib/components/ui/select/index.js';
	import { dataTypeLabel } from '$lib/pure/data-types';

	let {
		types = [],
		value = null,
		onValueChange,
		labels,
		placeholder = 'Select a data type',
		readonly = false,
		disabled = false,
		invalid = false,
		id
	}: {
		/** The data types on offer, in the order they are listed. */
		types?: readonly string[];
		/** The chosen data type, by its API name, or null when nothing is chosen. */
		value?: string | null;
		onValueChange?: (value: string | null) => void;
		/** Labels of the caller's own, by API name. They win over the built-in ones. */
		labels?: Readonly<Record<string, string>>;
		placeholder?: string;
		readonly?: boolean;
		disabled?: boolean;
		invalid?: boolean;
		id?: string;
	} = $props();

	const label = (type: string): string => labels?.[type] ?? dataTypeLabel(type);
</script>

{#if readonly}
	<p {id} class="flex h-8 items-center gap-2 text-sm" data-slot="data-type-field" data-readonly="">
		{#if value}
			<span>{label(value)}</span>
			{#if label(value) !== value}<span class="text-muted-foreground font-mono text-xs">{value}</span>{/if}
		{:else}
			<span class="text-muted-foreground/70">No data type</span>
		{/if}
	</p>
{:else}
	<Select.Root type="single" value={value ?? ''} onValueChange={(next) => onValueChange?.(next === '' ? null : next)} {disabled}>
		<Select.Trigger {id} class="w-full" aria-invalid={invalid || undefined} data-slot="data-type-field">
			{#if value}{label(value)}{:else}<span class="text-muted-foreground">{placeholder}</span>{/if}
		</Select.Trigger>
		<Select.Content>
			{#each types as type (type)}
				<Select.Item value={type} label={label(type)} />
			{/each}
		</Select.Content>
	</Select.Root>
{/if}
