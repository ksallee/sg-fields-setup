import { describe, expect, it } from 'vitest';
import { SchemaApiError } from 'sg-widgets-core';
import type { EntityRow, SearchOptions } from 'sg-widgets-core';
import typeNotFound from '../pure/fixtures/live-type-not-found.json';
import versionFields from '../pure/fixtures/live-version-fields.json';
import type { FieldReply } from '../pure/live-field';
import { analysisStatus, rowVisibility, type AnalysisRow, type VisibilityAnalysis } from '../pure/visibility-analysis';
import { createApplyVisibility } from '../pure/visibility-run';
import { analysisProjects, resolveScope } from '../pure/visibility-scope';
import {
	PROJECT_PAGE_SIZE,
	coreVisibilitySource,
	createVisibilityAnalyser,
	loadProjects,
	readProjects,
	readTypeVisibility,
	visibilityPort,
	type ProjectLister,
	type VisibilitySource
} from './visibility';

/* The project list. */

const projectRow = (id: number, name: string, flags: Record<string, unknown> = {}): EntityRow => ({
	type: 'Project',
	id,
	attributes: { name, is_template: false, archived: false, is_demo: false, ...flags },
	relationships: {}
});

/** A client that answers `search` from a list of rows, a page at a time, and logs what it was asked. */
function lister(rows: EntityRow[]) {
	const asked: { entityType: string; options: SearchOptions }[] = [];
	const client: ProjectLister = {
		async search(entityType, options) {
			asked.push({ entityType, options });
			const size = options.page?.size ?? 50;
			const start = ((options.page?.number ?? 1) - 1) * size;
			const data = rows.slice(start, start + size);
			return { data, hasMore: data.length === size };
		}
	};
	return { client, asked };
}

describe('readProjects', () => {
	it('VIS-2: asks for the name and the three eligibility checkboxes, with no filter on status', async () => {
		const { client, asked } = lister([projectRow(70, 'Zebra'), projectRow(71, 'Template', { is_template: true })]);
		expect(await readProjects(client)).toEqual([
			{ id: 70, name: 'Zebra', is_template: false, archived: false, is_demo: false },
			{ id: 71, name: 'Template', is_template: true, archived: false, is_demo: false }
		]);
		expect(asked).toEqual([
			{
				entityType: 'Project',
				options: { fields: ['name', 'is_template', 'archived', 'is_demo'], sort: 'id', page: { size: PROJECT_PAGE_SIZE, number: 1 } }
			}
		]);
	});

	it('reads every page, and stops on a short one', async () => {
		const rows = Array.from({ length: PROJECT_PAGE_SIZE * 2 + 3 }, (_, index) => projectRow(index + 1, `P${index + 1}`));
		const { client, asked } = lister(rows);
		expect(await readProjects(client)).toHaveLength(rows.length);
		expect(asked.map((call) => call.options.page?.number)).toEqual([1, 2, 3]);
	});

	it('stops on the empty page after an exact multiple of the page size (B8)', async () => {
		const rows = Array.from({ length: PROJECT_PAGE_SIZE }, (_, index) => projectRow(index + 1, `P${index + 1}`));
		const { client, asked } = lister(rows);
		expect(await readProjects(client)).toHaveLength(PROJECT_PAGE_SIZE);
		expect(asked).toHaveLength(2);
	});

	it('reads a row with no name as an empty name', async () => {
		const { client } = lister([{ type: 'Project', id: 5, attributes: {}, relationships: {} }]);
		expect(await readProjects(client)).toEqual([{ id: 5, name: '', is_template: undefined, archived: undefined, is_demo: undefined }]);
	});

	it('rejects when the site refuses', async () => {
		const client: ProjectLister = { search: () => Promise.reject(new Error('Forbidden')) };
		await expect(readProjects(client)).rejects.toThrow('Forbidden');
	});
});

describe('loadProjects', () => {
	it('answers the list', async () => {
		const { client } = lister([projectRow(70, 'Zebra')]);
		const read = await loadProjects(client);
		expect(read.status).toBe('loaded');
		expect(resolveScope(read, []).scope).toEqual({ kind: 'all-eligible', projects: [{ id: 70, name: 'Zebra' }] });
	});

	it('VIS-3: a failed lookup is a value, with what the site said', async () => {
		const client: ProjectLister = {
			search: () => Promise.reject(Object.assign(new Error('Forbidden'), { body: { errors: [{ title: 'Forbidden', detail: 'No access to Project.' }] } }))
		};
		expect(await loadProjects(client)).toEqual({ status: 'failed', message: 'No access to Project.' });
	});
});

/* The listing read. */

interface Seen {
	url: string;
	method: string;
}

/** A site that answers each path with a canned status and body. */
function site(answers: Record<string, { status?: number; body: unknown }>) {
	const seen: Seen[] = [];
	const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		seen.push({ url: url.pathname + url.search, method: init?.method ?? 'GET' });
		const answer = answers[url.pathname + url.search] ?? answers[url.pathname];
		if (!answer) throw new TypeError('Failed to fetch');
		return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
	}) as typeof fetch;
	return { seen, source: coreVisibilitySource({ siteUrl: 'https://example.shotgrid.autodesk.com/', token: () => 'bearer-1', fetch: fetchFn }) };
}

