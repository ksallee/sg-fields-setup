/**
 * The install screen on the dev-only fake site (specs/08-install-run.md, docs/development.md "The
 * fake site"). The set is `fixtures/install-drive/install-drive.fieldset.json`; the header of
 * `src/lib/testing/install-site-fake.ts` lists what each of its fields plans and runs as. The fake's
 * state is read through `window.__installFake`.
 */
import type { Page } from '@playwright/test';
import type { FakeSite } from '../src/lib/testing/fake-site.ts';
import { expect, importSetFile, test } from './fixtures';

declare global {
	interface Window {
		/** The fake site, set by `src/lib/testing/install-site-fake.ts`. */
		__installFake?: FakeSite;
	}
}

/** The plan as the fake site makes it, group by group, in order (RUN-2). */
const PLAN: { group: string; title: string; open: boolean; rows: [name: string, planClass: string][] }[] = [
	{
		group: 'conflicts',
		title: 'Type conflicts',
		open: true,
		rows: [
			['sg_drive_elsewhere', 'refused'],
			['sg_drive_bad_name', 'refused'],
			['sg_drive_count', 'type-conflict']
		]
	},
	{ group: 'blocked', title: 'Blocked', open: true, rows: [['sg_drive_serial', 'blocked']] },
	{
		group: 'create',
		title: 'Create',
		open: true,
		rows: [
			['sg_drive_link', 'create'],
			['sg_drive_new_text', 'create'],
			['sg_drive_refused', 'create'],
			['sg_drive_retired_number', 'create'],
			['sg_drive_revived', 'create']
		]
	},
	{
		group: 'update',
		title: 'Update',
		open: true,
		rows: [
			['sg_drive_grade', 'update'],
			['sg_drive_note', 'update']
		]
	},
	{
		group: 'already-matches',
		title: 'Already matches',
		open: false,
		rows: [
			['sg_drive_match', 'already-matches'],
			['sg_drive_match_done', 'already-matches']
		]
	}
];

/** The rows the plan skips: no write may name them. */
const SKIPPED = PLAN.flatMap((group) => group.rows).filter(([, planClass]) => !['create', 'update', 'already-matches'].includes(planClass));
const SKIPPED_LABELS = ['Drive Elsewhere', 'Drive Other Label', 'Drive Count', 'Drive Serial'];

const group = (page: Page, id: string) => page.locator(`[data-slot="plan-group"][data-group="${id}"]`);
const plan = (page: Page) => page.locator('[data-slot="install-plan"]');
const planRow = (page: Page, name: string) =>
	page.locator('[data-slot="plan-row"]').filter({ has: page.getByTitle(name, { exact: true }) });
const action = (page: Page, name: string) => page.locator(`[data-slot="install-footer"] [data-action="${name}"]`);
const runLabel = (page: Page) => page.locator('[data-slot="run-label"]');

/** Seeds the set, opens its install screen on the fake site and waits for the plan. */
async function openInstall(page: Page, query: string): Promise<void> {
	const id = await importSetFile(page);
	await page.goto(`/sets/${encodeURIComponent(id)}/install?${query}`);
	await expect(page.locator('[data-slot="fake-notice"]')).toBeVisible();
	await expect(plan(page).locator('[data-slot="plan-row"]')).toHaveCount(13);
	await analysed(page);
	await expect(action(page, 'apply')).toBeEnabled();
}

/**
 * Waits for the visibility analysis. The confirmation's words carry its count, and a confirmation
 * asked for before it lands is refused as changed.
 */
async function analysed(page: Page): Promise<void> {
	await expect(page.locator('[data-slot="summary-visibility"]')).not.toContainText('still reading');
	await expect(page.locator('[data-slot="visibility-counters"] [data-kind="analysing"]')).toHaveCount(0);
}

/** Apply, then the confirmation's own button. */
async function install(page: Page): Promise<void> {
	await action(page, 'apply').click();
	const confirm = page.locator('[data-slot="install-confirm"]');
	await expect(confirm).toBeVisible();
	await confirm.locator('[data-action="confirm-install"]').click();
	await expect(confirm).toBeHidden();
}

