<!--
	One row of the install plan (RUN-3, RUN-4, RUN-22, VIS-7, VIS-9): the checkbox, the field, its
	differences or its reason, its visibility counters, and what a run did to it. Everything it
	shows is worked out in `$lib/pure` (`install-view`, `run-text`, `visibility-text`).
-->
<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Circle from '@lucide/svelte/icons/circle';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Minus from '@lucide/svelte/icons/minus';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import X from '@lucide/svelte/icons/x';
	import type { Component } from 'svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { rowStatus, statusLabel, type RowStatus, type ViewRow } from '$lib/pure/install-view';
	import { needsVisibilityRetry, type RunState } from '$lib/pure/run';
	import { rowParts, visibilityProgress } from '$lib/pure/run-text';
	import type { VisibilityCounter } from '$lib/pure/visibility-text';
	import { cn } from '$lib/utils.js';
	import Parts from './parts.svelte';
	import VisibilityCounters from './visibility-counters.svelte';

	let {
		row,
		run,
		ticked,
		disabled,
		locked,
		counters,
		ontoggle,
		onretryvisibility
	}: {
		row: ViewRow;
		run: RunState;
		ticked: boolean;
		/** Nothing left to do: unticked and disabled (RUN-4). */
		disabled: boolean;
		/** A run started: no tick can change (RUN-25). */
		locked: boolean;
		counters: readonly VisibilityCounter[];
		ontoggle: () => void;
		onretryvisibility: () => void;
	} = $props();

	const STATUS: Record<RowStatus, { icon: Component; tone: string; spin?: boolean }> = {
		pending: { icon: Circle, tone: 'text-muted-foreground' },
		in_progress: { icon: LoaderCircle, tone: 'text-info', spin: true },
		done: { icon: Check, tone: 'text-success' },
		skipped: { icon: Minus, tone: 'text-muted-foreground' },
		failed: { icon: X, tone: 'text-destructive' },
		'not-selected': { icon: Minus, tone: 'text-muted-foreground/70' }
	};

	const status = $derived(rowStatus(row, run));
	const badge = $derived(status ? STATUS[status] : null);
	const progress = $derived(row.run ? visibilityProgress(row.run) : null);
	// What the run says once the row has ended; until then the plan's own reasons.
	const ended = $derived(row.run !== null && row.run.state !== 'pending' && row.run.state !== 'in_progress');
	const said = $derived(row.run && ended ? rowParts(row.run) : []);
	const warning = $derived(row.run !== null && ended && needsVisibilityRetry(row.run));
	const checkId = $props.id();
</script>

<li
	class={cn('border-border flex gap-3 border-b px-2 py-2 last:border-b-0', status === 'not-selected' && 'opacity-60')}
	data-slot="plan-row"
	data-entry={row.entryId}
	data-class={row.class}
	data-status={status ?? 'planned'}
>
	<div class="flex h-5 w-4 shrink-0 items-center">
		{#if row.selectable}
			<Checkbox
				id={checkId}
				bind:checked={() => ticked, () => ontoggle()}
				disabled={locked || disabled}
				aria-label={`Install ${row.displayName}`}
				title={disabled && !locked ? 'Nothing left to do. It matches, and it is visible on every project in scope.' : undefined}
			/>
		{/if}
	</div>
	<div class="flex min-w-0 flex-1 flex-col gap-1">
		<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
			<div class="flex min-w-0 flex-1 basis-56 flex-col">
				<p class="flex min-w-0 items-baseline gap-2">
					<span class="truncate text-sm font-medium" title={row.displayName}>{row.displayName}</span>
					<span class="text-muted-foreground truncate font-mono text-xs" title={row.programmaticName}>{row.programmaticName}</span>
				</p>
				<p class="text-muted-foreground truncate text-xs" title={`${row.entityTypeLabel} · ${row.dataTypeLabel}`}>
					{row.entityTypeLabel} · {row.dataTypeLabel}
				</p>
			</div>
			<div class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
				<VisibilityCounters {counters} />
				{#if progress}<span class="text-muted-foreground text-xs tabular-nums" data-slot="visibility-progress">Visibility {progress}</span>{/if}
				{#if status && badge}
					<Badge variant="outline" class={badge.tone} data-slot="row-status">
						<badge.icon class={cn(badge.spin && 'motion-safe:animate-spin')} aria-hidden="true" />{statusLabel(status)}
					</Badge>
				{/if}
			</div>
		</div>

		{#if row.conflict}<p class="text-xs" data-slot="row-conflict">{row.conflict}</p>{/if}
		{#if row.differences.length > 0 || row.blocked.length > 0}
			<ul class="flex flex-col gap-0.5 text-xs" data-slot="row-differences">
				{#each [...row.blocked, ...row.differences] as line (line.setting)}
					<li class="break-words">
						<span class="text-muted-foreground">{line.label}:</span>
						<span class="font-mono">{line.live}</span>
						<span class="text-muted-foreground" aria-label="becomes">→</span>
						<span class="font-mono">{line.wanted}</span>
					</li>
				{/each}
			</ul>
		{/if}
		{#if row.reverseFields}<p class="text-muted-foreground text-xs" data-slot="row-reverse">{row.reverseFields}</p>{/if}

		{#if ended && said.length > 0}
			<p
				class={cn('flex gap-1.5 text-xs break-words', row.run?.state === 'failed' ? 'text-destructive' : 'text-muted-foreground')}
				role={row.run?.state === 'failed' ? 'alert' : undefined}
				data-slot="row-said"
			>
				{#if warning}<TriangleAlert class="text-warning mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{/if}
				<span class="min-w-0"><Parts parts={said} /></span>
			</p>
			{#if warning}
				<div>
					<Button variant="outline" size="xs" disabled={run.status === 'running'} onclick={onretryvisibility} data-slot="retry-visibility">
						Retry visibility
					</Button>
				</div>
			{/if}
		{:else}
			{#each row.reasons as reason, index (index)}
				<p class="text-muted-foreground text-xs break-words" data-slot="row-reason"><Parts parts={reason} /></p>
			{/each}
		{/if}
	</div>
</li>
