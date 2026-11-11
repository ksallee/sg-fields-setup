<!-- The set's name and description, at the top of the editor (EDT-15). -->
<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';

	let {
		name,
		description,
		onname,
		ondescription
	}: {
		name: string;
		description: string;
		onname: (name: string) => void;
		ondescription: (description: string) => void;
	} = $props();

	const uid = $props.id();
</script>

<section class="flex max-w-3xl flex-col gap-4" aria-label="Set details" data-slot="set-details">
	<div class="flex flex-col gap-1.5">
		<Label for="{uid}-name">Name</Label>
		<Input
			id="{uid}-name"
			value={name}
			oninput={(event) => onname(event.currentTarget.value)}
			aria-invalid={name.trim() === '' || undefined}
			autocomplete="off"
			data-slot="set-name-input"
		/>
		{#if name.trim() === ''}<p class="text-destructive text-xs">The set needs a name.</p>{/if}
	</div>
	<div class="flex flex-col gap-1.5">
		<Label for="{uid}-description">Description <span class="text-muted-foreground font-normal">optional</span></Label>
		<Textarea
			id="{uid}-description"
			value={description}
			oninput={(event) => ondescription(event.currentTarget.value)}
			class="min-h-14"
			data-slot="set-description-input"
		/>
	</div>
</section>