test('RUN-1 RUN-2 RUN-3 RUN-16 RUN-19 RUN-22 VIS-7: the plan, the run, a failed row retried, a failed visibility step retried, no write for a skipped row', async ({ page }) => {
	await openInstall(page, 'fake&delay=0');
	// RUN-1: planned for all eligible projects.
	await expect(page.locator('[data-slot="summary-visibility"]')).toContainText('All eligible projects (3)');

	// RUN-2: the groups in order, each with its count; "Already matches" starts folded.
	const groups = plan(page).locator('[data-slot="plan-group"]');
	await expect(groups).toHaveCount(PLAN.length);
	for (const [index, expected] of PLAN.entries()) {
		const nth = groups.nth(index);
		await expect(nth).toHaveAttribute('data-group', expected.group);
		await expect(nth.getByRole('button', { name: new RegExp(`^${expected.title}`) })).toHaveAttribute('aria-expanded', String(expected.open));
		await expect(nth.locator('[data-slot="group-count"]')).toHaveText(String(expected.rows.length));
	}
	// RUN-3: each row in its group, with its class. Skipped rows say so before the run.
	for (const expected of PLAN) {
		for (const [name, planClass] of expected.rows) {
			const row = group(page, expected.group).locator('[data-slot="plan-row"]').filter({ has: page.getByTitle(name, { exact: true }) });
			await expect(row).toHaveAttribute('data-class', planClass);
			await expect(row).toHaveAttribute('data-status', SKIPPED.some(([skipped]) => skipped === name) ? 'skipped' : 'planned');
		}
	}
	await expect(planRow(page, 'sg_drive_note').locator('[data-slot="row-differences"]')).toContainText('Drive Note Old');

	// The confirmation names the site and what it writes.
	await action(page, 'apply').click();
	const confirm = page.locator('[data-slot="install-confirm"]');
	await expect(confirm.getByRole('heading')).toHaveText('Install on fake.shotgrid.autodesk.com?');
	await expect(confirm).toContainText('This creates 5 fields and updates 2 fields on https://fake.shotgrid.autodesk.com.');
	await confirm.locator('[data-action="confirm-install"]').click();

	await expect(runLabel(page)).toHaveText('Done');

	// RUN-16, RUN-22: the refused create fails and the run goes on past it.
	const refused = planRow(page, 'sg_drive_refused');
	await expect(refused).toHaveAttribute('data-status', 'failed');
	await expect(refused.locator('[data-slot="row-said"]')).toContainText('The site answered 403');
	for (const name of ['sg_drive_link', 'sg_drive_new_text', 'sg_drive_revived', 'sg_drive_grade', 'sg_drive_note']) {
		await expect(planRow(page, name)).toHaveAttribute('data-status', 'done');
	}
	await expect(planRow(page, 'sg_drive_retired_number')).toHaveAttribute('data-status', 'failed');
	for (const [name] of SKIPPED) await expect(planRow(page, name)).toHaveAttribute('data-status', 'skipped');

	// VIS-7: the failed visibility step is a warning on the row, with its own retry.
	await group(page, 'already-matches').getByRole('button', { name: /^Already matches/ }).click();
	const match = planRow(page, 'sg_drive_match');
	await expect(match).toHaveAttribute('data-status', 'skipped');
	await expect(match.locator('[data-slot="row-said"]')).toContainText('Visibility was not set on 1 project. Harbour Lights');
	await match.locator('[data-slot="retry-visibility"]').click();
	await expect(match.locator('[data-slot="retry-visibility"]')).toHaveCount(0);
	await expect(match.locator('[data-slot="row-said"]')).not.toContainText('Visibility was not set');

	// RUN-19: Retry runs the failed rows again; the refused create goes through the second time.
	await expect(action(page, 'retry')).toHaveText('Retry 2 failed');
	await action(page, 'retry').click();
	await expect(refused).toHaveAttribute('data-status', 'done');
	await expect(runLabel(page)).toHaveText('Done');
	await expect(planRow(page, 'sg_drive_retired_number')).toHaveAttribute('data-status', 'failed');
	await expect(planRow(page, 'sg_drive_new_text')).toHaveAttribute('data-status', 'done');

	// No write named a row the plan skipped.
	const writes = await page.evaluate(() => window.__installFake!.writes());
	expect(writes.length).toBeGreaterThan(0);
	const named = writes.filter(
		(call) =>
			call.entityType === 'CustomEntity30' ||
			SKIPPED.some(([name]) => call.field === name || call.created === name) ||
			SKIPPED_LABELS.some((label) => JSON.stringify(call.body ?? null).includes(label))
	);
	expect(named).toEqual([]);
});

/**
 * Each call of the fake site takes 20 ms: a run of the set is sixty-odd calls, so a Cancel sent
 * when the first row is done lands mid-run. At 5 ms the run often ended first. 10 ms held under
 * load. 20 ms leaves room for a slower machine.
 */
const CANCELLABLE = 'fake&faults=0&delay=20';

