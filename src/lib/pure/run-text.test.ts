import { describe, expect, it } from 'vitest';
import { INITIAL_RUN_STATE, type RowNote, type RunRow, type RunState } from './run';
import { noteParts, progressLabel, progressText, rowText, summaryText, summaryTone, visibilityNote, visibilityProgressText } from './run-text';

function row(more: Partial<RunRow> = {}): RunRow {
	return {
		entryId: 'lens',
		entityType: 'Version',
		programmaticName: 'sg_lens',
		displayName: 'Lens',
		dataType: 'text',
		class: 'create',
		state: 'failed',
		note: null,
		effects: [],
		visibility: null,
		...more
	};
}

function words(note: RowNote): string {
	return rowText(row({ note }));
}

function state(more: Partial<RunState>, states: RunRow['state'][] = []): RunState {
	return { ...INITIAL_RUN_STATE, rows: states.map((rowState, index) => row({ entryId: `e${index}`, state: rowState })), ...more };
}

describe('row notes (RUN-21)', () => {
	it('never carries HTML: a server message stays plain text in one text part', () => {
		const parts = noteParts(row(), { code: 'refused', action: 'create', status: 400, message: '<b>No</b> <a href="x">way</a>' });
		expect(parts).toEqual([
			{ kind: 'text', text: 'Install could not create "Lens" (Version.sg_lens). The site answered 400: <b>No</b> <a href="x">way</a>' }
		]);
	});

	it('RUN-27, finding 121: a refused update says the status and the message, and nothing of a half-written update', () => {
		expect(words({ code: 'refused', action: 'update', status: 400, message: 'No.' })).toBe(
			'Install could not update "Lens" (Version.sg_lens). The site answered 400: No.'
		);
	});

	it('RUN-10: gives the menu path when the site has no trash page', () => {
		expect(words({ code: 'retired-other-type', liveDataType: 'number', trashPageUrl: null, retired: true, retireError: null })).toBe(
			'The name Version.sg_lens is held by a retired Number field. The set wants Text for "Lens". A retired field comes back with the data type it had, so the API cannot reuse the name. Install put Version.sg_lens back in the trash. To free the name, delete it for good from the trash for fields. In Flow PT, open the admin menu, then Trash, then Fields. Then install again.'
		);
	});

	it('RUN-12: says when the field under the wrong name could not be deleted, or has no known name', () => {
		expect(words({ code: 'wrong-name', assigned: 'sg_lens_1', retired: false, retireError: 'No.' })).toBe(
			'The site named the new field Version.sg_lens_1. The set wants Version.sg_lens for "Lens". Install could not delete the new field: No. It is live on the site. Delete it in Flow PT.'
		);
		expect(words({ code: 'wrong-name', assigned: '', retired: false, retireError: null })).toContain('did not say under which name');
	});

	it('finding 121: names the valid types the site does not have', () => {
		expect(words({ code: 'unknown-valid-types', names: ['shot'] })).toBe(
			`"Lens" (Version.sg_lens) was not sent to the site. The valid type "shot" is not on this site. A type name must match the site's exactly, capitals included. Fix the field's valid types, or enable the entity in Flow PT's admin screens, then refresh.`
		);
	});

	it('words an unreadable field and a broken step', () => {
		expect(words({ code: 'unreadable', after: 'create', message: null })).toBe(
			'"Lens" (Version.sg_lens) was created, then could not be read. Check the field in Flow PT, then retry.'
		);
		expect(words({ code: 'error', message: 'Broken.' })).toBe('Install could not finish "Lens" (Version.sg_lens). Broken.');
	});

	it('says nothing for a row with no note and no visibility', () => {
		expect(rowText(row({ state: 'done' }))).toBe('');
		expect(visibilityNote(row())).toBeNull();
	});

	it('VIS-5: says nothing of visibility that changed nothing and failed nowhere', () => {
		const quiet = row({ visibility: { origin: 'existing', status: 'applied', done: 3, total: 3, written: 0, failures: [], error: null } });
		expect(visibilityNote(quiet)).toBeNull();
	});
});

