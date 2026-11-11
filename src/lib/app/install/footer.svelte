<!--
	The install screen's footer (the table under RUN-5, RUN-23): the run's counter and label on the
	left, the actions on the right. Which action shows and which can be used is
	`install-footer.footerActions`; the label and the counter are `run-text`.

	The left side is the screen's one live region for a run, polite: its progress as it moves, then
	how it ended (`run-text.summaryText`, the closing toast's words, for a screen reader only). The
	rows are plain content, so twelve failures are not twelve interruptions.
-->
<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Progress } from '$lib/components/ui/progress/index.js';
	import type { Footer, FooterActionName } from '$lib/pure/install-footer';
	import { runCounters, type RunState } from '$lib/pure/run';
	import { progressLabel, progressText, summaryText } from '$lib/pure/run-text';

	let {
		footer,
		run,
		selected,
		closeHref,
		onaction
	}: {
		footer: Footer;
		run: RunState;
		/** "3 of 5 selected", shown before a run. */
		selected: string;
		closeHref: string;
		onaction: (name: Exclude<FooterActionName, 'close'>) => void;
	} = $props();

	const LABELS = { checking: 'Checking the live schema', applying: 'Applying', done: 'Done', cancelled: 'Cancelled' } as const;

	const label = $derived(progressLabel(run));
	const counters = $derived(runCounters(run));
	const result = $derived(summaryText(run));
	const variant = (name: FooterActionName) => (footer.primary === name ? 'default' : 'outline');
</script>

<footer class="border-border bg-background flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-t px-6 py-3" data-slot="install-footer">
	<div class="flex min-w-0 flex-1 basis-48 items-center gap-3 text-sm" role="status" aria-live="polite" data-slot="run-progress">
		{#if label}
			<span class="font-medium" data-slot="run-label">{run.cancelRequested ? 'Cancelling' : LABELS[label]}</span>
			{#if label !== 'checking'}
				<span class="text-muted-foreground tabular-nums" data-slot="run-counter">{progressText(run)}</span>
				<Progress value={counters.finished} max={Math.max(counters.total, 1)} class="max-w-40 min-w-16 flex-1" aria-label="Fields finished" />
			{/if}
			{#if result}<span class="sr-only" data-slot="run-result">{result}</span>{/if}
		{:else}
			<span class="text-muted-foreground tabular-nums">{selected}</span>
		{/if}
	</div>
	<div class="flex flex-wrap items-center gap-2" data-slot="install-actions">
		<Button variant="ghost" disabled={!footer.refresh.enabled} onclick={() => onaction('refresh')} data-action="refresh">
			<RefreshCw data-icon="inline-start" />{footer.refresh.label}
		</Button>
		{#if footer.report.visible}
			<Button variant="ghost" disabled={!footer.report.enabled} onclick={() => onaction('report')} data-action="report">
				<Download data-icon="inline-start" />{footer.report.label}
			</Button>
		{/if}
		<Button variant={variant('close')} href={footer.close.enabled ? closeHref : undefined} disabled={!footer.close.enabled} data-action="close">
			{footer.close.label}
		</Button>
		{#if footer.cancel.visible}
			<Button variant="outline" disabled={!footer.cancel.enabled} onclick={() => onaction('cancel')} data-action="cancel">{footer.cancel.label}</Button>
		{/if}
		{#if footer.retry.visible}
			<Button variant={variant('retry')} disabled={!footer.retry.enabled} onclick={() => onaction('retry')} data-action="retry">{footer.retry.label}</Button>
		{/if}
		{#if footer.resume.visible}
			<Button variant={variant('resume')} disabled={!footer.resume.enabled} onclick={() => onaction('resume')} data-action="resume">
				{footer.resume.label}
			</Button>
		{/if}
		{#if footer.apply.visible}
			<Button variant={variant('apply')} disabled={!footer.apply.enabled} onclick={() => onaction('apply')} data-action="apply">{footer.apply.label}</Button>
		{/if}
	</div>
</footer>
