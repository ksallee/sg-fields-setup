/**
 * The words of an install run (RUN-21 to RUN-24, VIS-5, VIS-7): each row's reason or error, its
 * visibility line, the counter's label and the closing summary.
 *
 * Everything a row says comes out as `ReasonPart`s: plain text and links, never HTML. The screen
 * renders a link itself, opening in a new tab. A server's message is carried as plain text.
 *
 * Every reason names the field by display and programmatic name, the setting, the live and the
 * wanted value, and the manual fix (RUN-21). Whatever needs the trash links to the site's trash
 * page for fields.
 */
import { dataTypeLabel } from './data-types';
import type { Difference } from './plan-diff';
import { formatValue, reasonParts, settingLabel, trashParts, type PlanReason, type ReasonPart } from './plan-reason';
import { needsVisibilityRetry, runCounters, type Retrash, type RowNote, type RunAction, type RunRow, type RunState, type WriteKind } from './run';

type Named = Pick<RunRow, 'entityType' | 'programmaticName' | 'displayName' | 'dataType'>;

function text(value: string): ReasonPart[] {
	return [{ kind: 'text', text: value }];
}

/** Joins runs of parts with a space between them and merges adjacent text. */
function sentence(...runs: ReasonPart[][]): ReasonPart[] {
	const merged: ReasonPart[] = [];
	const filled = runs.filter((run) => run.length > 0);
	filled.forEach((run, index) => {
		const parts = index === 0 ? run : [{ kind: 'text', text: ' ' } as ReasonPart, ...run];
		for (const part of parts) {
			const last = merged.at(-1);
			if (part.kind === 'text' && last?.kind === 'text') last.text += part.text;
			else merged.push({ ...part });
		}
	});
	return merged;
}

function fieldLabel(row: Named): string {
	return `"${row.displayName}" (${row.entityType}.${row.programmaticName})`;
}

function count(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}

function show(setting: Difference['setting'], value: unknown): string {
	if (setting === 'unique') return value === true ? 'on' : 'off';
	return formatValue(value);
}

/** "description: "old" on the site, "new" in the set." for each difference. */
function differenceLines(differences: readonly Difference[]): string {
	return differences
		.map((difference) => {
			const label = settingLabel(difference.setting);
			return `${label[0].toUpperCase()}${label.slice(1)}: ${show(difference.setting, difference.live)} on the site, ${show(difference.setting, difference.wanted)} in the set.`;
		})
		.join(' ');
}

const AFTER: Readonly<Record<WriteKind, string>> = {
	create: 'was created',
	revive: 'was restored from the trash',
	update: 'was updated'
};

const VERBS: Readonly<Record<RunAction, string>> = {
	read: 'read',
	create: 'create',
	update: 'update',
	revive: 'restore',
	retire: 'delete'
};

/** What became of a field the run put back in the trash, and where to free its name. */
function retrashParts(row: Named, name: string, back: Retrash, trashPageUrl: string | null): ReasonPart[] {
	const field = `${row.entityType}.${name}`;
	if (back.retired) {
		return sentence(text(`Install put ${field} back in the trash. To free the name, delete it for good from`), trashParts(trashPageUrl), text('Then install again.'));
	}
	return sentence(
		text(
			`Install could not put ${field} back in the trash${back.retireError ? `: ${back.retireError}` : '.'} It is live on the site now. Delete it in FPT, then delete it for good from`
		),
		trashParts(trashPageUrl),
		text('Then install again.')
	);
}

function blockedLine(reason: PlanReason): string {
	if (reason.setting === null) return '';
	const label = settingLabel(reason.setting);
	return `${label[0].toUpperCase()}${label.slice(1)}: ${show(reason.setting, reason.live)} on the retired field, ${show(reason.setting, reason.wanted)} in the set.`;
}