describe('a row whose only work was visibility (RUN-7, VIS-5)', () => {
	const matching = (visibility: RunRow['visibility']) => row({ class: 'already-matches', state: 'skipped', note: { code: 'nothing-to-change' }, visibility });
	const applied: NonNullable<RunRow['visibility']> = { origin: 'existing', status: 'applied', done: 13, total: 13, written: 13, failures: [], error: null };

	it('says the field is unchanged and where it was made visible, not "nothing to change"', () => {
		expect(rowText(matching(applied))).toBe('Field unchanged. Made visible on 13 projects.');
		expect(rowText(matching({ ...applied, written: 1 }))).toBe('Field unchanged. Made visible on 1 project.');
	});

	it('still says "nothing to change" when visibility changed nothing either', () => {
		expect(rowText(matching({ ...applied, written: 0 }))).toBe('Nothing to change.');
		expect(rowText(matching(null))).toBe('Nothing to change.');
	});

	it('VIS-7: keeps what failed and what was cut short after it', () => {
		const failed = matching({ ...applied, written: 2, failures: [{ projectId: 71, projectName: 'Beta', message: 'Refused.' }] });
		expect(rowText(failed)).toBe('Field unchanged. Made visible on 2 projects. Visibility was not set on 1 project. Beta: Refused.');
		const none = matching({ ...applied, written: 0, failures: [{ projectId: 71, projectName: 'Beta', message: 'Refused.' }] });
		expect(rowText(none)).toBe('Field unchanged. Visibility was not set on 1 project. Beta: Refused.');
		const cut = matching({ ...applied, status: 'cancelled', done: 1, written: 1, total: 3 });
		expect(rowText(cut)).toBe('Field unchanged. Made visible on 1 project. Visibility was cancelled after 1 of 3 projects.');
	});

	it('leaves every other row\'s words as they were', () => {
		const updated = row({ class: 'update', state: 'done', note: null, visibility: applied });
		expect(rowText(updated)).toBe('Visibility changed on 13 projects.');
		expect(visibilityNote(matching(applied))?.text).toBe('Visibility changed on 13 projects.');
	});
});

describe('progress and summary (RUN-23, RUN-24)', () => {
	it('RUN-23: labels the counter', () => {
		expect(progressLabel(state({}))).toBeNull();
		expect(progressLabel(state({ status: 'running', phase: 'planning' }))).toBe('checking');
		expect(progressLabel(state({ status: 'running', phase: 'applying' }))).toBe('applying');
		expect(progressLabel(state({ status: 'finished' }))).toBe('done');
		expect(progressLabel(state({ status: 'cancelled' }))).toBe('cancelled');
		expect(progressText(state({ status: 'running' }, ['done', 'failed', 'in_progress', 'pending']))).toBe('2 of 4');
	});

	it('RUN-24: summarises applied and skipped, failed only when any', () => {
		expect(summaryText(state({ status: 'running' }, ['done']))).toBeNull();
		expect(summaryText(state({ status: 'finished' }, ['done', 'done', 'skipped']))).toBe('2 applied, 1 skipped.');
		expect(summaryText(state({ status: 'finished' }, ['done', 'skipped', 'failed']))).toBe('1 applied, 1 skipped, 1 failed.');
	});

	it('RUN-24: says the install was cancelled, or gives the run-level error', () => {
		expect(summaryText(state({ status: 'cancelled' }, ['done', 'pending']))).toBe('Install cancelled. 1 applied, 0 skipped, 1 not started.');
		expect(summaryText(state({ status: 'finished', error: 'Failed to fetch' }, ['failed', 'pending']))).toBe(
			'Install stopped. Failed to fetch 0 applied, 0 skipped, 1 failed, 1 not started.'
		);
	});
});

describe('summaryTone: how the closing notification reads (RUN-24, audit finding 6)', () => {
	const warned = { origin: 'existing' as const, status: 'applied' as const, done: 1, total: 2, written: 1, failures: [{ projectId: 71, projectName: 'Demo', message: 'No.' }], error: null };

	it('RUN-24: a failed row or a run-level error is an error', () => {
		expect(summaryTone(state({ status: 'finished' }, ['done', 'failed']))).toBe('error');
		expect(summaryTone(state({ status: 'finished', error: 'Failed to fetch' }, ['done']))).toBe('error');
		expect(summaryTone(state({ status: 'cancelled' }, ['failed', 'pending']))).toBe('error');
	});

	it('RUN-24, VIS-7: a cancel or a visibility warning is a warning', () => {
		expect(summaryTone(state({ status: 'cancelled' }, ['done', 'pending']))).toBe('warning');
		expect(summaryTone({ ...INITIAL_RUN_STATE, status: 'finished', rows: [row({ state: 'done', visibility: warned })] })).toBe('warning');
	});

	it('RUN-24: everything else is a success', () => {
		expect(summaryTone(state({ status: 'finished' }, ['done', 'skipped']))).toBe('success');
	});
});

describe('visibilityProgressText (RUN-22)', () => {
	it('RUN-22: names what the counter counts; nothing for a row with no visibility', () => {
		const visibility = { origin: 'new' as const, status: 'applying' as const, done: 1, total: 3, written: 1, failures: [], error: null };
		expect(visibilityProgressText(row({ visibility }))).toBe('Visibility 1 of 3 projects');
		expect(visibilityProgressText(row())).toBeNull();
	});
});
