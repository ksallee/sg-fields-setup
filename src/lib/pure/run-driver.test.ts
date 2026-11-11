import { describe, expect, it } from 'vitest';
import { createFakeSite, type FakeSite } from './fixtures/fake-site';
import type { PlanEntry } from './plan';
import { createRun, replan, type Run, type RunDeps } from './run-driver';
import { runReport } from './run-report';
import { rowParts, rowText, summaryText, visibilityProgress } from './run-text';
import { runCounters, type RunRow, type RunState } from './run';
import { createApplyVisibility, retryVisibility } from './visibility-run';
import type { ApplyVisibility, FieldOrigin, VisibilityFailure } from './visibility-types';

/* Fixtures. */

const TRASH = 'https://fake.shotgrid.autodesk.com/page/1234';

function entry(overrides: Partial<PlanEntry> = {}): PlanEntry {
	return {
		id: 'lens',
		targetEntityType: 'Version',
		programmaticName: 'sg_lens',
		displayName: 'Lens',
		dataType: 'text',
		validTypes: [],
		validValues: [],
		defaultValue: null,
		description: null,
		uniquePerProject: false,
		...overrides
	};
}

function deps(site: FakeSite, more: Partial<RunDeps> = {}): RunDeps {
	return { port: site, reader: site.reader(), site: { siteUrl: site.siteUrl, trashPageUrl: TRASH }, ...more };
}

function engine(site: FakeSite, more: Partial<RunDeps> = {}): Run {
	return createRun(deps(site, more));
}

function row(state: RunState, entryId = 'lens'): RunRow {
	const found = state.rows.find((candidate) => candidate.entryId === entryId);
	if (!found) throw new Error(`no row ${entryId}`);
	return found;
}

/** Runs `hook` just before the nth one-field read from now. With one entry: 1 the plan's, 2 the item's, 3 the read-back. */
function onRead(site: FakeSite, nth: number, hook: () => void): void {
	site.beforeNext('readField', nth <= 1 ? hook : () => onRead(site, nth - 1, hook));
}

const PROJECTS = [
	{ id: 70, name: 'Alpha' },
	{ id: 71, name: 'Beta' },
	{ id: 72, name: 'Gamma' }
];

/** A visibility step that walks three projects, as the real one does: asks for a cancel before each, reports after each. */
function scriptedVisibility(failing: number[] = []) {
	const calls: { field: string; origin: FieldOrigin }[] = [];
	const fail = new Set(failing);
	const apply: ApplyVisibility = async (field, origin, hooks) => {
		calls.push({ field: `${field.entityType}.${field.name}`, origin });
		const failures: VisibilityFailure[] = [];
		let done = 0;
		for (const [index, project] of PROJECTS.entries()) {
			if (hooks.isCancelled()) return { total: PROJECTS.length, done, written: done, failures, cancelled: true };
			await Promise.resolve();
			if (fail.has(project.id)) failures.push({ projectId: project.id, projectName: project.name, message: 'Refused.' });
			else done += 1;
			hooks.onProgress(index + 1, PROJECTS.length);
		}
		return { total: PROJECTS.length, done, written: done, failures, cancelled: false };
	};
	return { apply, calls, fail };
}

/* The table of RUN-7. */

describe('a run, class by class (RUN-7)', () => {
	it('RUN-7: skips a type conflict with the plan reason and writes nothing', async () => {
		const site = createFakeSite().seed('Version', 'sg_lens', { displayName: 'Lens', dataType: 'number' });
		const state = await engine(site).start([entry()]);
		expect(row(state)).toMatchObject({ class: 'type-conflict', state: 'skipped', note: { code: 'plan', reasons: [{ code: 'type-conflict' }] } });
		expect(rowText(row(state))).toContain('is a Number field on the site');
		expect(site.writes()).toEqual([]);
	});

	it('RUN-7: skips a blocked entry with the plan reason and writes nothing, not even its fine differences (PLN-9)', async () => {
		const site = createFakeSite().seed('Version', 'sg_lens', { displayName: 'Lens', description: 'Old.' });
		const state = await engine(site).start([entry({ uniquePerProject: true, description: 'New.' })]);
		expect(row(state)).toMatchObject({ class: 'blocked', state: 'skipped', note: { code: 'plan', reasons: [{ code: 'unique-cannot-change' }] } });
		expect(site.writes()).toEqual([]);
	});

	it('RUN-7, PLN-14: skips an entry whose entity type the site lacks, without reading or writing its field', async () => {
		const site = createFakeSite();
		const state = await engine(site).start([entry({ targetEntityType: 'Nope' })]);
		expect(row(state)).toMatchObject({ class: 'refused', state: 'skipped', note: { code: 'plan', reasons: [{ code: 'type-not-on-site' }] } });
		expect(site.calls.map((call) => call.op)).toEqual(['readRawEntityTypes']);
	});

	it('RUN-7, VIS-5: an entry that already matches gets visibility only and reads "nothing to change"', async () => {
		const site = createFakeSite().seed('Version', 'sg_lens', { displayName: 'Lens' });
		const visibility = scriptedVisibility();
		const state = await engine(site, { applyVisibility: visibility.apply }).start([entry()]);
		expect(row(state)).toMatchObject({ class: 'already-matches', state: 'skipped', note: { code: 'nothing-to-change' }, effects: [] });
		expect(visibility.calls).toEqual([{ field: 'Version.sg_lens', origin: 'existing' }]);
		expect(rowText(row(state))).toBe('Nothing to change. Visibility changed on 3 projects.');
		expect(site.writes()).toEqual([]);
	});

	it('RUN-7, RUN-15: an update re-reads, writes the differences, reads back, then applies visibility as existing', async () => {
		const site = createFakeSite().seed('Version', 'sg_lens', { displayName: 'Lens', description: 'Old.' });
		const visibility = scriptedVisibility();
		const state = await engine(site, { applyVisibility: visibility.apply }).start([entry({ description: 'New.' })]);
		expect(row(state)).toMatchObject({ class: 'update', state: 'done', note: null, effects: [{ kind: 'updated', name: 'sg_lens' }] });
		expect(site.calls.map((call) => call.op)).toEqual(['readRawEntityTypes', 'readField', 'readField', 'updateField', 'readField']);
		expect(site.get('Version', 'sg_lens')?.description).toBe('New.');
		expect(visibility.calls).toEqual([{ field: 'Version.sg_lens', origin: 'existing' }]);
	});

	it('RUN-7, RUN-9, RUN-11, VIS-4: a create re-reads, tries a revive, creates, reads back, then applies visibility as new', async () => {
		const site = createFakeSite();
		const visibility = scriptedVisibility();
		const state = await engine(site, { applyVisibility: visibility.apply }).start([entry({ description: 'The lens.' })]);
		expect(row(state)).toMatchObject({ class: 'create', state: 'done', note: null, effects: [{ kind: 'created', name: 'sg_lens' }] });
		expect(site.calls.map((call) => call.op)).toEqual([
			'readRawEntityTypes',
			'readField',
			'readRawFields',
			'readField',
			'reviveField',
			'createField',
			'readField'
		]);
		expect(site.get('Version', 'sg_lens')).toMatchObject({ displayName: 'Lens', description: 'The lens.', retired: false });
		expect(visibility.calls).toEqual([{ field: 'Version.sg_lens', origin: 'new' }]);
	});
});

