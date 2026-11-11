<!--
	The valid values of a list or a status list (EDT-28): one per line in a text box, lines trimmed
	and blanks dropped as they are reported. For a status list the values are status short codes.

	A host stand-in for sg-widgets' `valid-values-editor`, which needs sg-widgets-core 0.4.0. It
	takes the same props (`dataType`, `value`, `onValueChange`, `context`, `placeholder`,
	`disabled`, `readonly`, `invalid`), so the widget drops in behind them. `context` is taken and
	not read: the widget picks a status list's codes from the site through it.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import type { SgContext } from 'sg-widgets-core';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { linesText, parseLines, sameItems } from '$lib/pure/list-text';

	let {
		dataType = 'list',
		value = [],
		onValueChange,
		context: _context = undefined,
		placeholder,
		disabled = false,
		readonly = false,
		invalid = false,
		id
	}: {
		dataType?: 'list' | 'status_list';
		value?: string[];
		onValueChange?: (value: string[]) => void;
		context?: SgContext;
		placeholder?: string;
		disabled?: boolean;
		readonly?: boolean;
		invalid?: boolean;
		id?: string;
	} = $props();

	// The text as typed. It follows `value` only when the two disagree, so a blank line or a
	// trailing space being typed is not wiped by its own report.
	let text = $state(untrack(() => linesText(value)));
	$effect(() => {
		const next = value;
		if (!sameItems(parseLines(untrack(() => text)), next)) text = linesText(next);
	});
</script>

<Textarea
	{id}
	value={text}
	oninput={(event) => {
		text = event.currentTarget.value;
		onValueChange?.(parseLines(text));
	}}
	rows={4}
	{disabled}
	{readonly}
	spellcheck={false}
	autocomplete="off"
	aria-invalid={invalid || undefined}
	placeholder={placeholder ?? (dataType === 'status_list' ? 'ip\nfin\nwtg' : 'One value per line')}
	class={dataType === 'status_list' ? 'font-mono text-xs' : undefined}
	data-slot="valid-values-field"
/>
