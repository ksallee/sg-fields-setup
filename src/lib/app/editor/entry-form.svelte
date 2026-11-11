<!--
	The inputs of one field, in its expanded row (EDT-23 to EDT-32, CMP-9). It draws the row it is
	given and reports each edit; the working copy decides what an edit does. Only the inputs the
	data type carries show. A mirror row is locked.
-->
<script lang="ts">
	import type { SgContext } from 'sg-widgets-core';
	import Notice from '$lib/app/notice.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { explanationText, type RowComparison } from '$lib/pure/compare';
	import DataTypePicker from '$lib/components/data-type-picker.svelte';
	import ValidValuesEditor from '$lib/components/valid-values-editor.svelte';
	import { carries, CREATABLE_DATA_TYPES, DATA_TYPE_LABELS, isMirror } from '$lib/pure/data-types';
	import {
		CHECKBOX_DEFAULT_LABELS,
		CHECKBOX_DEFAULTS,
		checkboxDefaultChoice,
		checkboxDefaultValue,
		listDefaultText,
		listDefaultValue,
		missingRequired,
		missingText,
		nameWarning,
		type CheckboxDefault
	} from '$lib/pure/editor-row';
	import { MIRROR_TEXT, UNIQUE_NOTE } from '$lib/pure/editor-text';
	import type { EntryDefinition } from '$lib/pure/model';
	import type { NameMode, Row } from '$lib/pure/working-copy';
	import TypeField from './type-field.svelte';
	import ValidTypesField from './valid-types-field.svelte';

	let {
		row,
		comparison,
		duplicated,
		context,
		onedit,
		onnamemode
	}: {
		row: Row;
		comparison: RowComparison | undefined;
		duplicated: boolean;
		/** The widgets' context, or null with no site connected. */
		context: SgContext | null;
		onedit: (patch: Partial<EntryDefinition>) => void;
		onnamemode: (mode: NameMode) => void;
	} = $props();

	const uid = $props.id();
	const mirror = $derived(isMirror(row));
	const dataType = $derived(row.dataType.trim());
	const missing = $derived(missingRequired(row));
	const follows = $derived(row.nameMode === 'derived');
	// A typed name only with the site's fields to check against: without them a stock field such
	// as `code` would be called out as a name the site would not derive. A derived name is a new
	// field's, so a non-ASCII display name is called out without the site too (G11).
	const warning = $derived(
		context && !comparison?.typeNotOnSite
			? nameWarning(row, comparison?.nameExists != null)
			: follows
				? nameWarning(row, false)
				: null
	);
	// The group says a type is not on the site; the row does not say it again.
	const notes = $derived((comparison?.notes ?? []).filter((note) => note.kind !== 'type_not_on_site'));

	/** A new blank row opens with the caret in its display name (EDT-18). */
	function focusWhenBlank(node: HTMLElement): void {
		if (row.isNew && row.displayName === '') node.querySelector('input')?.focus();
	}
</script>