/* Update. */

describe('an update at its turn (RUN-7, RUN-15, RUN-27)', () => {
	const live = { displayName: 'Lens', description: 'Old.' };
	const wanted = entry({ description: 'New.' });

	it('RUN-7: fails when the field is gone', async () => {
		const site = createFakeSite().seed('Version', 'sg_lens', live);
		onRead(site, 2, () => site.deleteForGood('Version', 'sg_lens'));
		const state = await engine(site).start([wanted]);
		expect(row(state)).toMatchObject({ class: 'update', state: 'failed', note: { code: 'gone' } });
		expect(rowText(row(state))).toBe('"Lens" (Version.sg_lens) is no longer on the site. It was there when the plan was made. Refresh to plan it again.');
		expect(site.writes()).toEqual([]);
	});

	it('RUN-7: fails with the reason when a difference is now blocked', async () => {
		const site = createFakeSite().seed('Version', 'sg_lens', live);
		onRead(site, 2, () => site.seed('Version', 'sg_lens', { ...live, unique: true }));
		const state = await engine(site).start([wanted]);
		expect(row(state)).toMatchObject({ state: 'failed', note: { code: 'plan', reasons: [{ code: 'unique-cannot-change' }] } });
		expect(site.writes()).toEqual([]);
	});

	it('RUN-7: skips with nothing to change when the field now matches', async () => {
		const site = createFakeSite().seed('Version', 'sg_lens', live);
		onRead(site, 2, () => site.seed('Version', 'sg_lens', { displayName: 'Lens', description: 'New.' }));
		const state = await engine(site).start([wanted]);
		expect(row(state)).toMatchObject({ class: 'update', state: 'skipped', note: { code: 'nothing-to-change' } });
		expect(site.writes()).toEqual([]);
	});

	it('RUN-7: writes the differences of the fresh read, not of the plan', async () => {
		const site = createFakeSite().seed('Version', 'sg_lens', live);
		onRead(site, 2, () => site.seed('Version', 'sg_lens', { displayName: 'Lense', description: 'Old.' }));
		const state = await engine(site).start([wanted]);
		expect(row(state).state).toBe('done');
		expect(site.writes().flatMap((call) => call.body)).toEqual([
			{ property_name: 'name', value: 'Lens' },
			{ property_name: 'description', value: 'New.' }
		]);
	});

	it('RUN-7, RUN-15: sends every request of the update, in the order planned, and ends matching', async () => {
		const site = createFakeSite().seed('Version', 'sg_state', {
			displayName: 'State',
			dataType: 'status_list',
			validValues: ['na', 'rev'],
			defaultValue: 'na'
		});
		const wantedState = entry({ programmaticName: 'sg_state', displayName: 'State', dataType: 'status_list', validValues: ['vwd', 'apr'], defaultValue: 'vwd' });
		// What the planner asks for: the values and the default together, which the site checks as a whole (finding 121).
		const requests = (await replan(deps(site), [wantedState])).items[0].update?.requests ?? [];
		expect(requests.length).toBeGreaterThan(0);

		const state = await engine(site).start([wantedState]);
		expect(row(state).state).toBe('done');
		expect(site.writes().map((call) => [call.op, call.outcome, call.body])).toEqual(
			requests.map((request) => ['updateField', 'ok', request.properties])
		);
		expect(site.get('Version', 'sg_state')).toMatchObject({ validValues: ['vwd', 'apr'], defaultValue: 'vwd' });
	});

	it('RUN-15: a write the site answered and did not apply is a failure that names the setting', async () => {
		const site = createFakeSite().seed('Version', 'sg_lens', live).ignoreNext('updateField');
		const state = await engine(site).start([wanted]);
		expect(row(state)).toMatchObject({
			state: 'failed',
			note: { code: 'not-applied', after: 'update', differences: [{ setting: 'description', live: 'Old.', wanted: 'New.' }] }
		});
		expect(rowText(row(state))).toBe(
			'"Lens" (Version.sg_lens) was updated. The site answered success and the field does not read back as wanted. Description: "Old." on the site, "New." in the set. Check the field in FPT, then retry.'
		);
	});

	it('RUN-27: a refused write is reported with the server status and message', async () => {
		const site = createFakeSite().seed('Version', 'sg_lens', live).failNext('updateField', { status: 403, message: 'You may not edit fields.' });
		const state = await engine(site).start([wanted]);
		expect(row(state)).toMatchObject({ state: 'failed', note: { code: 'refused', action: 'update', status: 403, message: 'You may not edit fields.' } });
		expect(rowText(row(state))).toBe('Install could not update "Lens" (Version.sg_lens). The site answered 403: You may not edit fields.');
		expect(state).toMatchObject({ status: 'finished', error: null });
	});

	it('finding 121: a repeated list value the site drops does not fail the read-back', async () => {
		const site = createFakeSite().seed('Version', 'sg_grade', { displayName: 'Grade', dataType: 'list', validValues: ['x'] });
		const state = await engine(site).start([
			entry({ programmaticName: 'sg_grade', displayName: 'Grade', dataType: 'list', validValues: ['alpha', 'alpha', 'beta'] })
		]);
		expect(row(state)).toMatchObject({ state: 'done', note: null });
		expect(site.get('Version', 'sg_grade')?.validValues).toEqual(['alpha', 'beta']);
	});
});

/* Create. */

