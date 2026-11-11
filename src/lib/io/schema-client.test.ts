import { describe, expect, it } from 'vitest';
import statusList from '$lib/pure/fixtures/live-field-status-list.json';
import type { CreatePayload } from '$lib/pure/plan';
import { asRefusal, isRetiredNameRefusal, readRevive, retiredNameIn } from '$lib/pure/run-port';
import { visibleWrite } from '$lib/pure/visibility-value';
import { coreSchemaSource } from './core-schema-source';
import { createLiveSchema } from './schema';
import { createTrashPage, runReader, siteSchemaClient, TRASH_PAGE_FILTERS, type PageLister } from './schema-client';
import { visibilityPort } from './visibility';

interface Seen {
	method: string;
	/** Path and query, as sent. */
	url: string;
	authorization: string | null;
	contentType: string | null;
	/** The JSON body, parsed, or undefined when none was sent. */
	body: unknown;
}

type Answer = { status?: number; body?: unknown } | 'drop';

const SITE = 'https://example.shotgrid.autodesk.com';

/** A site that answers each request in turn. Nothing here reaches the network. */
function site(...answers: Answer[]) {
	const seen: Seen[] = [];
	const queue = [...answers];
	const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		if (url.origin !== SITE) throw new Error(`A request left the site: ${url.origin}`);
		const headers = new Headers(init?.headers);
		seen.push({
			method: init?.method ?? 'GET',
			url: url.pathname + url.search,
			authorization: headers.get('authorization'),
			contentType: headers.get('content-type'),
			body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
		});
		const answer = queue.shift();
		if (answer === undefined || answer === 'drop') throw new TypeError('Failed to fetch');
		const status = answer.status ?? 200;
		const text = answer.body === undefined ? null : JSON.stringify(answer.body);
		return new Response(status === 204 ? null : text, { status });
	}) as typeof fetch;
	const options = { siteUrl: `${SITE}/`, token: () => 'bearer-1', fetch: fetchFn };
	const schema = createLiveSchema(coreSchemaSource(options));
	return { seen, options, ...siteSchemaClient(options, schema) };
}

const CREATED = {
	status: 201,
	body: {
		data: { name: { value: 'Lens Serial', editable: true }, data_type: { value: 'text', editable: false } },
		links: { self: '/api/v1/schema/Version/fields/sg_lens_serial' }
	}
};

/** The refusal of a create whose name a retired field holds, as corpus finding 119 recorded it. */
const RETIRED_NAME_REFUSAL = {
	status: 400,
	body: {
		errors: [
			{
				id: 'x',
				status: 400,
				code: 105,
				title:
					'API schema_field_create() failed, there is a retired field with the same field_name: sg_lens_serial. Delete the retired field forever from the Trash Page in Shotgun and try again.',
				source: { field_name: 'there is a retired field with the same field_name: sg_lens_serial' },
				detail: null,
				meta: null
			}
		]
	}
};