/** A row's reason or error as text and link parts. Empty when the row has none. */
export function noteParts(row: Named, note: RowNote | null): ReasonPart[] {
	if (note === null) return [];
	const field = fieldLabel(row);
	switch (note.code) {
		case 'plan':
			return sentence(...note.reasons.map((reason) => reasonParts(reason)));
		case 'nothing-to-change':
			return text('Nothing to change.');
		case 'already-exists': {
			const lead = `${field} already exists on the site. Install did not create it.`;
			if (note.differences.length === 0) return text(lead);
			return text(
				`${lead} ${count(note.differences.length, 'setting differs', 'settings differ')} from the set and ${note.differences.length === 1 ? 'was' : 'were'} left as on the site. ${differenceLines(note.differences)} Refresh to plan an update.`
			);
		}
		case 'unknown-valid-types': {
			const names = note.names.map((name) => `"${name}"`).join(', ');
			return text(
				`${field} was not sent to the site. ${note.names.length === 1 ? `The valid type ${names} is` : `The valid types ${names} are`} not on this site. A type name must match the site's exactly, capitals included. Fix the entry's valid types, or enable the entity in FPT's admin screens, then refresh.`
			);
		}
		case 'gone':
			return text(`${field} is no longer on the site. It was there when the plan was made. Refresh to plan it again.`);
		case 'not-applied':
			return text(
				`${field} ${AFTER[note.after]}. The site answered success and the field does not read back as wanted. ${differenceLines(note.differences)} Check the field in FPT, then retry.`
			);
		case 'unreadable':
			return text(
				`${field} ${AFTER[note.after]}, then could not be read${note.message ? `: ${note.message}` : '.'} Check the field in FPT, then retry.`
			);
		case 'refused': {
			const said = note.status === null ? `No answer came: ${note.message}` : `The site answered ${note.status}: ${note.message}`;
			return text(`Install could not ${VERBS[note.action]} ${field}. ${said}`);
		}
		case 'retired-other-type':
			return sentence(
				text(
					`The name ${row.entityType}.${row.programmaticName} is held by a retired ${dataTypeLabel(note.liveDataType)} field. The set wants ${dataTypeLabel(row.dataType)} for "${row.displayName}". A retired field comes back with the data type it had, so the API cannot reuse the name.`
				),
				retrashParts(row, row.programmaticName, note, note.trashPageUrl)
			);
		case 'retired-blocked':
			return sentence(
				text(
					`The name ${row.entityType}.${row.programmaticName} is held by a retired field that the API cannot make match "${row.displayName}". ${note.reasons.map(blockedLine).filter((line) => line !== '').join(' ')}`.trimEnd()
				),
				retrashParts(row, row.programmaticName, note, note.trashPageUrl)
			);
		case 'name-retired':
			return sentence(
				text(
					`The site refused to create ${field}. A retired field holds the name ${row.entityType}.${note.name}. To free the name, delete that field for good from`
				),
				trashParts(note.trashPageUrl),
				text('Then install again.')
			);
		case 'wrong-name': {
			if (note.assigned === '') {
				return text(
					`The site created a field for ${field} and did not say under which name. Install left it. Find it in FPT's field list for ${row.entityType} and check its name.`
				);
			}
			const lead = `The site named the new field ${row.entityType}.${note.assigned}. The set wants ${row.entityType}.${row.programmaticName} for "${row.displayName}".`;
			if (note.retired) return text(`${lead} Install deleted the new field. The name ${note.assigned} is spent on this site.`);
			return text(
				`${lead} Install could not delete the new field${note.retireError ? `: ${note.retireError}` : '.'} It is live on the site. Delete it in FPT.`
			);
		}
		case 'error':
			return text(`Install could not finish ${field}. ${note.message}`);
	}
}

/** "3 of 12 projects" while a row's visibility is being applied (RUN-22). Null otherwise. */
export function visibilityProgress(row: Pick<RunRow, 'visibility'>): string | null {
	const visibility = row.visibility;
	if (!visibility || visibility.status !== 'applying') return null;
	return `${visibility.done} of ${count(visibility.total, 'project', 'projects')}`;
}