describe('a create at its turn (RUN-8 to RUN-12)', () => {
	it('RUN-8: skips as "already exists" when the field is now live with the wanted type, and leaves its differences', async () => {
		const site = createFakeSite();
		const visibility = scriptedVisibility();
		onRead(site, 2, () => site.seed('Version', 'sg_lens', { displayName: 'Lens', description: 'Theirs.' }));
		const state = await engine(site, { applyVisibility: visibility.apply }).start([entry({ description: 'Ours.' })]);
		expect(row(state)).toMatchObject({
			class: 'create',
			state: 'skipped',
			note: { code: 'already-exists', differences: [{ setting: 'description' }] }
		});
		expect(rowText(row(state))).toBe(
			'"Lens" (Version.sg_lens) already exists on the site. Install did not create it. 1 setting differs from the set and was left as on the site. Description: "Theirs." on the site, "Ours." in the set. Refresh to plan an update. Visibility changed on 3 projects.'
		);
		expect(site.writes()).toEqual([]);
		expect(visibility.calls).toEqual([{ field: 'Version.sg_lens', origin: 'existing' }]);
	});

	it('RUN-8: skips as a type conflict when the field is now live with another type', async () => {
		const site = createFakeSite();
		onRead(site, 2, () => site.seed('Version', 'sg_lens', { displayName: 'Lens', dataType: 'number' }));
		const state = await engine(site).start([entry()]);
		expect(row(state)).toMatchObject({ state: 'skipped', note: { code: 'plan', reasons: [{ code: 'type-conflict', other: 'number' }] } });
		expect(site.writes()).toEqual([]);
	});

	it('RUN-9, RUN-10, Q2: revives a retired field that matches, silently, and counts it as new', async () => {
		const site = createFakeSite({ projects: [70] }).seedRetired('Version', 'sg_lens', { displayName: 'Lens', hiddenIn: [70] });
		const visibility = scriptedVisibility();
		const state = await engine(site, { applyVisibility: visibility.apply }).start([entry()]);
		expect(row(state)).toMatchObject({ state: 'done', note: null, effects: [{ kind: 'revived', name: 'sg_lens' }] });
		expect(site.writeLog()).toEqual(['reviveField Version.sg_lens']);
		expect(site.get('Version', 'sg_lens')).toMatchObject({ retired: false, hiddenIn: [] });
		expect(visibility.calls).toEqual([{ field: 'Version.sg_lens', origin: 'new' }]);
	});

	it('RUN-10: writes the differences of a revived field and reads back', async () => {
		const site = createFakeSite().seedRetired('Version', 'sg_lens', { displayName: 'Old lens', description: 'Old.' });
		const state = await engine(site).start([entry({ description: 'New.' })]);
		expect(row(state)).toMatchObject({ state: 'done', effects: [{ kind: 'revived' }, { kind: 'updated' }] });
		expect(site.writeLog()).toEqual(['reviveField Version.sg_lens', 'updateField Version.sg_lens']);
		expect(site.get('Version', 'sg_lens')).toMatchObject({ displayName: 'Lens', description: 'New.', retired: false });
	});

	it('RUN-10: fails when the revived field cannot be read, and does not retire it', async () => {
		const site = createFakeSite().seedRetired('Version', 'sg_lens', { displayName: 'Lens' });
		onRead(site, 3, () => site.failNext('readField', { status: 500, message: 'Shotgun Server Error' }));
		const state = await engine(site).start([entry()]);
		expect(row(state)).toMatchObject({ state: 'failed', note: { code: 'unreadable', after: 'revive', message: 'Shotgun Server Error' } });
		expect(site.writeLog()).toEqual(['reviveField Version.sg_lens']);
		expect(runReport(state).revived.map((field) => field.name)).toEqual(['sg_lens']);
	});

	it('RUN-10: a revived field of another data type goes back to the trash, and the row links to the trash page', async () => {
		const site = createFakeSite().seedRetired('Version', 'sg_lens', { displayName: 'Lens', dataType: 'number' });
		const visibility = scriptedVisibility();
		const state = await engine(site, { applyVisibility: visibility.apply }).start([entry()]);
		expect(row(state)).toMatchObject({
			state: 'failed',
			note: { code: 'retired-other-type', liveDataType: 'number', retired: true, retireError: null, trashPageUrl: TRASH },
			effects: [
				{ kind: 'revived', name: 'sg_lens' },
				{ kind: 'retired', name: 'sg_lens' }
			],
			visibility: null
		});
		// The retire, and nothing else after the revive.
		expect(site.writeLog()).toEqual(['reviveField Version.sg_lens', 'retireField Version.sg_lens']);
		expect(site.get('Version', 'sg_lens')).toMatchObject({ retired: true, dataType: 'number' });
		expect(visibility.calls).toEqual([]);
		expect(rowParts(row(state))).toEqual([
			{
				kind: 'text',
				text: 'The name Version.sg_lens is held by a retired Number field. The set wants Text for "Lens". A retired field comes back with the data type it had, so the API cannot reuse the name. Install put Version.sg_lens back in the trash. To free the name, delete it for good from '
			},
			{ kind: 'link', text: 'the trash page for fields', href: TRASH },
			{ kind: 'text', text: '. Then install again.' }
		]);
		expect(runReport(state)).toMatchObject({ revived: [], retired: [{ entityType: 'Version', name: 'sg_lens' }] });
	});

	it('RUN-10: a revived field with a blocked difference goes back to the trash, and the row names the setting', async () => {
		const site = createFakeSite().seedRetired('Version', 'sg_lens', { displayName: 'Lens', unique: true, description: 'Old.' });
		const state = await engine(site).start([entry({ description: 'New.' })]);
		expect(row(state)).toMatchObject({
			state: 'failed',
			note: { code: 'retired-blocked', reasons: [{ code: 'unique-cannot-change', setting: 'unique' }], retired: true }
		});
		expect(site.writeLog()).toEqual(['reviveField Version.sg_lens', 'retireField Version.sg_lens']);
		expect(site.get('Version', 'sg_lens')).toMatchObject({ retired: true, description: 'Old.' });
		expect(rowText(row(state))).toContain('Unique: on on the retired field, off in the set.');
		expect(rowText(row(state))).toContain(`the trash page for fields (${TRASH})`);
	});

	it('RUN-10: says so when the re-trash is refused and the field stays live', async () => {
		const site = createFakeSite()
			.seedRetired('Version', 'sg_lens', { displayName: 'Lens', dataType: 'number' })
			.failNext('retireField', { status: 403, message: 'You may not delete fields.' });
		const state = await engine(site).start([entry()]);
		expect(row(state)).toMatchObject({ state: 'failed', note: { code: 'retired-other-type', retired: false, retireError: 'You may not delete fields.' } });
		expect(rowText(row(state))).toContain('Install could not put Version.sg_lens back in the trash: You may not delete fields. It is live on the site now.');
		expect(runReport(state).revived.map((field) => field.name)).toEqual(['sg_lens']);
	});

	it('RUN-10: reads back after the re-trash and says so when the field is still live', async () => {
		const site = createFakeSite().seedRetired('Version', 'sg_lens', { displayName: 'Lens', dataType: 'number' }).ignoreNext('retireField');
		const state = await engine(site).start([entry()]);
		expect(row(state)).toMatchObject({ note: { code: 'retired-other-type', retired: false, retireError: 'The site answered success and the field is still live.' } });
	});

	it('RUN-11: takes the name the site assigned from the create answer, on a type whose self link is spelled otherwise', async () => {
		const site = createFakeSite({ entityTypes: ['CustomEntity03'] });
		const state = await engine(site).start([entry({ targetEntityType: 'CustomEntity03' })]);
		expect(row(state)).toMatchObject({ state: 'done', effects: [{ kind: 'created', name: 'sg_lens' }] });
		expect(site.calls.find((call) => call.op === 'createField')).toMatchObject({
			created: 'sg_lens',
			body: { data_type: 'text', properties: [{ property_name: 'name', value: 'Lens' }] }
		});
	});

	it('RUN-12: the last guard retires a field created under another name and states both names', async () => {
		const site = createFakeSite();
		// Someone makes a field with the label between the revive and the create: the site suffixes ours.
		site.beforeNext('createField', () => site.seed('Version', 'sg_lens', { displayName: 'Lens' }));
		const state = await engine(site).start([entry()]);
		expect(row(state)).toMatchObject({
			state: 'failed',
			note: { code: 'wrong-name', assigned: 'sg_lens_1', retired: true },
			effects: [
				{ kind: 'created', name: 'sg_lens_1' },
				{ kind: 'retired', name: 'sg_lens_1' }
			]
		});
		expect(site.writeLog()).toEqual(['reviveField Version.sg_lens', 'createField Version', 'retireField Version.sg_lens_1']);
		expect(site.get('Version', 'sg_lens_1')?.retired).toBe(true);
		expect(site.get('Version', 'sg_lens')?.retired).toBe(false);
		expect(rowText(row(state))).toBe(
			'The site named the new field Version.sg_lens_1. The set wants Version.sg_lens for "Lens". Install deleted the new field. The name sg_lens_1 is spent on this site.'
		);
		expect(runReport(state)).toMatchObject({ created: [], retired: [{ name: 'sg_lens_1' }] });
	});

	it('RUN-14: a create refused for a retired name fails with the trash instruction and does not loop', async () => {
		const site = createFakeSite();
		site.beforeNext('createField', () => site.seedRetired('Version', 'sg_lens', { displayName: 'Lens' }));
		const state = await engine(site).start([entry()]);
		expect(row(state)).toMatchObject({ state: 'failed', note: { code: 'name-retired', name: 'sg_lens', trashPageUrl: TRASH }, effects: [] });
		expect(site.writeLog()).toEqual(['reviveField Version.sg_lens', 'createField Version']);
		expect(rowText(row(state))).toBe(
			`The site refused to create "Lens" (Version.sg_lens). A retired field holds the name Version.sg_lens. To free the name, delete that field for good from the trash page for fields (${TRASH}). Then install again.`
		);
	});

	it.each([
		['a refusal that rejects', { status: 403, message: 'You may not edit fields.' }],
		['a refusal that comes back', { status: 409, message: 'Busy.' }],
		['a 404 that is not the measured one', { status: 404, message: 'Not Found' }],
		['a 404 about the type', { status: 404, message: "Entity type 'Version' does not exist." }]
	])('finding 119: never creates after a revive answered %s', async (_, refusal) => {
		const site = createFakeSite().failNext('reviveField', refusal);
		const state = await engine(site).start([entry()]);
		expect(row(state)).toMatchObject({ state: 'failed', note: { code: 'refused', action: 'revive', ...refusal } });
		expect(site.writeLog()).toEqual(['reviveField Version.sg_lens']);
		expect(site.liveNames('Version')).toEqual([]);
		expect(rowText(row(state))).toBe(`Install could not restore "Lens" (Version.sg_lens). The site answered ${refusal.status}: ${refusal.message}`);
	});

	it('finding 119: a revive answered "is not retired" means the field is live: read again, no create', async () => {
		const site = createFakeSite();
		site.beforeNext('reviveField', () => site.seed('Version', 'sg_lens', { displayName: 'Lens' }));
		const state = await engine(site).start([entry()]);
		expect(row(state)).toMatchObject({ state: 'skipped', note: { code: 'already-exists', differences: [] } });
		expect(site.writeLog()).toEqual(['reviveField Version.sg_lens']);
		expect(site.liveNames('Version')).toEqual(['sg_lens']);
	});

	it('RUN-15: reads a created field back, and a mismatch fails the row while the report keeps the field', async () => {
		const site = createFakeSite();
		onRead(site, 3, () => site.seed('Version', 'sg_lens', { displayName: 'Lens', description: 'Not ours.' }));
		const state = await engine(site).start([entry({ description: 'Ours.' })]);
		expect(row(state)).toMatchObject({ state: 'failed', note: { code: 'not-applied', after: 'create', differences: [{ setting: 'description' }] } });
		expect(runReport(state).created).toEqual([
			{ entityType: 'Version', name: 'sg_lens', displayName: 'Lens', rowState: 'failed', reverseFieldTypes: [] }
		]);
	});

	it('RUN-27: a refused create is reported with the server message and nothing is retired', async () => {
		const site = createFakeSite().failNext('createField', { status: 403, message: 'You may not edit fields.' });
		const state = await engine(site).start([entry()]);
		expect(row(state)).toMatchObject({ state: 'failed', note: { code: 'refused', action: 'create', status: 403 } });
		expect(site.writeLog()).toEqual(['reviveField Version.sg_lens', 'createField Version']);
	});
});