describe('the write port: create (RUN-11, PLN-13, corpus endpoints/post_schema_type_fields)', () => {
	const payload: CreatePayload = {
		data_type: 'list',
		properties: [
			{ property_name: 'name', value: 'Lens Serial' },
			{ property_name: 'description', value: 'The serial of the lens.' },
			{ property_name: 'valid_values', value: ['a', 'b'] },
			{ property_name: 'default_value', value: 'a' }
		]
	};

	it('posts the payload as planned, the display name once and first, and answers the name in links.self', async () => {
		const { seen, port } = site(CREATED);
		expect(await port.createField('Version', payload)).toMatchObject({ name: 'sg_lens_serial' });
		expect(seen).toEqual([
			{
				method: 'POST',
				url: '/api/v1/schema/Version/fields',
				authorization: 'Bearer bearer-1',
				contentType: 'application/json',
				body: {
					data_type: 'list',
					properties: [
						{ property_name: 'name', value: 'Lens Serial' },
						{ property_name: 'description', value: 'The serial of the lens.' },
						{ property_name: 'valid_values', value: ['a', 'b'] },
						{ property_name: 'default_value', value: 'a' }
					]
				}
			}
		]);
	});

	it('sends a checkbox default as a boolean and unique as true', async () => {
		const { seen, port } = site(CREATED, CREATED);
		await port.createField('Shot', {
			data_type: 'checkbox',
			properties: [
				{ property_name: 'name', value: 'On Set' },
				{ property_name: 'default_value', value: false }
			]
		});
		await port.createField('Shot', {
			data_type: 'text',
			properties: [
				{ property_name: 'name', value: 'Slate' },
				{ property_name: 'unique', value: true }
			]
		});
		expect(seen.map((call) => call.body)).toEqual([
			{
				data_type: 'checkbox',
				properties: [
					{ property_name: 'name', value: 'On Set' },
					{ property_name: 'default_value', value: false }
				]
			},
			{
				data_type: 'text',
				properties: [
					{ property_name: 'name', value: 'Slate' },
					{ property_name: 'unique', value: true }
				]
			}
		]);
	});

	it('reads the name from a self link that spells the type in snake case (corpus finding 118)', async () => {
		const { port } = site({ status: 201, body: { data: {}, links: { self: '/api/v1/schema/custom_entity01/fields/sg_lens_serial' } } });
		expect((await port.createField('CustomEntity01', payload)).name).toBe('sg_lens_serial');
	});

	it('sends nothing when the payload does not start with one display name', async () => {
		const { seen, port } = site(CREATED, CREATED, CREATED, CREATED);
		const bad: CreatePayload[] = [
			{ data_type: 'text', properties: [] },
			{ data_type: 'text', properties: [{ property_name: 'description', value: 'x' }, { property_name: 'name', value: 'Lens' }] },
			{ data_type: 'text', properties: [{ property_name: 'name', value: '   ' }] },
			{ data_type: 'text', properties: [{ property_name: 'name', value: 'Lens' }, { property_name: 'name', value: 'Lens 2' }] },
			{ data_type: '', properties: [{ property_name: 'name', value: 'Lens' }] }
		];
		for (const one of bad) {
			const failure = await port.createField('Version', one).catch((error: unknown) => error);
			expect(failure).toBeInstanceOf(Error);
			// Not the site's answer: the run stops on it and creates nothing more (RUN-17).
			expect(asRefusal(failure)).toBeNull();
		}
		expect(seen).toEqual([]);
	});

	it('rejects when the answer has no self link: the name is unknown', async () => {
		const { port } = site({ status: 201, body: { data: {} } });
		await expect(port.createField('Version', payload)).rejects.toThrow(/links\.self/);
	});

	it('surfaces the retired-name refusal with status, message and source.field_name (RUN-14, corpus finding 119)', async () => {
		const { port } = site(RETIRED_NAME_REFUSAL);
		const refusal = asRefusal(await port.createField('Version', payload).catch((error: unknown) => error));
		expect(refusal?.status).toBe(400);
		expect(refusal?.message).toBe(
			'API schema_field_create() failed, there is a retired field with the same field_name: sg_lens_serial. Delete the retired field forever from the Trash Page in Shotgun and try again.'
		);
		expect(refusal?.source).toEqual({ field_name: 'there is a retired field with the same field_name: sg_lens_serial' });
		expect(isRetiredNameRefusal(refusal!)).toBe(true);
		expect(retiredNameIn(refusal!)).toBe('sg_lens_serial');
	});

	it('surfaces any other refusal with the server\'s words (RUN-27)', async () => {
		const { port } = site({ status: 400, body: { errors: [{ status: 400, code: 103, title: "API schema_field_create() missing required 'properties' [\"valid_values\"]" }] } });
		const refusal = asRefusal(await port.createField('Version', payload).catch((error: unknown) => error));
		expect(refusal).toMatchObject({ status: 400, message: "API schema_field_create() missing required 'properties' [\"valid_values\"]" });
		expect(isRetiredNameRefusal(refusal!)).toBe(false);
	});

	it('rejects with no status when no answer came (RUN-17)', async () => {
		const { port } = site('drop');
		const failure = await port.createField('Version', payload).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(TypeError);
		expect(asRefusal(failure)).toBeNull();
	});
});