/**
 * What a row says about visibility once it has run, or null when there is nothing to say: none
 * was applied, it is still running, or it changed nothing and nothing failed.
 *
 * `warning` is true when a retry of the row's visibility is worth offering (VIS-7).
 */
export function visibilityNote(row: Pick<RunRow, 'visibility'>): { warning: boolean; text: string } | null {
	const visibility = row.visibility;
	if (!visibility || visibility.status === 'applying') return null;
	const lines: string[] = [];
	if (visibility.written > 0) lines.push(`Visibility changed on ${count(visibility.written, 'project', 'projects')}.`);
	if (visibility.status === 'cancelled') {
		lines.push(
			visibility.total === 0
				? 'Visibility was not applied. The install was cancelled first.'
				: `Visibility was cancelled after ${visibility.done} of ${count(visibility.total, 'project', 'projects')}.`
		);
	}
	if (visibility.error !== null) lines.push(`Visibility could not be applied. ${visibility.error}`);
	if (visibility.failures.length > 0) {
		lines.push(`Visibility was not set on ${count(visibility.failures.length, 'project', 'projects')}.`);
		for (const failure of visibility.failures) lines.push(`${failure.projectName}: ${failure.message}`);
	}
	if (lines.length === 0) return null;
	return { warning: needsVisibilityRetry(row as RunRow), text: lines.join(' ') };
}

/**
 * Everything a finished row says, in reading order: its reason or error, then its visibility
 * line. An "already matches" row whose visibility changed something says both: "Nothing to
 * change. Visibility changed on 3 projects." (VIS-5).
 */
export function rowParts(row: RunRow): ReasonPart[] {
	const visibility = visibilityNote(row);
	return sentence(noteParts(row, row.note), visibility ? text(visibility.text) : []);
}

/** The row's words as one plain text. A link reads as its text followed by its address in brackets. */
export function rowText(row: RunRow): string {
	return rowParts(row)
		.map((part) => (part.kind === 'link' ? `${part.text} (${part.href})` : part.text))
		.join('');
}

/** The label beside the overall counter (RUN-23). `checking` is the re-plan before the first item. */
export function progressLabel(state: RunState): 'checking' | 'applying' | 'done' | 'cancelled' | null {
	switch (state.status) {
		case 'idle':
			return null;
		case 'running':
			return state.phase === 'planning' ? 'checking' : 'applying';
		case 'finished':
			return 'done';
		case 'cancelled':
			return 'cancelled';
	}
}

/** "3 of 12": finished items out of the total (RUN-23). */
export function progressText(state: RunState): string {
	const counters = runCounters(state);
	return `${counters.finished} of ${counters.total}`;
}

/**
 * The closing notification (RUN-24): the run-level error, or that the install was cancelled, or
 * "N applied, N skipped", with "N failed" when any did. Null while the run is idle or running.
 */
export function summaryText(state: RunState): string | null {
	if (state.status === 'idle' || state.status === 'running') return null;
	const counters = runCounters(state);
	const parts = [`${counters.done} applied`, `${counters.skipped} skipped`];
	if (counters.failed > 0) parts.push(`${counters.failed} failed`);
	if (counters.pending > 0) parts.push(`${counters.pending} not started`);
	const counts = `${parts.join(', ')}.`;
	const warnings =
		counters.visibilityWarnings > 0 ? ` Visibility is incomplete on ${count(counters.visibilityWarnings, 'field', 'fields')}.` : '';
	if (state.error !== null) return `Install stopped. ${state.error} ${counts}${warnings}`;
	if (state.status === 'cancelled') return `Install cancelled. ${counts}${warnings}`;
	return `${counts[0].toUpperCase()}${counts.slice(1)}${warnings}`;
}