/* The run as a whole. */

describe('the run as a whole (RUN-6, RUN-16, RUN-17)', () => {
	const three = [
		entry({ id: 'a', programmaticName: 'sg_a', displayName: 'A' }),
		entry({ id: 'b', programmaticName: 'sg_b', displayName: 'B' }),
		entry({ id: 'c', programmaticName: 'sg_c', displayName: 'C' })
	];

	it('RUN-6: re-plans first, so a field made on the site since the plan was shown is not created twice', async () => {
		const site = createFakeSite().seed('Version', 'sg_lens', { displayName: 'Lens' });
		const state = await engine(site).start([entry()]);
		expect(row(state)).toMatchObject({ class: 'already-matches', state: 'skipped', note: { code: 'nothing-to-change' } });
		expect(site.writes()).toEqual([]);
		expect(site.liveNames('Version')).toEqual(['sg_lens']);
	});

	it('RUN-6: applies the items in the order of the entries, and reads everything before the first write', async () => {
		const site = createFakeSite();
		const state = await engine(site).start(three);
		expect(state.rows.map((item) => [item.entryId, item.state])).toEqual([
			['a', 'done'],
			['b', 'done'],
			['c', 'done']
		]);
		expect(site.liveNames('Version')).toEqual(['sg_a', 'sg_b', 'sg_c']);
		const firstWrite = site.calls.findIndex((call) => call.write);
		expect(site.calls.slice(0, firstWrite).filter((call) => call.op === 'readField' && call.field !== 'sg_a')).toHaveLength(2);
	});

	it('RUN-6: no two schema writes are ever in flight together, visibility included', async () => {
		const site = createFakeSite({ projects: [70, 71] })
			.seed('Version', 'sg_b', { displayName: 'B', description: 'Old.' })
			.seedRetired('Version', 'sg_c', { displayName: 'Old C' });
		const scope = { kind: 'chosen' as const, projects: [{ id: 70, name: 'Alpha' }] };
		const eligible = [
			{ id: 70, name: 'Alpha' },
			{ id: 71, name: 'Beta' }
		];
		const applyVisibility = createApplyVisibility(site, { scope, eligible });
		const state = await engine(site, { applyVisibility }).start([three[0], { ...three[1], description: 'New.' }, three[2]]);
		expect(state.rows.map((item) => item.state)).toEqual(['done', 'done', 'done']);
		expect(site.writes().length).toBeGreaterThan(5);
		expect(site.writesOverlapped()).toBe(false);
		// VIS-4: the new fields are hidden outside the chosen project. VIS-5: the existing one is hidden nowhere.
		expect(site.get('Version', 'sg_a')?.hiddenIn).toEqual([71]);
		expect(site.get('Version', 'sg_b')?.hiddenIn).toEqual([]);
		expect(site.get('Version', 'sg_c')?.hiddenIn).toEqual([71]);
	});

	it('RUN-6: a second start while one runs is refused, and so is a start over a finished run', async () => {
		const site = createFakeSite();
		const run = engine(site);
		const first = run.start(three);
		await expect(run.start(three)).rejects.toThrow('A run is in progress.');
		await expect(run.retry()).rejects.toThrow('A run is in progress.');
		await first;
		await expect(run.start(three)).rejects.toThrow('Reset it first.');
		expect(site.writesOverlapped()).toBe(false);
		run.reset();
		expect(run.getState()).toMatchObject({ status: 'idle', rows: [] });
	});

	it('RUN-16: one failure does not stop the run: the next item proceeds', async () => {
		const site = createFakeSite();
		let creates = 0;
		const failSecond = () => {
			creates += 1;
			if (creates === 1) site.beforeNext('createField', () => site.failNext('createField', { status: 500, message: 'Shotgun Server Error' }));
		};
		site.beforeNext('createField', failSecond);
		const state = await engine(site).start(three);
		expect(state.rows.map((item) => item.state)).toEqual(['done', 'failed', 'done']);
		expect(state).toMatchObject({ status: 'finished', error: null });
		expect(runCounters(state)).toMatchObject({ finished: 3, total: 3, done: 2, skipped: 0, failed: 1, pending: 0 });
		expect(summaryText(state)).toBe('2 applied, 0 skipped, 1 failed.');
	});

	it('RUN-17, PLN-3: a read that fails during the re-plan ends the run with one error and nothing written', async () => {
		const site = createFakeSite().failNext('readField', { status: 500, message: 'Shotgun Server Error' });
		const state = await engine(site).start(three);
		expect(state).toMatchObject({ status: 'finished', error: 'Shotgun Server Error', rows: [] });
		expect(site.writes()).toEqual([]);
		expect(summaryText(state)).toBe('Install stopped. Shotgun Server Error 0 applied, 0 skipped.');
	});

	it('RUN-17: a dropped connection fails the item in flight, stops the run and leaves the rest pending', async () => {
		const site = createFakeSite().dropNext('createField', 'after');
		const run = engine(site);
		const state = await run.start(three);
		expect(state).toMatchObject({ status: 'finished', error: 'Failed to fetch' });
		expect(state.rows.map((item) => item.state)).toEqual(['failed', 'pending', 'pending']);
		expect(row(state, 'a').note).toMatchObject({ code: 'refused', action: 'create', status: null });
		expect(rowText(row(state, 'a'))).toBe('Install could not create "A" (Version.sg_a). No answer came: Failed to fetch');

		// The create had reached the site. The retry re-plans, finds the field and does not create it again (RUN-19).
		const retried = await run.retry();
		expect(row(retried, 'a')).toMatchObject({ class: 'already-matches', state: 'skipped' });
		expect(site.liveNames('Version')).toEqual(['sg_a']);
		const resumed = await run.resume();
		expect(resumed.rows.map((item) => item.state)).toEqual(['skipped', 'done', 'done']);
		expect(resumed).toMatchObject({ status: 'finished', error: null });
	});

	it('PLN-10: a mirror entry gets no row', async () => {
		const site = createFakeSite();
		const state = await engine(site).start([entry({ id: 'm', dataType: 'calculated' }), three[0]]);
		expect(state.rows.map((item) => item.entryId)).toEqual(['a']);
	});

	it('PLN-20: after a run, planning again finds every installed entry already matching', async () => {
		const site = createFakeSite()
			.seed('Version', 'sg_note', { displayName: 'Note', description: 'Old.' })
			.seed('Version', 'sg_state', { displayName: 'State', dataType: 'status_list', validValues: ['na', 'rev'], defaultValue: 'na' })
			.seed('Version', 'sg_link', { displayName: 'Link', dataType: 'entity', validTypes: ['Shot'] })
			.seedRetired('Version', 'sg_old', { displayName: 'Old name', dataType: 'list', validValues: ['x'] });
		const entries = [
			entry({ id: 'text', programmaticName: 'sg_code', displayName: 'Code', description: 'A code.', uniquePerProject: true }),
			entry({ id: 'number', programmaticName: 'sg_count', displayName: 'Count', dataType: 'number' }),
			entry({ id: 'checkbox', programmaticName: 'sg_flag', displayName: 'Flag', dataType: 'checkbox' }),
			entry({ id: 'list', programmaticName: 'sg_grade', displayName: 'Grade', dataType: 'list', validValues: ['a', 'b'], defaultValue: 'b' }),
			entry({ id: 'status', programmaticName: 'sg_step', displayName: 'Step', dataType: 'status_list', validValues: ['na', 'rev'], defaultValue: 'rev' }),
			entry({ id: 'entity', programmaticName: 'sg_plate', displayName: 'Plate', dataType: 'entity', validTypes: ['Shot', 'Asset'] }),
			entry({ id: 'multi', programmaticName: 'sg_plates', displayName: 'Plates', dataType: 'multi_entity', validTypes: ['Shot'] }),
			entry({ id: 'update', programmaticName: 'sg_note', displayName: 'Note', description: 'New.' }),
			entry({ id: 'status-update', programmaticName: 'sg_state', displayName: 'State', dataType: 'status_list', validValues: ['vwd', 'apr'], defaultValue: 'vwd' }),
			entry({ id: 'link-update', programmaticName: 'sg_link', displayName: 'Link', dataType: 'entity', validTypes: ['Asset', 'Shot'] }),
			entry({ id: 'revive', programmaticName: 'sg_old', displayName: 'Old', dataType: 'list', validValues: ['x', 'y'], defaultValue: 'y' })
		];
		const state = await engine(site).start(entries);
		expect(state.rows.map((item) => [item.entryId, item.state])).toEqual(entries.map((item) => [item.id, 'done']));
		expect(site.writesOverlapped()).toBe(false);

		const again = await replan(deps(site), entries);
		expect(again.items.map((item) => [item.entryId, item.class])).toEqual(entries.map((item) => [item.id, 'already-matches']));

		// And a second run writes nothing.
		const writes = site.writes().length;
		const second = await engine(site).start(entries);
		expect(second.rows.every((item) => item.state === 'skipped' && item.note?.code === 'nothing-to-change')).toBe(true);
		expect(site.writes()).toHaveLength(writes);
	});
});