const hiddenIn = (names: string[]) => ({
	data: Object.fromEntries(
		Object.entries(versionFields.data).map(([name, record]) => [name, { ...record, visible: { value: !names.includes(name), editable: true } }])
	)
});

describe('coreVisibilitySource', () => {
	it('VIS-8: reads a type at a project\'s scope in one call, as the site sent it', async () => {
		const { seen, source } = site({ '/api/v1/schema/Version/fields': { body: versionFields } });
		expect(await source.readRawFields('Version', 70)).toEqual(versionFields.data);
		expect(seen).toEqual([{ url: '/api/v1/schema/Version/fields?project_id=70', method: 'GET' }]);
	});

	it('refuses a name or a project id that is not one, before asking', async () => {
		const { seen, source } = site({});
		await expect(source.readRawFields('Version/fields/x?', 70)).rejects.toThrow('not an entity type name');
		await expect(source.readRawFields('Version', 0)).rejects.toThrow('not a project id');
		await expect(source.readRawFields('Version', 1.5)).rejects.toThrow('not a project id');
		await expect(source.readRawFields('Version', undefined as unknown as number)).rejects.toThrow('not a project id');
		expect(seen).toEqual([]);
	});

	it('rejects with the site\'s own words, as core\'s SchemaApiError', async () => {
		const { source } = site({ '/api/v1/schema/CustomEntity08/fields': { status: 404, body: typeNotFound } });
		const failure = await source.readRawFields('CustomEntity08', 70).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(SchemaApiError);
		expect(failure).toMatchObject({ status: 404, message: "Entity type 'CustomEntity08' does not exist." });
	});

	it('keeps two reads at once apart', async () => {
		const { source } = site({
			'/api/v1/schema/Version/fields?project_id=70': { body: hiddenIn(['code']) },
			'/api/v1/schema/Version/fields?project_id=71': { body: hiddenIn([]) }
		});
		const [a, b] = await Promise.all([
			readTypeVisibility(source, { entityType: 'Version', projectId: 70 }),
			readTypeVisibility(source, { entityType: 'Version', projectId: 71 })
		]);
		expect(a.ok && a.fields.get('code')?.visible).toBe(false);
		expect(b.ok && b.fields.get('code')?.visible).toBe(true);
	});
});

describe('readTypeVisibility', () => {
	it('answers each field\'s visible value and editable flag', async () => {
		const { source } = site({ '/api/v1/schema/Version/fields': { body: versionFields } });
		const result = await readTypeVisibility(source, { entityType: 'Version', projectId: 70 });
		expect(result.ok && result.fields.size).toBe(Object.keys(versionFields.data).length);
		expect(result.ok && result.fields.get('sg_uploaded_movie')).toEqual({ visible: true, editable: false });
	});

	it('never rejects: a failed read is a value (VIS-12)', async () => {
		const { source } = site({});
		expect(await readTypeVisibility(source, { entityType: 'Version', projectId: 70 })).toEqual({ ok: false, message: 'Failed to fetch' });
	});
});

/* The analyser. */

const rows: AnalysisRow[] = [
	{ entryId: 'e1', class: 'update', entityType: 'Version', programmaticName: 'sg_lens' },
	{ entryId: 'e2', class: 'already-matches', entityType: 'Shot', programmaticName: 'sg_cut' },
	{ entryId: 'e3', class: 'create', entityType: 'Asset', programmaticName: 'sg_new' }
];
const scope = resolveScope(
	{
		status: 'loaded',
		projects: Array.from({ length: 12 }, (_, index) => ({ id: index + 1, name: `P${String(index + 1).padStart(2, '0')}` }))
	},
	[]
);

/** A source in memory: sg_lens hidden in project 2, everything else visible. Counts what runs at once. */
function fakeSource(fail: (entityType: string, projectId: number) => boolean = () => false) {
	const log: string[] = [];
	let running = 0;
	let most = 0;
	const source: VisibilitySource = {
		async readRawFields(entityType, projectId) {
			log.push(`${entityType} ${projectId}`);
			running += 1;
			most = Math.max(most, running);
			await new Promise((done) => setTimeout(done, 0));
			running -= 1;
			if (fail(entityType, projectId)) throw new Error('Failed to fetch');
			return {
				sg_lens: { visible: { value: projectId !== 2, editable: true } },
				sg_cut: { visible: { value: true, editable: true } },
				sg_other: { visible: { value: false, editable: true } }
			};
		}
	};
	return { source, log, most: () => most };
}