/** 200 ms a call: the run's sixty-odd calls outlast the two answers to the leave dialog by far. */
const SLOW = 'fake&faults=0&delay=200';

test('RUN-18 RUN-20: Cancel mid-run leaves the rest pending; Resume finishes them', async ({ page }) => {
	await openInstall(page, CANCELLABLE);
	await install(page);

	// The first row done, then Cancel: the step in flight completes, the rest stay pending.
	await page.locator('[data-slot="plan-row"][data-status="done"]').first().waitFor();
	await action(page, 'cancel').click();
	await expect(runLabel(page)).toHaveText('Cancelled');
	await expect(page.locator('[data-slot="plan-row"][data-status="in_progress"]')).toHaveCount(0);
	const pending = page.locator('[data-slot="plan-row"][data-status="pending"]');
	await expect(pending).not.toHaveCount(0);
	await expect(action(page, 'apply')).toHaveCount(0);

	await action(page, 'resume').click();
	await expect(runLabel(page)).toHaveText('Done');
	await expect(pending).toHaveCount(0);
	for (const name of ['sg_drive_link', 'sg_drive_new_text', 'sg_drive_refused', 'sg_drive_revived', 'sg_drive_grade', 'sg_drive_note']) {
		await expect(planRow(page, name)).toHaveAttribute('data-status', 'done');
	}
	await expect(page.locator('[data-slot="run-counter"]')).toHaveText('8 of 8');
});

test('RUN-18: leaving mid-run asks first; Stay keeps the run, Leave goes to the set', async ({ page }) => {
	await openInstall(page, SLOW);
	await install(page);
	await expect(action(page, 'cancel')).toBeVisible();

	const leave = page.locator('[data-slot="confirm-dialog"]');
	await page.locator('[data-slot="page-back"]').click();
	await expect(leave.getByRole('heading', { name: 'Leave the install?' })).toBeVisible();
	await leave.getByRole('button', { name: 'Stay' }).click();
	await expect(leave).toBeHidden();
	await expect(page).toHaveURL(/\/install\?/);
	await expect(runLabel(page)).toHaveText(/^(Applying|Checking the live schema)$/);

	await page.locator('[data-slot="page-back"]').click();
	await expect(leave).toBeVisible();
	await leave.getByRole('button', { name: 'Leave' }).click();
	await expect(page).toHaveURL(/\/sets\/[^/]+$/);
	await expect(page.locator('[data-slot="editor-status"]')).toHaveText('Saved');
});

test.describe(() => {
	// The fake site's picker runs on sg-widgets' mock client, whose projects carry picsum.photos
	// thumbnails. The guard still aborts each one. Remove this once the fake drops them.
	test.use({ toleratedHosts: ['picsum.photos'] });

	test('VIS-4 VIS-5 VIS-6: with one project chosen, a field the run made is hidden on the others; a field that was there is hidden nowhere new', async ({ page }) => {
		await openInstall(page, 'fake&faults=0&delay=0');

		await page.locator('[data-slot="visibility-panel"] [data-slot="entity-picker"]').click();
		await page.locator('[data-slot="entity-picker-option"][data-entity-id="70"]').click();
		await page.keyboard.press('Escape');
		await expect(page.locator('[data-slot="visibility-panel"] [data-slot="entity-picker"]')).toContainText('Blue Moon Rising');
		await expect(page.locator('[data-slot="summary-visibility"]')).toContainText('1 chosen project');
		await analysed(page);

		await install(page);
		await expect(runLabel(page)).toHaveText('Done');

		const hidden = await page.evaluate(() => {
			const names = ['sg_drive_link', 'sg_drive_new_text', 'sg_drive_refused', 'sg_drive_revived', 'sg_drive_note', 'sg_drive_grade', 'sg_drive_match', 'sg_drive_match_done', 'sg_drive_count', 'sg_drive_serial'];
			return Object.fromEntries(names.map((name) => [name, window.__installFake!.get('Shot', name)?.hiddenIn.toSorted() ?? null]));
		});
		expect(hidden).toEqual({
			// Made or revived by the run (VIS-4): visible on the chosen project only.
			sg_drive_link: [71, 72],
			sg_drive_new_text: [71, 72],
			sg_drive_refused: [71, 72],
			sg_drive_revived: [71, 72],
			// There before the run (VIS-5, VIS-6): hidden where they were, and nowhere else.
			sg_drive_note: [],
			sg_drive_grade: [],
			sg_drive_match: [71],
			sg_drive_match_done: [],
			sg_drive_count: [],
			sg_drive_serial: []
		});
	});
});
