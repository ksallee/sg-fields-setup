import { SchemaApiError, SgApiError } from 'sg-widgets-core';
import { describe, expect, it } from 'vitest';
import notFound from '../pure/fixtures/live-field-not-found.json';
import statusList from '../pure/fixtures/live-field-status-list.json';
import listing from '../pure/fixtures/live-schema.json';
import typeNotFound from '../pure/fixtures/live-type-not-found.json';
import versionFields from '../pure/fixtures/live-version-fields.json';
import { coreSchemaSource } from './core-schema-source';
import { createLiveSchema } from './schema';

interface Seen {
	url: string;
	method: string;
	authorization: string | null;
}

/** A site that answers each path with a canned status and body. */
function site(answers: Record<string, { status?: number; body: unknown }>) {
	const seen: Seen[] = [];
	const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		seen.push({ url: url.pathname + url.search, method: init?.method ?? 'GET', authorization: new Headers(init?.headers).get('authorization') });
		const answer = answers[url.pathname];
		if (!answer) throw new TypeError('Failed to fetch');
		const body = typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body);
		return new Response(body, { status: answer.status ?? 200 });
	}) as typeof fetch;
	const source = coreSchemaSource({ siteUrl: 'https://example.shotgrid.autodesk.com/', token: () => 'bearer-1', fetch: fetchFn });
	return { seen, source };
}