/* Cancel. */

describe('cancel (RUN-18)', () => {
	const two = [entry({ id: 'a', programmaticName: 'sg_a', displayName: 'A' }), entry({ id: 'b', programmaticName: 'sg_b', displayName: 'B' })];

	it('RUN-18: a cancel before the first item writes nothing: the re-plan reads end, every row stays pending', async () => {
		const site = createFakeSite();
		const run = engine(site);
		site.beforeNext('readRawEntityTypes', () => run.cancel());
		const state = await run.start(two);
		expect(state).toMatchObject({ status: 'cancelled', error: null, cancelRequested: false });
		expect(state.rows.map((item) => item.state)).toEqual(['pending', 'pending']);
		expect(site.writes()).toEqual([]);
		expect(summaryText(state)).toBe('Install cancelled. 0 applied, 0 skipped, 2 not started.');
	});

	it('RUN-18: a cancel between two items leaves the second pending', async () => {
		const site = createFakeSite();
		const run = engine(site);
		run.subscribe((state) => {
			if (state.rows[0]?.state === 'done') run.cancel();
		});
		const state = await run.start(two);
		expect(state.status).toBe('cancelled');
		expect(state.rows.map((item) => item.state)).toEqual(['done', 'pending']);
		expect(site.liveNames('Version')).toEqual(['sg_a']);
	});

	it('RUN-18: a cancel during a write lets the item finish, read-back included', async () => {
		const site = createFakeSite();
		const run = engine(site);
		const seen: boolean[] = [];
		run.subscribe((state) => seen.push(state.cancelRequested));
		site.beforeNext('createField', () => run.cancel());
		const state = await run.start(two);
		expect(state.status).toBe('cancelled');
		expect(state.rows.map((item) => item.state)).toEqual(['done', 'pending']);
		expect(site.calls.at(-1)).toMatchObject({ op: 'readField', field: 'sg_a' });
		expect(seen).toContain(true);
	});

	it('RUN-18: a cancel during the last item leaves nothing undone, so the run ends finished', async () => {
		const site = createFakeSite();
		const run = engine(site);
		site.beforeNext('createField', () => run.cancel());
		const state = await run.start([two[0]]);
		expect(state.status).toBe('finished');
		expect(state.rows.map((item) => item.state)).toEqual(['done']);
	});

	it('RUN-18: a cancel between two visibility steps stops there: the row is done, its visibility cut, the next row pending', async () => {
		const site = createFakeSite();
		const visibility = scriptedVisibility();
		const run = engine(site, { applyVisibility: visibility.apply });
		run.subscribe((state) => {
			if (state.rows[0]?.visibility?.done === 1) run.cancel();
		});
		const state = await run.start(two);
		expect(state.status).toBe('cancelled');
		expect(row(state, 'a')).toMatchObject({ state: 'done', visibility: { status: 'cancelled', done: 1, total: 3, origin: 'new' } });
		expect(row(state, 'b').state).toBe('pending');
		expect(rowText(row(state, 'a'))).toBe('Visibility changed on 1 project. Visibility was cancelled after 1 of 3 projects.');
		expect(runCounters(state).visibilityWarnings).toBe(1);
	});

	it('RUN-18, VIS-7: a visibility retry after a cancel adds its writes to the ones made before the cancel (issue #22)', async () => {
		const site = createFakeSite();
		// As the site behaves: a project already in the wanted state is read and not written again.
		const shown = new Set<number>();
		const apply: ApplyVisibility = async (_field, _origin, hooks) => {
			let done = 0;
			let written = 0;
			let cancelled = false;
			for (const project of PROJECTS) {
				if (hooks.isCancelled()) {
					cancelled = true;
					break;
				}
				if (!shown.has(project.id)) {
					shown.add(project.id);
					written += 1;
				}
				done += 1;
				hooks.onProgress(done, PROJECTS.length);
			}
			return { total: PROJECTS.length, done, written, failures: [], cancelled };
		};
		const run = engine(site, { applyVisibility: apply });
		const stop = run.subscribe((state) => {
			if (state.rows[0]?.visibility?.done === 1) run.cancel();
		});
		await run.start([two[0]]);
		stop();
		const state = await run.retryVisibility('a');
		expect(row(state, 'a').visibility).toMatchObject({ status: 'applied', done: 3, total: 3, written: 3 });
		expect(rowText(row(state, 'a'))).toBe('Visibility changed on 3 projects.');
	});

	it('RUN-18: a cancel during the schema work of an item keeps its visibility from starting', async () => {
		const site = createFakeSite();
		const visibility = scriptedVisibility();
		const run = engine(site, { applyVisibility: visibility.apply });
		site.beforeNext('createField', () => run.cancel());
		const state = await run.start(two);
		expect(visibility.calls).toEqual([]);
		expect(row(state, 'a')).toMatchObject({ state: 'done', visibility: { status: 'cancelled', done: 0, total: 0 } });
		expect(rowText(row(state, 'a'))).toBe('Visibility was not applied. The install was cancelled first.');
		expect(state.status).toBe('cancelled');
	});

	it('RUN-20: a cancelled run is resumed: the pending rows run, the done ones are left alone', async () => {
		const site = createFakeSite();
		const run = engine(site);
		site.beforeNext('createField', () => run.cancel());
		await run.start(two);
		const before = site.calls.length;
		const state = await run.resume();
		expect(state.status).toBe('finished');
		expect(state.rows.map((item) => item.state)).toEqual(['done', 'done']);
		expect(site.calls.slice(before).some((call) => call.field === 'sg_a')).toBe(false);
	});
});