describe('createVisibilityAnalyser', () => {
	it('VIS-8: one read per entity type and project, at most ten at once by default', async () => {
		const site = fakeSource();
		const analyser = createVisibilityAnalyser(site.source);
		const analysis = await analyser.analyse(rows, analysisProjects(scope));
		expect(site.log).toHaveLength(24);
		expect(new Set(site.log).size).toBe(24);
		expect(site.log.some((line) => line.startsWith('Asset'))).toBe(false);
		expect(site.most()).toBe(10);
		expect(analysisStatus(analysis)).toBe('loaded');
		expect(rowVisibility(rows[0]!, scope, analysis).toAdd).toEqual([{ id: 2, name: 'P02' }]);
	});

	it('takes another cap', async () => {
		const site = fakeSource();
		await createVisibilityAnalyser(site.source, { cap: 3 }).analyse(rows, analysisProjects(scope));
		expect(site.most()).toBe(3);
	});

	it('VIS-8: only the fields of the plan are kept', async () => {
		const analysis = await createVisibilityAnalyser(fakeSource().source).analyse(rows, analysisProjects(scope));
		const state = analysis.states.get('Version\n1');
		expect(state?.status === 'loaded' ? [...state.fields.keys()] : null).toEqual(['sg_lens']);
	});

	it('VIS-8, VIS-11: the same rows and projects are read once, until a refresh', async () => {
		const site = fakeSource();
		const analyser = createVisibilityAnalyser(site.source);
		const first = analyser.analyse(rows, analysisProjects(scope));
		const second = analyser.analyse([...rows].reverse(), analysisProjects(resolveScope({ status: 'loaded', projects: scope.eligible }, [3])));
		expect(await second).toBe(await first);
		expect(site.log).toHaveLength(24);
		expect(analyser.held(rows, analysisProjects(scope))).toBe(await first);

		analyser.clear();
		expect(analyser.held(rows, analysisProjects(scope))).toBeNull();
		await analyser.analyse(rows, analysisProjects(scope));
		expect(site.log).toHaveLength(48);
	});

	it('tells each caller as reads land, and a late caller the result', async () => {
		const analyser = createVisibilityAnalyser(fakeSource().source);
		const seen: VisibilityAnalysis[] = [];
		const final = await analyser.analyse(rows, analysisProjects(scope), (analysis) => seen.push(analysis));
		expect(seen).toHaveLength(25);
		expect(analysisStatus(seen[0]!)).toBe('analysing');
		expect(seen.at(-1)).toBe(final);

		const late: VisibilityAnalysis[] = [];
		await analyser.analyse(rows, analysisProjects(scope), (analysis) => late.push(analysis));
		expect(late).toEqual([final]);
	});

	it('VIS-12: never rejects; a failed read leaves its projects in analysing', async () => {
		const site = fakeSource((entityType, projectId) => entityType === 'Version' && projectId === 1);
		const analysis = await createVisibilityAnalyser(site.source).analyse(rows, analysisProjects(scope));
		expect(analysisStatus(analysis)).toBe('failed');
		expect(rowVisibility(rows[0]!, scope, analysis).analysing).toEqual([{ id: 1, name: 'P01' }]);
		expect(rowVisibility(rows[1]!, scope, analysis).analysing).toEqual([]);
	});

	it('reads nothing when no row is analysed', async () => {
		const site = fakeSource();
		const analysis = await createVisibilityAnalyser(site.source).analyse([rows[2]!], analysisProjects(scope));
		expect(site.log).toEqual([]);
		expect(analysisStatus(analysis)).toBe('loaded');
	});
});

/* The executor's port. */

describe('visibilityPort', () => {
	const found: FieldReply = { status: 'found', raw: { visible: { value: false, editable: true } } };
	const field = { entityType: 'Version', name: 'sg_lens' };
	const plan = { scope: { kind: 'chosen' as const, projects: [{ id: 70, name: 'Zebra' }] }, eligible: [{ id: 70, name: 'Zebra' }] };
	const hooks = { isCancelled: () => false, onProgress: () => {} };

	it('reads through the schema source, at the project\'s scope', async () => {
		const asked: unknown[][] = [];
		const port = visibilityPort({
			readField: async (...args) => {
				asked.push(args);
				return found;
			}
		}, { updateField: async () => null });
		expect(await port.readField('Version', 'sg_lens', 70)).toBe(found);
		expect(asked).toEqual([['Version', 'sg_lens', 70]]);
	});

	it('writes through a client shaped like core\'s schema client: properties, then the project', async () => {
		let visible = false;
		const sent: unknown[][] = [];
		// The signature of sg-widgets core's `SchemaClient.updateField`, wider than the port asks for.
		const client = {
			async updateField(entityType: string, name: string, properties: { property_name: string; value: unknown }[] | Record<string, unknown>, projectId?: number) {
				sent.push([entityType, name, properties, projectId]);
				visible = true;
				return null;
			}
		};
		const port = visibilityPort({ readField: async () => ({ status: 'found', raw: { visible: { value: visible, editable: true } } }) }, client);
		const outcome = await createApplyVisibility(port, plan)(field, 'existing', hooks);
		expect(outcome).toEqual({ total: 1, done: 1, written: 1, failures: [], cancelled: false });
		expect(sent).toEqual([['Version', 'sg_lens', [{ property_name: 'visible', value: true }], 70]]);
	});
});
