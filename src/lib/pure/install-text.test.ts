import { describe, expect, it } from 'vitest';
import { setFileName } from './set-file';
import {
	confirmText,
	disconnectedLine,
	installSummary,
	installTitle,
	leaveQuestion,
	planContext,
	planFailedLine,
	planLoadingLine,
	reportFileName,
	screenSummary,
	summaryItems
} from './install-text';
import { INITIAL_RUN_STATE, type RowState, type RunState } from './run';

const ROWS = [
	{ class: 'create', ticked: true, reverseFieldTypes: ['Shot', 'Asset'] },
	{ class: 'create', ticked: true, reverseFieldTypes: [] },
	{ class: 'create', ticked: false, reverseFieldTypes: ['Task'] },
	{ class: 'update', ticked: true, reverseFieldTypes: ['Sequence'] },
	{ class: 'already-matches', ticked: true, reverseFieldTypes: [] },
	{ class: 'already-matches', ticked: false, reverseFieldTypes: [] },
	{ class: 'type-conflict', ticked: false, reverseFieldTypes: [] },
	{ class: 'refused', ticked: false, reverseFieldTypes: [] },
	{ class: 'blocked', ticked: false, reverseFieldTypes: [] }
] as const;

describe('the summary (RUN-5)', () => {
	it('counts the selected creates, updates and already-matching rows, and every conflict and blocked row', () => {
		expect(installSummary(ROWS)).toEqual({ creates: 2, updates: 1, alreadyMatching: 1, conflicts: 2, blocked: 1, reverseFields: 3 });
	});

	it('words each count, the refusals counted with the conflicts', () => {
		expect(summaryItems(installSummary(ROWS)).map((item) => item.text)).toEqual([
			'2 to create',
			'1 to update',
			'1 already matching',
			'2 conflicts',
			'1 blocked'
		]);
		expect(summaryItems(installSummary([])).map((item) => item.text)).toEqual(['0 to create', '0 to update', '0 already matching', '0 conflicts', '0 blocked']);
		expect(summaryItems(installSummary([ROWS[6]])).at(3)).toEqual({ key: 'conflicts', count: 1, text: '1 conflict', skipped: true });
	});
});

describe('the confirmation before the first write', () => {
	const input = {
		summary: installSummary(ROWS),
		siteUrl: 'https://example.shotgrid.autodesk.com',
		scope: 'All eligible projects (12)',
		visibility: 'Up to 36 visibility changes'
	};

	it('says plainly what is created and updated, on which site, that a name is taken for good, and the scope', () => {
		expect(confirmText(input)).toEqual({
			title: 'Install on example.shotgrid.autodesk.com?',
			lines: [
				'This creates 2 fields and updates 1 field on https://example.shotgrid.autodesk.com.',
				'A created field takes its name for good. Deleting the field later does not free the name.',
				'A created field starts visible on every project.',
				'3 reverse fields are made on the linked entity types. Each takes a name there for good.',
				'1 field already matches and gets visibility only.',
				'Visibility: All eligible projects (12). Up to 36 visibility changes.',
				'There is no undo.'
			],
			confirmLabel: 'Install 4 fields'
		});
	});

	it('leaves out what does not apply', () => {
		const updates = confirmText({ ...input, summary: { creates: 0, updates: 2, alreadyMatching: 0, conflicts: 0, blocked: 0, reverseFields: 0 } });
		expect(updates.lines).toEqual([
			'This updates 2 fields on https://example.shotgrid.autodesk.com.',
			'Visibility: All eligible projects (12). Up to 36 visibility changes.',
			'There is no undo.'
		]);
		const creates = confirmText({ ...input, summary: { creates: 1, updates: 0, alreadyMatching: 0, conflicts: 0, blocked: 0, reverseFields: 1 } });
		expect(creates.lines.slice(0, 4)).toEqual([
			'This creates 1 field on https://example.shotgrid.autodesk.com.',
			'A created field takes its name for good. Deleting the field later does not free the name.',
			'A created field starts visible on every project.',
			'1 reverse field is made on the linked entity type. It takes a name there for good.'
		]);
		expect(creates.confirmLabel).toBe('Install 1 field');
	});

	it('says so when only visibility is applied', () => {
		const only = confirmText({ ...input, summary: { creates: 0, updates: 0, alreadyMatching: 3, conflicts: 0, blocked: 0, reverseFields: 0 } });
		expect(only.lines[0]).toBe('This creates and updates no field on https://example.shotgrid.autodesk.com.');
		expect(only.lines[1]).toBe('3 fields already match and get visibility only.');
	});

	it('names a site it cannot parse as it is', () => {
		expect(confirmText({ ...input, siteUrl: 'not a url' }).title).toBe('Install on not a url?');
	});
});