/* Retry. */

describe('retry (RUN-19)', () => {
	const two = [entry({ id: 'a', programmaticName: 'sg_a', displayName: 'A' }), entry({ id: 'b', programmaticName: 'sg_b', displayName: 'B', description: 'Ours.' })];

	it('RUN-19: re-runs only the failed rows, each back to pending first, and a changed class shows on the row', async () => {
		const site = createFakeSite();
		// The second create is refused.
		site.beforeNext('createField', () => site.beforeNext('createField', () => site.failNext('createField', { status: 500, message: 'Shotgun Server Error' })));
		const run = engine(site);
		const first = await run.start(two);
		expect(first.rows.map((item) => [item.class, item.state])).toEqual([
			['create', 'done'],
			['create', 'failed']
		]);

		// Someone makes the field by hand before the retry, with another description.
		site.seed('Version', 'sg_b', { displayName: 'B', description: 'Theirs.' });
		const before = site.calls.length;
		const seen: string[] = [];
		const stop = run.subscribe((state) => seen.push(`${state.status} ${state.phase} ${row(state, 'b').class} ${row(state, 'b').state}`));
		const state = await run.retry();
		stop();

		expect(seen[0]).toBe('running planning create pending');
		expect(seen).toContain('running applying update pending');
		expect(row(state, 'b')).toMatchObject({ class: 'update', state: 'done', note: null });
		expect(site.get('Version', 'sg_b')?.description).toBe('Ours.');
		// The row that had completed keeps its result and is not touched again.
		expect(row(state, 'a')).toEqual(row(first, 'a'));
		expect(site.calls.slice(before).some((call) => call.field === 'sg_a')).toBe(false);
		expect(state).toMatchObject({ status: 'finished', error: null });
		expect(summaryText(state)).toBe('2 applied, 0 skipped.');
	});

	it('RUN-19: a retry with nothing failed does nothing', async () => {
		const site = createFakeSite();
		const run = engine(site);
		const first = await run.start(two);
		const before = site.calls.length;
		expect(await run.retry()).toBe(first);
		expect(site.calls).toHaveLength(before);
	});

	it('RUN-19, RUN-20: a row keeps what earlier attempts did to the site', async () => {
		const site = createFakeSite().seedRetired('Version', 'sg_a', { displayName: 'A', description: 'Old.' });
		site.failNext('updateField', { status: 500, message: 'Shotgun Server Error' });
		const run = engine(site);
		const first = await run.start([{ ...two[0], description: 'New.' }]);
		expect(row(first, 'a')).toMatchObject({ class: 'create', state: 'failed', effects: [{ kind: 'revived' }] });
		const state = await run.retry();
		expect(row(state, 'a')).toMatchObject({ class: 'update', state: 'done', effects: [{ kind: 'revived' }, { kind: 'updated' }] });
		expect(runReport(state)).toMatchObject({ revived: [{ name: 'sg_a' }], updated: [{ name: 'sg_a' }] });
	});
});

