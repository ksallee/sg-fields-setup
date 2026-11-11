<!--
	The confirmation before an action that cannot be taken back (docs/design.md): a title that
	names the action, one sentence that names the thing, Cancel and the action. With `rememberLabel`
	it offers "do not ask again" and reports the tick to `onconfirm`; the caller stores it.

	The dialog does not close itself on confirm. The caller runs the action with `busy` set, then
	closes it, or sets `error` and leaves it open. It cannot be dismissed while busy.

	    <ConfirmDialog
	        bind:open
	        title="Delete this set?"
	        message={deleteQuestion(name, count)}
	        confirmLabel="Delete set"
	        destructive
	        rememberLabel="Do not ask again when deleting a set"
	        {busy}
	        {error}
	        onconfirm={({ remember }) => remove(remember)}
	    />
-->
<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import Notice from './notice.svelte';

	let {
		open = $bindable(false),
		title,
		message,
		confirmLabel,
		cancelLabel = 'Cancel',
		destructive = false,
		rememberLabel,
		busy = false,
		error = null,
		onconfirm
	}: {
		open?: boolean;
		title: string;
		message: string;
		/** The action's own verb: "Delete set", never "OK". */
		confirmLabel: string;
		cancelLabel?: string;
		destructive?: boolean;
		/** Shows the "do not ask again" tick with this label. */
		rememberLabel?: string;
		busy?: boolean;
		/** Why the action failed, shown in the dialog. */
		error?: string | null;
		onconfirm: (choice: { remember: boolean }) => void;
	} = $props();

	let remember = $state(false);
	const rememberId = $props.id();

	// Each opening starts unticked.
	$effect(() => {
		if (open) remember = false;
	});
</script>

<AlertDialog.Root
	bind:open={
		() => open,
		(next) => {
			if (!busy) open = next;
		}
	}
>
	<AlertDialog.Content
		data-slot="confirm-dialog"
		escapeKeydownBehavior={busy ? 'ignore' : 'close'}
		interactOutsideBehavior="ignore"
	>
		<AlertDialog.Header>
			<AlertDialog.Title>{title}</AlertDialog.Title>
			<AlertDialog.Description class="break-words">{message}</AlertDialog.Description>
		</AlertDialog.Header>
		{#if error}<Notice tone="destructive">{error}</Notice>{/if}
		{#if rememberLabel}
			<div class="flex items-center gap-2">
				<Checkbox id={rememberId} bind:checked={remember} disabled={busy} />
				<Label for={rememberId} class="text-muted-foreground font-normal">{rememberLabel}</Label>
			</div>
		{/if}
		<AlertDialog.Footer>
			<Button variant="ghost" disabled={busy} onclick={() => (open = false)}>{cancelLabel}</Button>
			<Button variant={destructive ? 'destructive' : 'default'} disabled={busy} onclick={() => onconfirm({ remember })}>
				{confirmLabel}
			</Button>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