describe('the write port: update (RUN-7, corpus endpoints/put_schema_type_fields_field)', () => {
	it('puts the properties alone: no project, no query, no data type', async () => {
		const { seen, port } = site({ body: { data: {} } });
		await port.updateField('Version', 'sg_lens_serial', [
			{ property_name: 'name', value: 'Lens Serial No' },
			{ property_name: 'valid_types', value: ['Shot', 'Asset'] }
		]);
		expect(seen).toEqual([
			{
				method: 'PUT',
				url: '/api/v1/schema/Version/fields/sg_lens_serial',
				authorization: 'Bearer bearer-1',
				contentType: 'application/json',
				body: {
					properties: [
						{ property_name: 'name', value: 'Lens Serial No' },
						{ property_name: 'valid_types', value: ['Shot', 'Asset'] }
					]
				}
			}
		]);
	});

	it('sends nothing for an empty update or one that carries visible', async () => {
		const { seen, port } = site({ body: { data: {} } }, { body: { data: {} } });
		await expect(port.updateField('Version', 'sg_lens_serial', [])).rejects.toThrow();
		await expect(
			port.updateField('Version', 'sg_lens_serial', [{ property_name: 'visible' as 'name', value: false }])
		).rejects.toThrow();
		expect(seen).toEqual([]);
	});

	it('surfaces a refusal: the gone field of an update is a 404 with the site\'s words', async () => {
		const { port } = site({ status: 404, body: { errors: [{ status: 404, code: 103, title: 'Not Found', detail: "Field 'Version.sg_lens_serial' does not exist." }] } });
		const refusal = asRefusal(await port.updateField('Version', 'sg_lens_serial', [{ property_name: 'name', value: 'x' }]).catch((error: unknown) => error));
		expect(refusal).toMatchObject({ status: 404, message: "Field 'Version.sg_lens_serial' does not exist." });
	});

	it('surfaces the 500 of a refused unique with its status', async () => {
		const { port } = site({ status: 500, body: { errors: [{ status: 500, code: 105, title: "API schema_field_update() does not support updating 'unique'." }] } });
		const refusal = asRefusal(await port.updateField('Version', 'sg_x', [{ property_name: 'name', value: 'x' }]).catch((error: unknown) => error));
		expect(refusal).toMatchObject({ status: 500, message: "API schema_field_update() does not support updating 'unique'." });
	});
});

describe('the visibility writer (VIS-7, corpus finding 115)', () => {
	it('puts visible with project_id in the body, never in the query', async () => {
		const { seen, visibilityWriter } = site({ body: { data: {} } }, { body: { data: {} } });
		await visibilityWriter.updateField('Version', 'sg_lens_serial', visibleWrite(false), 70);
		await visibilityWriter.updateField('Shot', 'sg_slate', visibleWrite(true), 122);
		expect(seen).toEqual([
			{
				method: 'PUT',
				url: '/api/v1/schema/Version/fields/sg_lens_serial',
				authorization: 'Bearer bearer-1',
				contentType: 'application/json',
				body: { properties: [{ property_name: 'visible', value: false }], project_id: 70 }
			},
			{
				method: 'PUT',
				url: '/api/v1/schema/Shot/fields/sg_slate',
				authorization: 'Bearer bearer-1',
				contentType: 'application/json',
				body: { properties: [{ property_name: 'visible', value: true }], project_id: 122 }
			}
		]);
	});

	it('sends nothing without a project id, or with anything but one visible property', async () => {
		const { seen, visibilityWriter } = site({ body: { data: {} } });
		for (const id of [0, -1, 1.5, Number.NaN, undefined as unknown as number]) {
			await expect(visibilityWriter.updateField('Version', 'sg_x', visibleWrite(true), id)).rejects.toThrow();
		}
		const stray = [{ property_name: 'name', value: 'x' }] as unknown as ReturnType<typeof visibleWrite>;
		await expect(visibilityWriter.updateField('Version', 'sg_x', stray, 70)).rejects.toThrow();
		const text = [{ property_name: 'visible', value: 'false' }] as unknown as ReturnType<typeof visibleWrite>;
		await expect(visibilityWriter.updateField('Version', 'sg_x', text, 70)).rejects.toThrow();
		expect(seen).toEqual([]);
	});

	it('surfaces the refusal of a project the site does not have', async () => {
		const { visibilityWriter } = site({ status: 400, body: { errors: [{ status: 400, code: 105, title: 'API schema_field_update(): The Project with the given project_id does not exist.' }] } });
		const refusal = asRefusal(await visibilityWriter.updateField('Version', 'sg_x', visibleWrite(false), 999).catch((error: unknown) => error));
		expect(refusal).toMatchObject({ status: 400, message: 'API schema_field_update(): The Project with the given project_id does not exist.' });
	});

	it('is the writer of the executor\'s port, with the project-scoped read beside it', async () => {
		const { seen, options, visibilityWriter } = site({ body: statusList }, { body: { data: {} } });
		const port = visibilityPort(coreSchemaSource(options), visibilityWriter);
		await port.readField('Version', 'sg_x', 70);
		await port.updateField('Version', 'sg_x', visibleWrite(false), 70);
		expect(seen.map((call) => `${call.method} ${call.url}`)).toEqual([
			'GET /api/v1/schema/Version/fields/sg_x?project_id=70',
			'PUT /api/v1/schema/Version/fields/sg_x'
		]);
		expect(seen[1]?.body).toEqual({ properties: [{ property_name: 'visible', value: false }], project_id: 70 });
	});
});

