/**
 * The fake site must never reach a production build. Vite replaces `import.meta.env.DEV` with
 * `false` when it builds, so a dynamic import behind that test is dropped with its module. That
 * holds only while the source keeps the shape these tests read: one importer, one guarded
 * dynamic import. `pnpm build` output was checked for the fake's address when this was written
 * (docs/development.md says how).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import driveFile from '../../../fixtures/install-drive/install-drive.fieldset.json';
import type { PlanEntry } from '$lib/pure/plan';
import { createRun, replan } from '$lib/pure/run-driver';
import { asRefusal } from '$lib/pure/run-port';
import { decodeSetFile } from '$lib/pure/set-file';
import { createApplyVisibility } from '$lib/pure/visibility-run';
import { resolveScope } from '$lib/pure/visibility-scope';
import { FAKE_PROJECT_IDS, FAKE_TRASH_PAGE_URL, fakeInstallSite, fakeOptions, seededFakeSite } from '$lib/testing/install-site-fake';

const SRC = join(process.cwd(), 'src');

function sources(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sources(path);
		return /\.(ts|js|svelte)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
	});
}

/** The files, tests left out, whose text matches. Paths from `src`. */
function filesWith(pattern: RegExp): string[] {
	return sources(SRC)
		.filter((path) => pattern.test(readFileSync(path, 'utf8')))
		.map((path) => relative(SRC, path))
		.sort();
}

describe('the fake site stays out of a production build', () => {
	it('is imported by one module, and that module by install-site alone', () => {
		expect(filesWith(/from '[^']*testing\/fake-site'|from '\.\/fake-site'/)).toEqual(['lib/testing/install-site-fake.ts']);
		expect(filesWith(/install-site-fake'/)).toEqual(['lib/io/install-site.ts']);
		expect(filesWith(/sg-widgets-core\/mock/)).toEqual(['lib/testing/install-site-fake.ts']);
	});

	it('is reached only through a dynamic import behind import.meta.env.DEV', () => {
		const source = readFileSync(join(SRC, 'lib/io/install-site.ts'), 'utf8');
		expect(source).not.toMatch(/^import[^;]*install-site-fake/m);
		const uses = source.match(/[^\n]*\n[^\n]*import\('\$lib\/testing\/install-site-fake'\)/g) ?? [];
		expect(uses).toHaveLength(1);
		expect(uses[0]).toMatch(/^\s*if \(import\.meta\.env\.DEV && /);
	});
});

function driveEntries(): PlanEntry[] {
	const decoded = decodeSetFile(JSON.stringify(driveFile));
	if (!decoded.ok) throw new Error('The install drive set does not decode.');
	return decoded.set.entries.map((entry, index) => ({ ...entry, id: `e${index}` }));
}

const FAST = new URLSearchParams('fake&delay=0');

describe('the install drive set against the fake site', () => {
	it('plans every class', async () => {
		const site = fakeInstallSite(FAST);
		const { items } = (await replan({ reader: site.reader, site: { siteUrl: site.siteUrl, trashPageUrl: await site.trashPageUrl() } }, driveEntries())).plan;
		expect(Object.fromEntries(items.map((item) => [`${item.entityType}.${item.programmaticName}`, item.class]))).toEqual({
			'Shot.sg_drive_new_text': 'create',
			'Shot.sg_drive_link': 'create',
			'Shot.sg_drive_note': 'update',
			'Shot.sg_drive_grade': 'update',
			'Shot.sg_drive_match': 'already-matches',
			'Shot.sg_drive_match_done': 'already-matches',
			'Shot.sg_drive_count': 'type-conflict',
			'Shot.sg_drive_serial': 'blocked',
			'CustomEntity30.sg_drive_elsewhere': 'refused',
			'Shot.sg_drive_bad_name': 'refused',
			'Shot.sg_drive_revived': 'create',
			'Shot.sg_drive_retired_number': 'create',
			'Shot.sg_drive_refused': 'create'
		});
		expect(items.find((item) => item.programmaticName === 'sg_drive_link')?.reverseFieldTypes).toEqual(['Asset', 'Task']);
	});

	it('runs every branch: revive, re-trash, a refusal that stops nothing, a visibility failure, then a clean retry', async () => {
		const fake = seededFakeSite();
		const site = fakeInstallSite(FAST, fake);
		const resolved = resolveScope(await site.loadProjects(), []);
		expect(resolved.scope.projects.map((project) => project.id)).toEqual([...FAKE_PROJECT_IDS]);
		const run = createRun({
			port: site.port,
			reader: site.reader,
			site: { siteUrl: site.siteUrl, trashPageUrl: await site.trashPageUrl() },
			applyVisibility: createApplyVisibility(site.visibility, resolved)
		});
		const first = await run.start(driveEntries());
		const states = () => Object.fromEntries(run.getState().rows.map((row) => [row.programmaticName, row.state]));
		expect(first.status).toBe('finished');
		expect(states()).toMatchObject({
			sg_drive_new_text: 'done',
			sg_drive_link: 'done',
			sg_drive_note: 'done',
			sg_drive_grade: 'done',
			sg_drive_match: 'skipped',
			sg_drive_count: 'skipped',
			sg_drive_serial: 'skipped',
			sg_drive_revived: 'done',
			sg_drive_retired_number: 'failed',
			sg_drive_refused: 'failed'
		});
		const row = (name: string) => run.getState().rows.find((candidate) => candidate.programmaticName === name);
		expect(row('sg_drive_retired_number')?.note).toMatchObject({ code: 'retired-other-type', retired: true, trashPageUrl: FAKE_TRASH_PAGE_URL });
		expect(row('sg_drive_refused')?.note).toMatchObject({ code: 'refused', status: 403 });
		expect(row('sg_drive_match')?.visibility?.failures.map((failure) => failure.projectId)).toEqual([71]);
		expect(fake.retiredNames('Shot')).toContain('sg_drive_retired_number');
		expect(fake.writesOverlapped()).toBe(false);

		await run.retryVisibility(row('sg_drive_match')!.entryId);
		expect(row('sg_drive_match')?.visibility?.failures).toEqual([]);
		await run.retry();
		expect(states()).toMatchObject({ sg_drive_refused: 'done', sg_drive_retired_number: 'failed' });
	});
});

describe('the fake options', () => {
	it('reads the delay and the faults from the address', () => {
		expect(fakeOptions(new URLSearchParams('fake'))).toEqual({ delayMs: 120, faults: true });
		expect(fakeOptions(new URLSearchParams('fake&delay=400&faults=0'))).toEqual({ delayMs: 400, faults: false });
		expect(fakeOptions(new URLSearchParams('fake&delay=nope'))).toEqual({ delayMs: 120, faults: true });
	});

	it('refuses a write the way a site does: with a status', async () => {
		const site = fakeInstallSite(FAST);
		const failure = await site.port.createField('Shot', { data_type: 'text', properties: [{ property_name: 'name', value: 'Drive Refused' }] }).catch((error: unknown) => error);
		expect(asRefusal(failure)).toMatchObject({ status: 403 });
	});
});
