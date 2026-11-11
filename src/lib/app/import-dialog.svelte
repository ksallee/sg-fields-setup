<!--
	The spreadsheet import (specs/04-import.md). A stub: issue #16 fills this file in.

	The contract with the set list, which is all #16 has to keep: `open` is bound by the list's
	header action and its empty state; `oncreated` is called with the id of the set the import
	stored, after the dialog has closed. The list then opens the editor on it.
-->
<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';

	let {
		open = $bindable(false),
		oncreated
	}: { open?: boolean; oncreated?: (setId: string) => void } = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content data-slot="import-dialog">
		<Dialog.Header>
			<Dialog.Title>Import a spreadsheet</Dialog.Title>
			<Dialog.Description>
				Importing a CSV or XLSX file is not built yet. Until then, create a set by hand or import a set file.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Close</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