describe('the write port: retire (RUN-10, RUN-12, corpus endpoints/delete_schema_type_fields_field)', () => {
	it('deletes the field by name, with no body', async () => {
		const { seen, port } = site({ status: 204 });
		await expect(port.retireField('Version', 'sg_lens_serial')).resolves.toBeUndefined();
		expect(seen).toEqual([
			{ method: 'DELETE', url: '/api/v1/schema/Version/fields/sg_lens_serial', authorization: 'Bearer bearer-1', contentType: null, body: undefined }
		]);
	});

	it('surfaces the 404 of a field already retired', async () => {
		const { port } = site({ status: 404, body: { errors: [{ status: 404, code: 103, title: 'Not Found', detail: "Field 'Version.sg_lens_serial' does not exist." }] } });
		const refusal = asRefusal(await port.retireField('Version', 'sg_lens_serial').catch((error: unknown) => error));
		expect(refusal).toMatchObject({ status: 404, message: "Field 'Version.sg_lens_serial' does not exist." });
	});
});

describe('the write port: revive (RUN-9, corpus endpoints/post_schema_type_fields_field, finding 119)', () => {
	it('posts revive true to the field and answers revived on the 204', async () => {
		const { seen, port } = site({ status: 204 });
		const answer = await port.reviveField('Version', 'sg_lens_serial');
		expect(answer).toEqual({ revived: true });
		expect(readRevive(answer, 'sg_lens_serial')).toBe('revived');
		expect(seen).toEqual([
			{
				method: 'POST',
				url: '/api/v1/schema/Version/fields/sg_lens_serial',
				authorization: 'Bearer bearer-1',
				contentType: 'application/json',
				body: { revive: true }
			}
		]);
	});

	it('answers the measured 404 so the run reads it as nothing retired', async () => {
		const { port } = site({ status: 404, body: { errors: [{ status: 404, code: 103, title: 'Not Found', detail: 'Retired field Version.sg_lens_serial does not exist.' }] } });
		const answer = await port.reviveField('Version', 'sg_lens_serial');
		expect(answer).toEqual({ revived: false, status: 404, message: 'Retired field Version.sg_lens_serial does not exist.' });
		expect(readRevive(answer, 'sg_lens_serial')).toBe('nothing-retired');
	});

	it('answers the measured 400 so the run reads it as already live', async () => {
		const { port } = site({ status: 400, body: { errors: [{ status: 400, code: 103, title: 'Field Version.sg_lens_serial is not retired.' }] } });
		const answer = await port.reviveField('Version', 'sg_lens_serial');
		expect(answer).toEqual({ revived: false, status: 400, message: 'Field Version.sg_lens_serial is not retired.' });
		expect(readRevive(answer, 'sg_lens_serial')).toBe('already-live');
	});

	it('never reads a 404 that says something else as nothing retired', async () => {
		const { port } = site(
			{ status: 404, body: { errors: [{ status: 404, code: 103, title: 'Not Found', detail: "Entity type 'Versoin' does not exist." }] } },
			{ status: 404, body: '<html>Not Found</html>' }
		);
		expect(readRevive(await port.reviveField('Versoin', 'sg_lens_serial'), 'sg_lens_serial')).toBe('unknown');
		expect(readRevive(await port.reviveField('Version', 'sg_lens_serial'), 'sg_lens_serial')).toBe('unknown');
	});

	it('rejects a refused right or a server fault with its status (RUN-27)', async () => {
		const { port } = site(
			{ status: 403, body: { errors: [{ status: 403, title: 'Forbidden' }] } },
			{ status: 500, body: { errors: [{ status: 500, code: 100, title: 'Shotgun Server Error' }] } }
		);
		expect(asRefusal(await port.reviveField('Version', 'sg_x').catch((error: unknown) => error))).toMatchObject({ status: 403, message: 'Forbidden' });
		expect(asRefusal(await port.reviveField('Version', 'sg_x').catch((error: unknown) => error))).toMatchObject({ status: 500, message: 'Shotgun Server Error' });
	});
});

