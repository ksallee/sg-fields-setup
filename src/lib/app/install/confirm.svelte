<!--
	The confirmation before the first write (issue #18). It says what will be created and updated
	on which site, that a created field's name is taken for good, and the visibility scope. Every
	line is `install-text.confirmText`.
-->
<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { ConfirmText } from '$lib/pure/install-text';

	let { open = $bindable(false), text, onconfirm }: { open?: boolean; text: ConfirmText; onconfirm: () => void } = $props();
</script>

<AlertDialog.Root bind:open>
	<AlertDialog.Content data-slot="install-confirm" interactOutsideBehavior="ignore">
		<AlertDialog.Header>
			<AlertDialog.Title>{text.title}</AlertDialog.Title>
			<AlertDialog.Description class="sr-only">What this install writes to the site.</AlertDialog.Description>
		</AlertDialog.Header>
		<ul class="flex flex-col gap-2 text-sm">
			{#each text.lines as line (line)}
				<li class="break-words">{line}</li>
			{/each}
		</ul>
		<AlertDialog.Footer>
			<Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
			<Button
				onclick={() => {
					open = false;
					onconfirm();
				}}
				data-action="confirm-install">{text.confirmLabel}</Button
			>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