describe('the summary once there is a run (RUN-5, RUN-24)', () => {
	const plan = installSummary(ROWS);
	const run = (status: RunState['status'], states: RowState[]): RunState => ({
		...INITIAL_RUN_STATE,
		status,
		rows: states.map((state, index) => ({ entryId: `e${index}`, entityType: 'Shot', programmaticName: `sg_${index}`, displayName: `F${index}`, dataType: 'text', class: 'create', state, note: null, effects: [], visibility: null }))
	});

	it('shows the plan\'s counts until a run starts', () => {
		expect(screenSummary(plan, INITIAL_RUN_STATE)).toEqual(summaryItems(plan));
	});

	it('shows what the run did once it has ended, in the words of the closing toast', () => {
		expect(screenSummary(plan, run('finished', ['done', 'done', 'skipped'])).map((item) => [item.key, item.count, item.text])).toEqual([
			['applied', 2, '2 applied'],
			['skipped', 1, '1 skipped'],
			['failed', 0, '0 failed']
		]);
	});

	it('counts as the run goes, and says what is left', () => {
		expect(screenSummary(plan, run('running', ['done', 'in_progress', 'pending', 'pending'])).map((item) => item.text)).toEqual([
			'1 applied',
			'0 skipped',
			'0 failed',
			'2 not started'
		]);
		expect(screenSummary(plan, run('cancelled', ['done', 'failed', 'pending'])).map((item) => item.text)).toEqual(['1 applied', '0 skipped', '1 failed', '1 not started']);
	});

	it('marks a failure as such and nothing else', () => {
		const items = screenSummary(plan, run('finished', ['done', 'failed']));
		expect(items.filter((item) => item.skipped).map((item) => item.key)).toEqual(['skipped']);
	});
});

describe('small texts', () => {
	it('says what the plan is of (PLN-1)', () => {
		expect(planContext({ whole: true, entries: 12, siteUrl: 'https://example.shotgrid.autodesk.com' })).toBe('12 fields · example.shotgrid.autodesk.com');
		expect(planContext({ whole: false, entries: 1, siteUrl: 'https://example.shotgrid.autodesk.com' })).toBe('1 selected field · example.shotgrid.autodesk.com');
		expect(planContext({ whole: false, entries: 3, siteUrl: '' })).toBe('3 selected fields');
	});

	it('says what leaving a run in progress does', () => {
		expect(leaveQuestion()).toBe('An install is running. If you leave now it stops after the step that is running and the rest is not applied.');
	});

	it('names the report file after the set and the day', () => {
		expect(reportFileName('Camera Report: Lens / A', '2026-11-10T18:04:05.000Z')).toBe('install-report-camera-report-lens-a-2026-11-10.txt');
		expect(reportFileName('  ', '2026-11-10T18:04:05.000Z')).toBe('install-report-2026-11-10.txt');
	});

	it('keeps a set name in any script, as the set file does', () => {
		expect(reportFileName('レンズ', '2026-11-10T18:04:05.000Z')).toBe('install-report-レンズ-2026-11-10.txt');
		expect(reportFileName('Caméra / Объектив 2', '2026-11-10T18:04:05.000Z')).toBe('install-report-caméra-объектив-2-2026-11-10.txt');
		// The same slug as the set's own file, so the two sit together in a folder.
		expect(reportFileName('Caméra / Объектив 2', '2026-11-10T18:04:05.000Z')).toContain(setFileName('Caméra / Объектив 2').replace('.fieldset.json', ''));
	});

	it('caps a long set name as the set file does', () => {
		const name = reportFileName('a'.repeat(200), '2026-11-10T18:04:05.000Z');
		expect(name).toBe(`install-report-${'a'.repeat(80)}-2026-11-10.txt`);
	});
});

describe('the screen before it has a plan (RUN-1)', () => {
	it('the title names the set once it is read', () => {
		expect(installTitle('')).toBe('Install');
		expect(installTitle('Lens kit')).toBe('Install "Lens kit"');
	});

	it('RUN-1: reading the plan says how many fields, on which site', () => {
		expect(planLoadingLine(3, 'https://studio.shotgrid.autodesk.com')).toBe('Reading 3 fields on studio.shotgrid.autodesk.com.');
		expect(planLoadingLine(1, 'https://studio.shotgrid.autodesk.com')).toBe('Reading 1 field on studio.shotgrid.autodesk.com.');
		expect(planLoadingLine(0, 'https://studio.shotgrid.autodesk.com')).toBe('Reading no fields on studio.shotgrid.autodesk.com.');
	});

	it('RUN-1: no site, and a plan that could not be read, each say what happened and what follows', () => {
		expect(disconnectedLine('Sign in again.')).toBe('Sign in again. An install needs a site to compare with and to write to.');
		expect(planFailedLine('The site answered 503.')).toBe('The site answered 503. No plan was made.');
	});
});
