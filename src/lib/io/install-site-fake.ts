/**
 * A site held in memory for the install screen, under `vite dev` only (`install-site.ts`, the
 * `?fake` flag). It is `$lib/pure/fixtures/fake-site`, which answers as the corpus measured, seeded
 * for the set in `fixtures/install-drive/install-drive.fieldset.json`: every class of the plan and
 * every branch of the run. Nothing here reaches a network. `docs/development.md` says how to
 * drive it.
 *
 * | field (on Shot)            | seeded as                              | plans as, runs as                         |
 * |----------------------------|----------------------------------------|-------------------------------------------|
 * | `sg_drive_new_text`        | nothing                                | create                                    |
 * | `sg_drive_link`            | nothing                                | create, reverse fields on Asset and Task  |
 * | `sg_drive_note`            | live, another label and description    | update                                    |
 * | `sg_drive_grade`           | live list, fewer values, no default    | update                                    |
 * | `sg_drive_match`           | live, the same, hidden in project 71   | already matches, visibility to add        |
 * | `sg_drive_match_done`      | live, the same, visible everywhere     | already matches, nothing left to do       |
 * | `sg_drive_count`           | live as text, the set wants a number   | type conflict                             |
 * | `sg_drive_serial`          | live, unique off, the set wants it on  | blocked                                   |
 * | `sg_drive_bad_name`        | nothing; its label derives another name| refused                                   |
 * | `sg_drive_revived`         | retired text                           | create: revived, then updated             |
 * | `sg_drive_retired_number`  | retired number                         | create: revived, put back, fails          |
 * | `sg_drive_refused`         | nothing                                | create: refused once (403), then created  |
 * | `CustomEntity30.*`         | the site has no such type              | refused                                   |
 *
 * Faults, each once, so a retry goes through: the first create of "Drive Refused" is refused, and
 * the first visibility write on `sg_drive_match` fails. `?fake&faults=0` turns both off.
 * `?fake&delay=<ms>` sets how long each call takes (default 120), so a cancel can land mid-run.
 *
 * `window.__installFake` is the fake site, for a drive to read its write log.
 */
import { MockClient } from 'sg-widgets-core/mock';
import { createSgContext } from 'sg-widgets-core';
import { FakeSite, FakeSiteError } from '$lib/pure/fixtures/fake-site';
import type { RunReader, SchemaWritePort } from '$lib/pure/run-port';
import type { VisibilityPort } from '$lib/pure/visibility-run';
import type { InstallSite } from './install-site';
import { onceLoaded } from './read-once';
import { createVisibilityAnalyser, loadProjects, visibilityPort } from './visibility';

/** The projects of the mock client: the picker and the fake site share them. */
export const FAKE_PROJECT_IDS = [70, 71, 72] as const;

export const FAKE_SITE_URL = 'https://fake.shotgrid.autodesk.com';
export const FAKE_TRASH_PAGE_URL = `${FAKE_SITE_URL}/page/4321`;

/** The fake site, seeded for the install drive set. */
export function seededFakeSite(): FakeSite {
	return new FakeSite({ siteUrl: FAKE_SITE_URL, entityTypes: ['Version', 'Shot', 'Asset', 'Task', 'Sequence'], projects: FAKE_PROJECT_IDS })
		.seed('Shot', 'code', { displayName: 'Shot Code', stock: true })
		.seed('Shot', 'sg_drive_note', { displayName: 'Drive Note Old', description: 'An older description.' })
		.seed('Shot', 'sg_drive_grade', { dataType: 'list', displayName: 'Drive Grade', validValues: ['a', 'b'] })
		.seed('Shot', 'sg_drive_match', { displayName: 'Drive Match', hiddenIn: [71] })
		.seed('Shot', 'sg_drive_match_done', { displayName: 'Drive Match Done' })
		.seed('Shot', 'sg_drive_count', { displayName: 'Drive Count' })
		.seed('Shot', 'sg_drive_serial', { displayName: 'Drive Serial' })
		.seedRetired('Shot', 'sg_drive_revived', { displayName: 'Drive Revived' })
		.seedRetired('Shot', 'sg_drive_retired_number', { dataType: 'number', displayName: 'Drive Retired Number' });
}

export interface FakeOptions {
	/** How long each call takes, in milliseconds. */
	delayMs: number;
	/** Whether the two one-time faults are armed. */
	faults: boolean;
}

export function fakeOptions(params: URLSearchParams): FakeOptions {
	const delay = Number(params.get('delay') ?? '120');
	return { delayMs: Number.isFinite(delay) && delay >= 0 ? delay : 120, faults: params.get('faults') !== '0' };
}

/** The fake as the install screen takes a site. */
export function fakeInstallSite(params: URLSearchParams, site: FakeSite = seededFakeSite()): InstallSite {
	const options = fakeOptions(params);
	const wait = <T>(value: T): Promise<T> => (options.delayMs === 0 ? Promise.resolve(value) : new Promise((done) => setTimeout(() => done(value), options.delayMs)));
	const slow =
		<A extends unknown[], T>(call: (...args: A) => Promise<T>) =>
		async (...args: A): Promise<T> => {
			await wait(null);
			return call(...args);
		};

	let refuseCreate = options.faults;
	let failVisibility = options.faults;

	const port: SchemaWritePort = {
		createField: slow((entityType, payload) => {
			if (refuseCreate && payload.properties[0]?.value === 'Drive Refused') {
				refuseCreate = false;
				site.failNext('createField', { status: 403, message: 'You do not have permission to create fields on Shot.' });
			}
			return site.createField(entityType, payload);
		}),
		updateField: slow((entityType, field, properties) => site.updateField(entityType, field, properties)),
		retireField: slow((entityType, field) => site.retireField(entityType, field)),
		reviveField: slow((entityType, field) => site.reviveField(entityType, field))
	};
	const inner = site.reader();
	const reader: RunReader = { entityTypes: slow(() => inner.entityTypes()), fields: slow((type) => inner.fields(type)), field: slow((type, name) => inner.field(type, name)) };

	const base = visibilityPort(site, site);
	const visibility: VisibilityPort = {
		readField: slow((entityType, field, projectId) => base.readField(entityType, field, projectId)),
		updateField: slow((entityType, field, properties, projectId) => {
			if (failVisibility && field === 'sg_drive_match') {
				failVisibility = false;
				return Promise.reject(new FakeSiteError(500, { code: 100, title: 'Shotgun Server Error' }));
			}
			return base.updateField(entityType, field, properties, projectId);
		})
	};

	const client = new MockClient();
	const analyser = createVisibilityAnalyser({ readRawFields: slow((entityType: string, projectId: number) => site.readRawFields(entityType, projectId)) });

	if (typeof window !== 'undefined') (window as unknown as { __installFake?: FakeSite }).__installFake = site;

	return {
		kind: 'fake',
		siteUrl: site.siteUrl,
		port,
		reader,
		trashPageUrl: () => wait(FAKE_TRASH_PAGE_URL),
		loadProjects: onceLoaded(() => loadProjects(client)),
		analyser,
		visibility,
		pickerContext: createSgContext({ client, siteUrl: site.siteUrl }),
		clear: () => analyser.clear()
	};
}