describe('coreSchemaSource', () => {
	it('reads the type list as the site sent it, through the core client (CMP-1)', async () => {
		const { seen, source } = site({ '/api/v1/schema': { body: listing } });
		expect(await source.readRawEntityTypes()).toEqual(listing.data);
		expect(seen).toEqual([{ url: '/api/v1/schema', method: 'GET', authorization: 'Bearer bearer-1' }]);
	});

	it('reads the fields of a type as the wrapped records, verbatim (W2, CMP-2)', async () => {
		const { seen, source } = site({ '/api/v1/schema/Version/fields': { body: versionFields } });
		expect(await source.readRawFields('Version')).toEqual(versionFields.data);
		expect(seen.map((call) => call.url)).toEqual(['/api/v1/schema/Version/fields']);
	});

	it('rejects for a type the site does not have, with the site\'s own words and the status', async () => {
		const { source } = site({ '/api/v1/schema/CustomEntity08/fields': { status: 404, body: typeNotFound } });
		const failure = await source.readRawFields('CustomEntity08').catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(SgApiError);
		expect((failure as SgApiError).status).toBe(404);
		expect((failure as SgApiError).message).toBe("Entity type 'CustomEntity08' does not exist.");
	});

	it('reads one field without a project (PLN-3)', async () => {
		const { seen, source } = site({ '/api/v1/schema/Version/fields/sg_status_list': { body: statusList } });
		expect(await source.readField('Version', 'sg_status_list')).toEqual({ status: 'found', raw: statusList.data });
		expect(seen.map((call) => call.url)).toEqual(['/api/v1/schema/Version/fields/sg_status_list']);
	});

	it('reads one field with a project', async () => {
		const { seen, source } = site({ '/api/v1/schema/Version/fields/sg_status_list': { body: statusList } });
		await source.readField('Version', 'sg_status_list', 70);
		expect(seen.map((call) => call.url)).toEqual(['/api/v1/schema/Version/fields/sg_status_list?project_id=70']);
	});

	it('answers missing for the 404 that names the field (PLN-3)', async () => {
		const { source } = site({ '/api/v1/schema/Version/fields/sg_not_a_field': { status: 404, body: notFound } });
		expect(await source.readField('Version', 'sg_not_a_field')).toEqual({
			status: 'missing',
			message: "Field 'Version.sg_not_a_field' does not exist."
		});
	});

	it('answers undeclared for a 200 with no data, also where core knows the field (PLN-4)', async () => {
		const { source } = site({
			'/api/v1/schema/Note/fields/read_by_current_user': { body: { data: null } },
			'/api/v1/schema/Note/fields/sg_other': { body: { data: null } }
		});
		expect(await source.readField('Note', 'read_by_current_user')).toEqual({ status: 'undeclared' });
		expect(await source.readField('Note', 'sg_other')).toEqual({ status: 'undeclared' });
	});

	it('rejects every other failure of the one-field read, never missing (PLN-3)', async () => {
		const { source } = site({
			'/api/v1/schema/CustomEntity08/fields/code': { status: 404, body: typeNotFound },
			'/api/v1/schema/Version/fields/denied': { status: 403, body: { errors: [{ status: 403, title: 'Forbidden', detail: null }] } },
			'/api/v1/schema/Version/fields/broken': { status: 500, body: '<html>Bad gateway</html>' },
			'/api/v1/schema/Version/fields/odd': { status: 404, body: { errors: [{ status: 404, title: 'Not Found', detail: null }] } }
		});
		await expect(source.readField('CustomEntity08', 'code')).rejects.toThrow("Entity type 'CustomEntity08' does not exist.");
		await expect(source.readField('Version', 'denied')).rejects.toMatchObject({ status: 403, message: 'Forbidden' });
		await expect(source.readField('Version', 'broken')).rejects.toThrow();
		await expect(source.readField('Version', 'odd')).rejects.toMatchObject({ status: 404 });
		await expect(source.readField('Version', 'offline')).rejects.toThrow('Failed to fetch');
	});

	it('rejects with core\'s SchemaApiError, the status and the site\'s body kept (PLN-3)', async () => {
		const { source } = site({
			'/api/v1/schema/CustomEntity08/fields': { status: 404, body: typeNotFound },
			'/api/v1/schema/CustomEntity08/fields/code': { status: 404, body: typeNotFound }
		});
		for (const failure of [
			await source.readRawFields('CustomEntity08').catch((error: unknown) => error),
			await source.readField('CustomEntity08', 'code').catch((error: unknown) => error)
		]) {
			expect(failure).toBeInstanceOf(SchemaApiError);
			expect(failure).toMatchObject({ status: 404, body: typeNotFound, detail: "Entity type 'CustomEntity08' does not exist." });
		}
	});

	it('asks once per read, with the bearer, and the one-field read never carries a project it was not given', async () => {
		const { seen, source } = site({
			'/api/v1/schema/Version/fields': { body: versionFields },
			'/api/v1/schema/Version/fields/sg_status_list': { body: statusList }
		});
		await source.readRawFields('Version');
		await source.readField('Version', 'sg_status_list');
		await source.readField('Version', 'sg_status_list', undefined);
		expect(seen).toEqual([
			{ url: '/api/v1/schema/Version/fields', method: 'GET', authorization: 'Bearer bearer-1' },
			{ url: '/api/v1/schema/Version/fields/sg_status_list', method: 'GET', authorization: 'Bearer bearer-1' },
			{ url: '/api/v1/schema/Version/fields/sg_status_list', method: 'GET', authorization: 'Bearer bearer-1' }
		]);
	});

	it('refuses a name that is not one before asking, since it would change the path', async () => {
		const { seen, source } = site({});
		await expect(source.readField('Version', 'a/b')).rejects.toThrow('not a field name');
		await expect(source.readField('Version', '')).rejects.toThrow('not a field name');
		await expect(source.readRawFields('Version/fields/x?')).rejects.toThrow('not an entity type name');
		expect(seen).toEqual([]);
	});

	it('keeps two reads at once apart', async () => {
		const { source } = site({
			'/api/v1/schema/Version/fields': { body: versionFields },
			'/api/v1/schema/Shot/fields': { body: { data: { code: versionFields.data.code } } }
		});
		const [version, shot] = await Promise.all([source.readRawFields('Version'), source.readRawFields('Shot')]);
		expect(Object.keys(version as object).length).toBe(13);
		expect(Object.keys(shot as object)).toEqual(['code']);
	});

	it('feeds the session schema end to end (PLN-3, CMP-2)', async () => {
		const { source } = site({
			'/api/v1/schema': { body: listing },
			'/api/v1/schema/Version/fields': { body: versionFields },
			'/api/v1/schema/Version/fields/sg_not_a_field': { status: 404, body: notFound },
			'/api/v1/schema/CustomEntity08/fields': { status: 404, body: typeNotFound }
		});
		const schema = createLiveSchema(source);
		expect((await schema.entityTypes()).length).toBe(8);
		expect((await schema.fields('Version')).find((field) => field.name === 'sg_ai_generated_from')?.description).toBe(
			'The versions this one was generated from.'
		);
		expect((await schema.fieldForPlan('Version', 'sg_not_a_field')).kind).toBe('absent');
		expect(await schema.fieldsOrEmpty('CustomEntity08')).toEqual([]);
	});
});