describe('the write port: names', () => {
	it('sends nothing for a type or a field name that is not one path segment', async () => {
		const { seen, port, visibilityWriter } = site();
		const name = [{ property_name: 'name' as const, value: 'x' }];
		await expect(port.createField('Version/../Shot', { data_type: 'text', properties: name })).rejects.toThrow();
		await expect(port.updateField('Version', 'sg_x/fields', name)).rejects.toThrow();
		await expect(port.updateField('Version', '', name)).rejects.toThrow();
		await expect(port.retireField('Version', 'sg x')).rejects.toThrow();
		await expect(port.reviveField('', 'sg_x')).rejects.toThrow();
		await expect(visibilityWriter.updateField('Version', 'sg_x?project_id=1', visibleWrite(true), 70)).rejects.toThrow();
		expect(seen).toEqual([]);
	});
});

describe('runReader (RUN-6, PLN-3, PLN-16)', () => {
	it('reads the site on every call, past the session cache', async () => {
		const calls: string[] = [];
		const schema = createLiveSchema({
			readRawEntityTypes: async () => {
				calls.push('types');
				return { Version: { name: { value: 'Version', editable: false } } };
			},
			readRawFields: async (entityType) => {
				calls.push(`fields ${entityType}`);
				return {};
			},
			readField: async (entityType, field) => {
				calls.push(`field ${entityType}.${field}`);
				return { status: 'missing', message: `Field '${entityType}.${field}' does not exist.` };
			}
		});
		// The cache is warm: a plain read would answer from it.
		await schema.entityTypes();
		await schema.fields('Version');
		calls.length = 0;

		const reader = runReader(schema);
		expect((await reader.entityTypes()).map((type) => type.name)).toEqual(['Version']);
		await reader.entityTypes();
		await reader.fields('Version');
		await reader.fields('Version');
		expect(await reader.field('Version', 'sg_x')).toMatchObject({ kind: 'absent' });
		expect(calls).toEqual(['types', 'types', 'fields Version', 'fields Version', 'field Version.sg_x']);
	});

	it('rejects when a read fails: never absent (PLN-3)', async () => {
		const schema = createLiveSchema({
			readRawEntityTypes: async () => ({}),
			readRawFields: async () => ({}),
			readField: async () => {
				throw Object.assign(new Error('Service Unavailable'), { status: 503 });
			}
		});
		await expect(runReader(schema).field('Version', 'sg_x')).rejects.toThrow('Service Unavailable');
	});
});

describe('the trash page for fields (RUN-21, corpus finding 120)', () => {
	function lister(answer: { id: number }[] | Error): PageLister & { asked: unknown[] } {
		const asked: unknown[] = [];
		return {
			asked,
			async search(entityType, options) {
				asked.push({ entityType, options });
				if (answer instanceof Error) throw answer;
				return { data: answer.map((row) => ({ type: 'Page', id: row.id, attributes: {} })), total: answer.length } as never;
			}
		};
	}

	it('searches the Page rows for the trash of DisplayColumn and builds the address', async () => {
		const client = lister([{ id: 4321 }]);
		expect(await createTrashPage(client, 'https://example.shotgrid.autodesk.com/')()).toBe('https://example.shotgrid.autodesk.com/page/4321');
		expect(client.asked).toEqual([
			{ entityType: 'Page', options: { filters: TRASH_PAGE_FILTERS, fields: ['name'], sort: 'id', page: { size: 1, number: 1 } } }
		]);
		expect(TRASH_PAGE_FILTERS).toEqual({
			logical_operator: 'and',
			conditions: [
				['ui_category', 'is', 'trash'],
				['entity_type', 'is', 'DisplayColumn']
			]
		});
	});

	it('answers null when the site has no such page, when the lookup fails, and for an id that is none', async () => {
		expect(await createTrashPage(lister([]), SITE)()).toBeNull();
		expect(await createTrashPage(lister(new Error('Forbidden')), SITE)()).toBeNull();
		expect(await createTrashPage(lister([{ id: 0 }]), SITE)()).toBeNull();
		expect(await createTrashPage(lister([{ id: 12 }]), '')()).toBeNull();
	});

	it('is looked up once a session; a failed lookup is asked again', async () => {
		const found = lister([{ id: 7 }]);
		const page = createTrashPage(found, SITE);
		expect(await Promise.all([page(), page()])).toEqual([`${SITE}/page/7`, `${SITE}/page/7`]);
		await page();
		expect(found.asked).toHaveLength(1);

		const none = lister([]);
		const empty = createTrashPage(none, SITE);
		expect([await empty(), await empty()]).toEqual([null, null]);
		expect(none.asked).toHaveLength(1);

		const failing = lister(new Error('Service Unavailable'));
		const retried = createTrashPage(failing, SITE);
		expect([await retried(), await retried()]).toEqual([null, null]);
		expect(failing.asked).toHaveLength(2);
	});
});