/* Visibility. */

describe('the visibility seam (VIS-4, VIS-5, VIS-7, Q5, RUN-22)', () => {
	it('fallback: with no visibility step none is applied and the rows say nothing of it', async () => {
		const site = createFakeSite();
		const state = await engine(site).start([entry()]);
		expect(row(state)).toMatchObject({ state: 'done', visibility: null });
		expect(rowParts(row(state))).toEqual([]);
	});

	it('RUN-22: shows "done of total" projects on the row while visibility is applied', async () => {
		const site = createFakeSite();
		const run = engine(site, { applyVisibility: scriptedVisibility().apply });
		const seen = new Set<string>();
		run.subscribe((state) => {
			const progress = state.rows[0] && visibilityProgress(state.rows[0]);
			if (progress) seen.add(`${state.rows[0].state}: ${progress}`);
		});
		const state = await run.start([entry()]);
		expect([...seen]).toEqual(['in_progress: 0 of 0 projects', 'in_progress: 1 of 3 projects', 'in_progress: 2 of 3 projects', 'in_progress: 3 of 3 projects']);
		expect(row(state)).toMatchObject({ state: 'done', visibility: { status: 'applied', done: 3, total: 3, written: 3, failures: [] } });
		expect(visibilityProgress(row(state))).toBeNull();
	});

	it('VIS-7, Q5: a failed project is a warning on a done row, never a failed row, and the row can be retried alone', async () => {
		const site = createFakeSite();
		const visibility = scriptedVisibility([71]);
		const run = engine(site, { applyVisibility: visibility.apply });
		const state = await run.start([entry()]);
		expect(row(state)).toMatchObject({
			state: 'done',
			note: null,
			visibility: { status: 'applied', origin: 'new', done: 2, total: 3, failures: [{ projectId: 71, projectName: 'Beta', message: 'Refused.' }] }
		});
		expect(rowText(row(state))).toBe('Visibility changed on 2 projects. Visibility was not set on 1 project. Beta: Refused.');
		expect(runCounters(state)).toMatchObject({ done: 1, failed: 0, visibilityWarnings: 1 });
		expect(summaryText(state)).toBe('1 applied, 0 skipped. Visibility is incomplete on 1 field.');
		expect(await run.retry()).toBe(state);

		visibility.fail.clear();
		const writes = site.writes().length;
		const seen: string[] = [];
		run.subscribe((next) => seen.push(`${next.status} ${next.phase}`));
		const retried = await run.retryVisibility('lens');
		expect(seen[0]).toBe('running visibility');
		expect(visibility.calls).toEqual([
			{ field: 'Version.sg_lens', origin: 'new' },
			{ field: 'Version.sg_lens', origin: 'new' }
		]);
		expect(row(retried)).toMatchObject({ state: 'done', visibility: { status: 'applied', done: 3, failures: [] } });
		expect(retried.status).toBe('finished');
		expect(runCounters(retried).visibilityWarnings).toBe(0);
		expect(site.writes()).toHaveLength(writes);
		await expect(run.retryVisibility('lens')).rejects.toThrow('no visibility to retry');
	});

	it('VIS-7: with the real visibility step, a retry goes to the failed projects alone', async () => {
		const site = createFakeSite({ projects: [70, 71] }).seed('Version', 'sg_lens', { displayName: 'Lens', hiddenIn: [70, 71] });
		const plan = {
			scope: { kind: 'all-eligible' as const, projects: [{ id: 70, name: 'Alpha' }, { id: 71, name: 'Beta' }] },
			eligible: [{ id: 70, name: 'Alpha' }, { id: 71, name: 'Beta' }]
		};
		// The second project's write is refused.
		site.beforeNext('updateField', () => site.beforeNext('updateField', () => site.failNext('updateField', { status: 500, message: 'Shotgun Server Error' })));
		const run = engine(site, {
			applyVisibility: createApplyVisibility(site, plan),
			retryVisibility: (field, origin, projectIds, hooks) => retryVisibility(site, plan, field, origin, projectIds, hooks)
		});
		const state = await run.start([entry()]);
		expect(row(state)).toMatchObject({ state: 'skipped', note: { code: 'nothing-to-change' }, visibility: { failures: [{ projectId: 71, projectName: 'Beta' }] } });
		expect(site.get('Version', 'sg_lens')?.hiddenIn).toEqual([71]);

		const before = site.calls.length;
		const retried = await run.retryVisibility('lens');
		expect(site.get('Version', 'sg_lens')?.hiddenIn).toEqual([]);
		expect(site.calls.slice(before).every((call) => call.projectId === 71)).toBe(true);
		expect(row(retried)).toMatchObject({ state: 'skipped', visibility: { status: 'applied', done: 1, total: 1, failures: [] } });
	});

	/* A field the run made stays new for the whole run, whatever a later re-plan finds (VIS-4, M1 of the audit). */

	const CHOSEN = {
		scope: { kind: 'chosen' as const, projects: [{ id: 70, name: 'Alpha' }] },
		eligible: [
			{ id: 70, name: 'Alpha' },
			{ id: 71, name: 'Beta' }
		]
	};

	it.each([
		['a 502', (site: FakeSite) => site.failNext('readField', { status: 502, message: 'Bad Gateway' }), null],
		['a dropped connection', (site: FakeSite) => site.dropNext('readField'), 'Failed to fetch']
	])('VIS-4, RUN-19: a field created before a read-back that got %s is still hidden outside the chosen projects on retry', async (_, fault, runError) => {
		const site = createFakeSite({ projects: [70, 71] });
		onRead(site, 3, () => fault(site));
		const run = engine(site, { applyVisibility: createApplyVisibility(site, CHOSEN) });
		const first = await run.start([entry()]);
		expect(row(first)).toMatchObject({ state: 'failed', note: { code: 'unreadable', after: 'create' }, effects: [{ kind: 'created', name: 'sg_lens' }], visibility: null });
		expect(first.error).toBe(runError);
		expect(site.get('Version', 'sg_lens')?.hiddenIn).toEqual([]);

		const state = await run.retry();
		// The re-plan finds the field live. The run made it all the same.
		expect(row(state)).toMatchObject({ class: 'already-matches', state: 'skipped', visibility: { origin: 'new', status: 'applied', failures: [] } });
		expect(site.get('Version', 'sg_lens')?.hiddenIn).toEqual([71]);
	});

	it('VIS-4, RUN-10, RUN-19: a field revived before a read that failed is still hidden outside the chosen projects on retry', async () => {
		const site = createFakeSite({ projects: [70, 71] }).seedRetired('Version', 'sg_lens', { displayName: 'Lens' });
		onRead(site, 3, () => site.failNext('readField', { status: 502, message: 'Bad Gateway' }));
		const run = engine(site, { applyVisibility: createApplyVisibility(site, CHOSEN) });
		const first = await run.start([entry()]);
		expect(row(first)).toMatchObject({ state: 'failed', note: { code: 'unreadable', after: 'revive' }, effects: [{ kind: 'revived' }] });

		const state = await run.retry();
		expect(row(state)).toMatchObject({ state: 'skipped', visibility: { origin: 'new' } });
		expect(site.get('Version', 'sg_lens')?.hiddenIn).toEqual([71]);
	});

	it('VIS-4, RUN-19: a created field that failed its read-back and is updated on retry is new all the same', async () => {
		const site = createFakeSite({ projects: [70, 71] });
		// Someone edits the field between the create and its read-back: the row fails, the retry plans an update.
		onRead(site, 3, () => site.seed('Version', 'sg_lens', { displayName: 'Lens', description: 'Theirs.' }));
		const run = engine(site, { applyVisibility: createApplyVisibility(site, CHOSEN) });
		await run.start([entry({ description: 'Ours.' })]);
		const state = await run.retry();
		expect(row(state)).toMatchObject({ class: 'update', state: 'done', visibility: { origin: 'new' } });
		expect(site.get('Version', 'sg_lens')?.hiddenIn).toEqual([71]);
	});

	it('VIS-5, VIS-6, RUN-10: a field the run revived and put back in the trash is not its own: found live on retry, it is hidden nowhere', async () => {
		const site = createFakeSite({ projects: [70, 71] }).seedRetired('Version', 'sg_lens', { displayName: 'Lens', dataType: 'number' });
		const run = engine(site, { applyVisibility: createApplyVisibility(site, CHOSEN) });
		const first = await run.start([entry()]);
		expect(row(first).effects.map((effect) => effect.kind)).toEqual(['revived', 'retired']);
		// Someone deletes the retired field for good and makes the field by hand.
		site.deleteForGood('Version', 'sg_lens').seed('Version', 'sg_lens', { displayName: 'Lens' });
		const state = await run.retry();
		expect(row(state)).toMatchObject({ class: 'already-matches', state: 'skipped', visibility: { origin: 'existing' } });
		expect(site.get('Version', 'sg_lens')?.hiddenIn).toEqual([]);
	});

	it('VIS-4, RUN-18, RUN-20: a cancel between a create and its visibility keeps the field new: Resume leaves the row, its own retry hides it', async () => {
		const site = createFakeSite({ projects: [70, 71] });
		const run = engine(site, { applyVisibility: createApplyVisibility(site, CHOSEN) });
		site.beforeNext('createField', () => run.cancel());
		const first = await run.start([entry(), entry({ id: 'b', programmaticName: 'sg_b', displayName: 'B' })]);
		expect(row(first)).toMatchObject({ state: 'done', visibility: { origin: 'new', status: 'cancelled' } });
		expect(site.get('Version', 'sg_lens')?.hiddenIn).toEqual([]);

		const resumed = await run.resume();
		expect(resumed.rows.map((item) => item.state)).toEqual(['done', 'done']);
		// Resume runs the pending rows only. The first row still says its visibility was not applied.
		expect(row(resumed)).toMatchObject({ visibility: { origin: 'new', status: 'cancelled' } });
		expect(runCounters(resumed).visibilityWarnings).toBe(1);
		expect(site.get('Version', 'sg_b')?.hiddenIn).toEqual([71]);

		const state = await run.retryVisibility('lens');
		expect(row(state)).toMatchObject({ visibility: { origin: 'new', status: 'applied' } });
		expect(site.get('Version', 'sg_lens')?.hiddenIn).toEqual([71]);
	});

	it('a visibility step that throws leaves the row done with the error, and the run goes on', async () => {
		const site = createFakeSite();
		const run = engine(site, {
			applyVisibility: () => {
				throw new Error('Broken.');
			}
		});
		const state = await run.start([entry(), entry({ id: 'b', programmaticName: 'sg_b', displayName: 'B' })]);
		expect(state.rows.map((item) => item.state)).toEqual(['done', 'done']);
		expect(rowText(row(state))).toBe('Visibility could not be applied. Broken.');
		expect(state.status).toBe('finished');
	});
});
