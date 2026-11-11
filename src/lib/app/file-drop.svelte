<!--
	A place to drop files, with a button that opens the file picker. Generic: it hands over the
	`File`s and judges nothing.

	The button is the keyboard's way in; the zone itself is not focusable. While files are dragged
	over it the zone is marked (`data-dragging`). A file dropped beside the zone is swallowed, so
	the browser does not open it in place of the app. With `anywhere`, a file dropped beside the
	zone is taken too, and the zone is marked while files are over the window.

	    <FileDrop accept=".csv,.xlsx" title="Drop CSV or XLSX files here" onfiles={add} />
-->
<script lang="ts">
	import Upload from '@lucide/svelte/icons/upload';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	let {
		onfiles,
		title,
		hint,
		accept,
		multiple = true,
		disabled = false,
		busy = false,
		compact = false,
		anywhere = false,
		browseLabel = 'Browse files',
		class: className,
		...rest
	}: {
		onfiles: (files: File[]) => void;
		/** What to drop, in a few words. */
		title: string;
		/** One quiet line under the title. Left out when compact. */
		hint?: string;
		/** The file picker's filter. A drop is not filtered. */
		accept?: string;
		multiple?: boolean;
		disabled?: boolean;
		/** Files are being read. */
		busy?: boolean;
		/** One line, for a zone that has already been used. */
		compact?: boolean;
		/** The whole window takes the drop. For a dialog, where a miss beside the zone is still meant for it. */
		anywhere?: boolean;
		browseLabel?: string;
		class?: string;
		[key: `data-${string}`]: string | undefined;
	} = $props();

	let input = $state<HTMLInputElement | null>(null);
	/** Enter and leave fire for every child crossed: the zone is left when the count is back to zero. */
	let depth = $state(0);
	const dragging = $derived(depth > 0 && !disabled);

	function carriesFiles(event: DragEvent): boolean {
		return event.dataTransfer?.types.includes('Files') ?? false;
	}

	function enter(event: DragEvent): void {
		if (!carriesFiles(event)) return;
		event.preventDefault();
		// With `anywhere` the window counts, and this one reaches it too.
		if (!anywhere) depth += 1;
	}

	function leave(event: DragEvent): void {
		if (!carriesFiles(event)) return;
		if (!anywhere) depth = Math.max(0, depth - 1);
	}

	function over(event: DragEvent): void {
		if (!carriesFiles(event)) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
	}

	function drop(event: DragEvent): void {
		if (!carriesFiles(event)) return;
		event.preventDefault();
		event.stopPropagation();
		depth = 0;
		take(event);
	}

	function take(event: DragEvent): void {
		if (disabled) return;
		const files = [...(event.dataTransfer?.files ?? [])];
		if (files.length > 0) onfiles(multiple ? files : files.slice(0, 1));
	}

	function picked(): void {
		const files = [...(input?.files ?? [])];
		// Emptied, so picking the same file again is a change.
		if (input) input.value = '';
		if (files.length > 0) onfiles(files);
	}

	/** A miss beside the zone must not navigate away from the app. With `anywhere` it is no miss. */
	function beside(event: DragEvent): void {
		if (!carriesFiles(event)) return;
		event.preventDefault();
		const taken = anywhere && !disabled;
		if (event.type === 'dragover' && event.dataTransfer) event.dataTransfer.dropEffect = taken ? 'copy' : 'none';
		if (event.type !== 'drop') return;
		depth = 0;
		if (taken) take(event);
	}

	function windowEnter(event: DragEvent): void {
		if (anywhere && carriesFiles(event)) depth += 1;
	}

	function windowLeave(event: DragEvent): void {
		if (anywhere && carriesFiles(event)) depth = Math.max(0, depth - 1);
	}
</script>

<svelte:window ondragenter={windowEnter} ondragleave={windowLeave} ondragover={beside} ondrop={beside} />

<div
	role="group"
	aria-label={title}
	aria-busy={busy}
	data-slot="file-drop"
	data-dragging={dragging ? '' : undefined}
	data-compact={compact ? '' : undefined}
	class={cn(
		'border-input text-muted-foreground flex items-center rounded-lg border border-dashed transition-colors',
		'data-dragging:border-ring data-dragging:bg-muted data-dragging:text-foreground',
		compact ? 'gap-2 py-1.5 pr-1.5 pl-3' : 'flex-col gap-3 px-4 py-6 text-center',
		disabled && 'opacity-60',
		className
	)}
	ondragenter={enter}
	ondragleave={leave}
	ondragover={over}
	ondrop={drop}
	{...rest}
>
	<Upload class="size-4 shrink-0" aria-hidden="true" />
	<div class={cn('min-w-0', compact ? 'flex-1' : 'flex flex-col gap-1')}>
		<p class={cn('truncate text-sm', !compact && 'text-foreground font-medium')}>{busy ? 'Reading…' : title}</p>
		{#if hint && !compact}<p class="text-xs">{hint}</p>{/if}
	</div>
	<Button variant="outline" size={compact ? 'sm' : 'default'} {disabled} onclick={() => input?.click()} data-slot="file-drop-browse">
		{browseLabel}
	</Button>
	<input bind:this={input} type="file" class="sr-only" tabindex="-1" aria-hidden="true" {accept} {multiple} {disabled} onchange={picked} />
</div>
