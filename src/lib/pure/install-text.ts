/**
 * The install screen's own words (RUN-5, PLN-1, RUN-20): the summary's counts, the confirmation
 * before the first write, and a few small lines. Pure. The words of a row are in `install-view`,
 * of a run in `run-text`, of visibility in `visibility-text` and `visibility-scope`.
 */
import type { PlanClass } from './plan';
import { runCounters, type RunCounters, type RunState } from './run';
import { fileSlug } from './set-file';
import { countText, fieldCount } from './set-text';
import { siteHost } from './site-host';

/** A plan row as the summary needs it. */
export interface SummaryRow {
	class: PlanClass;
	ticked: boolean;
	reverseFieldTypes: readonly string[];
}

export interface InstallSummary {
	/** Ticked create rows. */
	creates: number;
	/** Ticked update rows. */
	updates: number;
	/** Ticked already-matches rows. */
	alreadyMatching: number;
	/** Every type conflict and refusal. */
	conflicts: number;
	/** Every blocked row. */
	blocked: number;
	/** Reverse fields the ticked rows make on other entity types (corpus finding 121). */
	reverseFields: number;
}

/** The counts of the summary (RUN-5): the selected creates, updates and already-matching rows; every conflict and blocked row. */
export function installSummary(rows: readonly SummaryRow[]): InstallSummary {
	const ticked = (planClass: PlanClass) => rows.filter((row) => row.ticked && row.class === planClass);
	const all = (...classes: PlanClass[]) => rows.filter((row) => classes.includes(row.class)).length;
	const writes = [...ticked('create'), ...ticked('update')];
	return {
		creates: ticked('create').length,
		updates: ticked('update').length,
		alreadyMatching: ticked('already-matches').length,
		conflicts: all('type-conflict', 'refused'),
		blocked: all('blocked'),
		reverseFields: writes.reduce((sum, row) => sum + row.reverseFieldTypes.length, 0)
	};
}

export interface SummaryItem {
	/** The first five are the plan's. The last four are a run's. */
	key: 'creates' | 'updates' | 'alreadyMatching' | 'conflicts' | 'blocked' | 'applied' | 'skipped' | 'failed' | 'notStarted';
	count: number;
	/** "2 to create". */
	text: string;
	/** True for the rows an install skips. */
	skipped: boolean;
}

export function summaryItems(summary: InstallSummary): SummaryItem[] {
	return [
		{ key: 'creates', count: summary.creates, text: `${summary.creates} to create`, skipped: false },
		{ key: 'updates', count: summary.updates, text: `${summary.updates} to update`, skipped: false },
		{ key: 'alreadyMatching', count: summary.alreadyMatching, text: `${summary.alreadyMatching} already matching`, skipped: false },
		{ key: 'conflicts', count: summary.conflicts, text: countText(summary.conflicts, 'conflict'), skipped: true },
		{ key: 'blocked', count: summary.blocked, text: `${summary.blocked} blocked`, skipped: true }
	];
}

/**
 * What a run did, in the words of its closing toast (RUN-24, `run-text.summaryText`): applied,
 * skipped, failed, and what was not started while any is left.
 */
export function runSummaryItems(counters: Pick<RunCounters, 'done' | 'skipped' | 'failed' | 'pending'>): SummaryItem[] {
	const items: SummaryItem[] = [
		{ key: 'applied', count: counters.done, text: `${counters.done} applied`, skipped: false },
		{ key: 'skipped', count: counters.skipped, text: `${counters.skipped} skipped`, skipped: true },
		{ key: 'failed', count: counters.failed, text: `${counters.failed} failed`, skipped: false }
	];
	if (counters.pending > 0) items.push({ key: 'notStarted', count: counters.pending, text: `${counters.pending} not started`, skipped: false });
	return items;
}

/**
 * The summary line at the top of the install screen (RUN-5). Before a run it counts the plan:
 * what Install would do. Once a run exists those counts describe what a retry would do, which is
 * not what the person wants to read there. So from the first step of a run until Refresh it
 * counts the run: what Install did.
 */
export function screenSummary(plan: InstallSummary, run: RunState): SummaryItem[] {
	return run.status === 'idle' ? summaryItems(plan) : runSummaryItems(runCounters(run));
}

export interface ConfirmInput {
	summary: InstallSummary;
	siteUrl: string;
	/** `scopeSummary(resolved)`. */
	scope: string;
	/** `visibilityCount(...).text`. */
	visibility: string;
}

export interface ConfirmText {
	title: string;
	lines: string[];
	confirmLabel: string;
}

/**
 * The confirmation before the first write. It says what will be created and updated on which
 * site, that a created field's name is taken for good, and the visibility scope.
 */
export function confirmText(input: ConfirmInput): ConfirmText {
	const { creates, updates, alreadyMatching, reverseFields } = input.summary;
	const does: string[] = [];
	if (creates > 0) does.push(`creates ${fieldCount(creates)}`);
	if (updates > 0) does.push(`updates ${fieldCount(updates)}`);
	const lines = [`This ${does.length > 0 ? does.join(' and ') : 'creates and updates no field'} on ${input.siteUrl}.`];
	if (creates > 0) {
		lines.push('A created field takes its name for good. Deleting the field later does not free the name.');
		// Finding 115: why a create adds no visibility to the count below.
		lines.push('A created field starts visible on every project.');
	}
	if (reverseFields === 1) lines.push('1 reverse field is made on the linked entity type. It takes a name there for good.');
	else if (reverseFields > 1) lines.push(`${reverseFields} reverse fields are made on the linked entity types. Each takes a name there for good.`);
	if (alreadyMatching === 1) lines.push('1 field already matches and gets visibility only.');
	else if (alreadyMatching > 1) lines.push(`${alreadyMatching} fields already match and get visibility only.`);
	lines.push(`Visibility: ${input.scope}. ${input.visibility}.`, 'There is no undo.');
	return {
		title: `Install on ${siteHost(input.siteUrl)}?`,
		lines,
		confirmLabel: `Install ${fieldCount(creates + updates + alreadyMatching)}`
	};
}

/** The line under the page title: what the plan is of, and the site (PLN-1). */
export function planContext(input: { whole: boolean; entries: number; siteUrl: string }): string {
	const what = input.whole ? fieldCount(input.entries) : countText(input.entries, 'selected field');
	const host = siteHost(input.siteUrl);
	return host === '' ? what : `${what} · ${host}`;
}

/** Said before leaving the page while a run is in progress, under "Leave the install?". */
export function leaveQuestion(): string {
	return 'An install is running. If you leave now it stops after the step in flight and the rest is not applied.';
}

/**
 * The file name of a run's report: the set, as its own file names it (`fileSlug`, any script),
 * and the day. `at` is an ISO time; pure code never reads the clock.
 */
export function reportFileName(setName: string, at: string): string {
	return ['install-report', fileSlug(setName), at.slice(0, 10)].filter((part) => part !== '').join('-') + '.txt';
}