<div class="border-border bg-muted/40 border-t px-4 py-4 sm:pl-11" data-slot="entry-form">
	<div class="flex max-w-3xl flex-col gap-4">
		{#if mirror}<Notice tone="info" data-slot="mirror-note">{MIRROR_TEXT}</Notice>{/if}
		{#if missing.length > 0}<Notice tone="destructive" data-slot="incomplete-note">{missingText(missing)}</Notice>{/if}
		{#if duplicated}
			<Notice tone="destructive" data-slot="duplicate-note">
				Another field in this set has the same entity type and programmatic name.
			</Notice>
		{/if}
		{#each notes as note (note.kind)}
			<Notice tone={note.kind === 'on_site' ? 'info' : 'warning'} data-slot="site-note" data-kind={note.kind}>
				{explanationText(note)}
			</Notice>
		{/each}

		<div class="grid gap-4 sm:grid-cols-2">
			<div class="flex flex-col gap-1.5" use:focusWhenBlank>
				<Label for="{uid}-display">Display name</Label>
				<Input
					id="{uid}-display"
					value={row.displayName}
					oninput={(event) => onedit({ displayName: event.currentTarget.value })}
					disabled={mirror}
					aria-invalid={row.displayName.trim() === '' || undefined}
					autocomplete="off"
					data-slot="display-name"
				/>
			</div>

			<div class="flex flex-col gap-1.5">
				<div class="flex h-3.5 items-center justify-between gap-2">
					<Label for="{uid}-name">Programmatic name</Label>
					{#if !mirror}
						<Button
							variant="link"
							size="xs"
							class="h-auto p-0"
							onclick={() => onnamemode(follows ? 'manual' : 'derived')}
							data-slot="name-mode"
						>
							{follows ? 'Type it by hand' : 'Derive from display name'}
						</Button>
					{/if}
				</div>
				<Input
					id="{uid}-name"
					value={row.programmaticName}
					oninput={(event) => onedit({ programmaticName: event.currentTarget.value })}
					readonly={follows && !mirror}
					disabled={mirror}
					placeholder={follows ? 'Follows the display name' : 'sg_field_name'}
					aria-invalid={(!follows && row.programmaticName.trim() === '') || undefined}
					autocomplete="off"
					spellcheck={false}
					class={follows && !mirror ? 'bg-muted/60 text-muted-foreground font-mono text-xs md:text-xs' : 'font-mono text-xs md:text-xs'}
					data-slot="programmatic-name"
					data-mode={row.nameMode}
				/>
				{#if warning}
					<p class="text-warning-foreground dark:text-warning text-xs" data-slot="name-warning">{warning}</p>
				{:else if follows && !mirror}
					<p class="text-muted-foreground text-xs">Derived from the display name, as the site names a new field.</p>
				{/if}
			</div>

			<div class="flex flex-col gap-1.5">
				<Label for="{uid}-type">Entity type</Label>
				<TypeField
					id="{uid}-type"
					{context}
					value={row.targetEntityType}
					onchange={(targetEntityType) => onedit({ targetEntityType })}
					disabled={mirror}
					invalid={row.targetEntityType.trim() === ''}
					label="Entity type"
				/>
			</div>

			<div class="flex flex-col gap-1.5">
				<Label for="{uid}-data-type">Data type</Label>
				<DataTypePicker
					id="{uid}-data-type"
					types={CREATABLE_DATA_TYPES}
					labels={DATA_TYPE_LABELS}
					value={row.dataType === '' ? null : row.dataType}
					onValueChange={(next) => onedit({ dataType: next ?? '' })}
					readonly={mirror}
					invalid={dataType === ''}
				/>
			</div>

			{#if !mirror && carries(dataType, 'validTypes')}
				<div class="flex flex-col gap-1.5 sm:col-span-2">
					<Label for="{uid}-valid-types">{dataType === 'multi_entity' ? 'Valid type' : 'Valid types'}</Label>
					<ValidTypesField
						id="{uid}-valid-types"
						{context}
						single={dataType === 'multi_entity'}
						value={row.validTypes}
						onchange={(validTypes) => onedit({ validTypes })}
					/>
					<p class="text-muted-foreground text-xs">
						{dataType === 'multi_entity'
							? 'The entity type this link points to. One type.'
							: 'The entity types this link may point to.'}
					</p>
				</div>
			{/if}

			{#if !mirror && carries(dataType, 'validValues')}
				<div class="flex flex-col gap-1.5">
					<Label for="{uid}-values">Valid values</Label>
					<ValidValuesEditor
						id="{uid}-values"
						dataType={dataType === 'status_list' ? 'status_list' : 'list'}
						value={[...row.validValues]}
						onValueChange={(validValues) => onedit({ validValues })}
						context={context ?? undefined}
					/>
					<p class="text-muted-foreground text-xs">
						{dataType === 'status_list'
							? context
								? 'Statuses of this site.'
								: 'Status short codes. Connect a site to pick from its statuses.'
							: 'In drop-down order. Drag to reorder. A paste of several lines adds one value each.'}
					</p>
				</div>
			{/if}

			{#if !mirror && carries(dataType, 'defaultValue')}
				<div class="flex flex-col gap-1.5">
					<Label for="{uid}-default">Default value <span class="text-muted-foreground font-normal">optional</span></Label>
					{#if dataType === 'checkbox'}
						{@const choice = checkboxDefaultChoice(row.defaultValue)}
						<Select.Root
							type="single"
							value={choice}
							onValueChange={(next) => onedit({ defaultValue: checkboxDefaultValue(next as CheckboxDefault) })}
						>
							<Select.Trigger id="{uid}-default" class="w-full" data-slot="default-value">{CHECKBOX_DEFAULT_LABELS[choice]}</Select.Trigger>
							<Select.Content>
								{#each CHECKBOX_DEFAULTS as option (option)}
									<Select.Item value={option} label={CHECKBOX_DEFAULT_LABELS[option]} />
								{/each}
							</Select.Content>
						</Select.Root>
					{:else}
						<Input
							id="{uid}-default"
							value={listDefaultText(row.defaultValue)}
							oninput={(event) => onedit({ defaultValue: listDefaultValue(event.currentTarget.value) })}
							placeholder="None"
							autocomplete="off"
							data-slot="default-value"
						/>
					{/if}
				</div>
			{/if}

			{#if !mirror && carries(dataType, 'uniquePerProject')}
				<div class="flex flex-col gap-1.5 sm:col-span-2">
					<div class="flex items-center gap-2">
						<Checkbox
							id="{uid}-unique"
							checked={row.uniquePerProject}
							onCheckedChange={(checked) => onedit({ uniquePerProject: checked === true })}
							data-slot="unique"
						/>
						<Label for="{uid}-unique" class="font-normal">Unique per project</Label>
					</div>
					<p class="text-muted-foreground text-xs">{UNIQUE_NOTE}</p>
				</div>
			{/if}

			<div class="flex flex-col gap-1.5 sm:col-span-2">
				<Label for="{uid}-description">Description <span class="text-muted-foreground font-normal">optional</span></Label>
				<Textarea
					id="{uid}-description"
					value={row.description ?? ''}
					oninput={(event) => onedit({ description: event.currentTarget.value })}
					disabled={mirror}
					class="min-h-14"
					data-slot="description"
				/>
			</div>
		</div>
	</div>
</div>
