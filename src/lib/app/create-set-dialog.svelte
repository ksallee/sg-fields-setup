<!--
	Create an empty set (SET-14 to SET-17): a name, an optional description. The set is stored
	with origin manual. A refusal, a taken name included (MOD-2), shows here and the input stays.
	The dialog cannot be dismissed while it saves. `oncreated` gets the stored set.
-->
<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { sharedSetStore } from '$lib/io/set-store';
	import type { FieldSet } from '$lib/pure/model';
	import { refusalMessage } from '$lib/pure/set-plan';
	import Notice from './notice.svelte';
	import { errorMessage } from './toast';

	let { open = $bindable(false), oncreated }: { open?: boolean; oncreated: (set: FieldSet) => void } = $props();

	let name = $state('');
	let description = $state('');
	let saving = $state(false);
	let error = $state<string | null>(null);

	// Each opening starts blank. A failed save keeps the dialog open, so the input is never lost.
	$effect(() => {
		if (open) {
			name = '';
			description = '';
			error = null;
		}
	});

	const canCreate = $derived(name.trim() !== '' && !saving);

	async function create(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!canCreate) return;
		saving = true;
		error = null;
		try {
			const store = await sharedSetStore();
			const result = await store.createSet({ name, description, origin: 'manual' });
			if (result.ok) {
				saving = false;
				open = false;
				oncreated(result.set);
			} else {
				error = refusalMessage(result);
			}
		} catch (caught) {
			error = errorMessage(caught);
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root
	bind:open={
		() => open,
		(next) => {
			if (!saving) open = next;
		}
	}
>
	<Dialog.Content
		data-slot="create-set-dialog"
		showCloseButton={!saving}
		escapeKeydownBehavior={saving ? 'ignore' : 'close'}
		interactOutsideBehavior={saving ? 'ignore' : 'close'}
	>
		<form class="contents" onsubmit={create}>
			<Dialog.Header>
				<Dialog.Title>New set</Dialog.Title>
				<Dialog.Description>An empty set. Add its fields in the editor.</Dialog.Description>
			</Dialog.Header>
			<div class="flex flex-col gap-4">
				<div class="flex flex-col gap-1.5">
					<Label for="create-set-name">Name</Label>
					<Input id="create-set-name" bind:value={name} autocomplete="off" aria-invalid={error !== null} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="create-set-description">Description <span class="text-muted-foreground font-normal">optional</span></Label>
					<Textarea id="create-set-description" bind:value={description} rows={3} class="max-h-40" />
				</div>
				{#if error}<Notice tone="destructive" data-slot="create-set-error">{error}</Notice>{/if}
			</div>
			<Dialog.Footer>
				<Button variant="ghost" disabled={saving} onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" disabled={!canCreate}>{saving ? 'Creating…' : 'Create set'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
