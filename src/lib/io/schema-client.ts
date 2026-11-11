/**
 * The schema writes of the connected site, as the install run takes them (issues #18, #19).
 *
 * This is the one module that turns a planned write into a request. Everything it sends is
 * measured in the corpus (`endpoints/*schema_type_fields*`, findings 115, 119, 120):
 *
 * | call                 | request                                                                  |
 * |----------------------|--------------------------------------------------------------------------|
 * | create               | `POST /schema/<Type>/fields` `{data_type, properties}`, `name` first     |
 * | update               | `PUT /schema/<Type>/fields/<field>` `{properties}`                       |
 * | visibility           | `PUT /schema/<Type>/fields/<field>` `{properties: [visible], project_id}`|
 * | retire               | `DELETE /schema/<Type>/fields/<field>`, no body                          |
 * | revive               | `POST /schema/<Type>/fields/<field>` `{revive: true}`                    |
 * | the trash page       | `POST /entity/pages/_search`, a read                                     |
 *
 * The HTTP is sg-widgets core's `RestSchemaClient`. No npm release carries it yet, so it is the
 * copy in `$lib/vendor-core/schema-write.ts`, imported here and nowhere else. Issue #21 swaps the
 * import below for `sg-widgets-core`.
 *
 * A refusal comes out as core's `SchemaApiError`: `status`, `message` (the first error's
 * `detail`, else its `title`) and `source`. That is what `$lib/pure/run-port` reads.
 *
 * Every adapter checks what it is about to send and rejects, with nothing sent, when it is not
 * one of the forms above. Such a rejection has no `status`, so the run reads it as a failure
 * that is not the site's answer and stops (RUN-17). A wrong request never leaves.
 */
import type { RestClientOptions, SearchOptions, SearchResult } from 'sg-widgets-core';
import type { CreatePayload, PropertyWrite } from '$lib/pure/plan';
import type { RunReader, SchemaWritePort } from '$lib/pure/run-port';
import type { VisibleWrite } from '$lib/pure/visibility-value';
import { RestSchemaClient, type SchemaClient } from '$lib/vendor-core/schema-write';
import type { LiveSchema } from './schema';
import type { VisibilityWriter } from './visibility';

/** The four writes of core's schema client. */
export type SchemaWriter = Pick<SchemaClient, 'createField' | 'updateField' | 'retireField' | 'reviveField'>;

/** A name that is one path segment: an entity type or a field. */
const NAME = /^[A-Za-z0-9_]+$/;

/** The properties a create or an update of this app ever sends (PLN-13). `visible` is not one: it has its own writer. */
const SCHEMA_PROPERTIES: readonly string[] = ['name', 'description', 'valid_values', 'default_value', 'valid_types', 'unique'];

function refuseToSend(why: string): never {
	throw new Error(`Nothing was sent. ${why}`);
}

function checkNames(entityType: string, field?: string): void {
	if (!NAME.test(entityType)) refuseToSend(`'${entityType}' is not an entity type name.`);
	if (field !== undefined && !NAME.test(field)) refuseToSend(`'${field}' is not a field name.`);
}

function checkProperties(properties: readonly PropertyWrite[]): void {
	for (const property of properties) {
		if (!SCHEMA_PROPERTIES.includes(property.property_name)) refuseToSend(`'${String(property.property_name)}' is not a setting this app writes.`);
	}
}

/** Runs a check and a call so that a failed check is a rejection, never a throw. */
async function guarded<T>(check: () => void, call: () => Promise<T>): Promise<T> {
	check();
	return call();
}

/**
 * The run's four writes over core's schema client. The first property of a create payload is
 * the display name (PLN-13): core sends it as the `name` property, first, so the body that
 * leaves is the payload as planned.
 */
export function schemaWritePort(client: SchemaWriter): SchemaWritePort {
	return {
		createField: (entityType, payload: CreatePayload) =>
			guarded(
				() => {
					checkNames(entityType);
					if (typeof payload.data_type !== 'string' || payload.data_type.trim() === '') refuseToSend('The create has no data type.');
					const [name, ...rest] = payload.properties;
					if (!name || name.property_name !== 'name' || typeof name.value !== 'string' || name.value.trim() === '') {
						refuseToSend('The create does not start with a display name.');
					}
					if (rest.some((property) => property.property_name === 'name')) refuseToSend('The create names the field twice.');
					checkProperties(rest);
				},
				async () => {
					const [name, ...properties] = payload.properties;
					const created = await client.createField(entityType, {
						dataType: payload.data_type,
						displayName: String(name?.value),
						properties: properties.map((property) => ({ property_name: property.property_name, value: property.value }))
					});
					return { name: created.name };
				}
			),
		updateField: (entityType, field, properties) =>
			guarded(
				() => {
					checkNames(entityType, field);
					if (properties.length === 0) refuseToSend('The update has no setting.');
					checkProperties(properties);
				},
				// No project: a schema update is for the site.
				() => client.updateField(entityType, field, properties.map((property) => ({ property_name: property.property_name, value: property.value })))
			),
		retireField: (entityType, field) =>
			guarded(
				() => checkNames(entityType, field),
				() => client.retireField(entityType, field)
			),
		reviveField: (entityType, field) =>
			guarded(
				() => checkNames(entityType, field),
				() => client.reviveField(entityType, field)
			)
	};
}

/**
 * The writer of one field's `visible` for one project (VIS-7). `project_id` goes in the body
 * (corpus finding 115). Without a project the site refuses the write, so none is sent without one.
 */
export function visibilityWriter(client: Pick<SchemaClient, 'updateField'>): VisibilityWriter {
	return {
		updateField: (entityType, field, properties: VisibleWrite, projectId) =>
			guarded(
				() => {
					checkNames(entityType, field);
					if (!Number.isInteger(projectId) || projectId <= 0) refuseToSend(`'${String(projectId)}' is not a project id.`);
					const [only] = properties;
					if (properties.length !== 1 || only?.property_name !== 'visible' || typeof only.value !== 'boolean') {
						refuseToSend('A visibility write carries visible alone, true or false.');
					}
				},
				() => client.updateField(entityType, field, [{ property_name: 'visible', value: properties[0].value }], projectId)
			)
	};
}

/** The reads of a run over the session's schema, each one past its cache (RUN-6, PLN-3, PLN-16). */
export function runReader(schema: Pick<LiveSchema, 'refreshEntityTypes' | 'refreshFields' | 'fieldForPlan'>): RunReader {
	return {
		entityTypes: () => schema.refreshEntityTypes(),
		fields: (entityType) => schema.refreshFields(entityType),
		field: (entityType, name) => schema.fieldForPlan(entityType, name)
	};
}

export interface SiteSchemaClient {
	/** The run's writes. */
	port: SchemaWritePort;
	/** The run's reads. */
	reader: RunReader;
	/** The writer `visibilityPort` takes. */
	visibilityWriter: VisibilityWriter;
}

/** Everything the install run needs to read and write one site's schema. */
export function siteSchemaClient(options: RestClientOptions, schema: Pick<LiveSchema, 'refreshEntityTypes' | 'refreshFields' | 'fieldForPlan'>): SiteSchemaClient {
	const client = new RestSchemaClient(options);
	return { port: schemaWritePort(client), reader: runReader(schema), visibilityWriter: visibilityWriter(client) };
}

/* The trash page for fields. */

/** What searches rows: core's client fits. */
export interface PageLister {
	search(entityType: string, options: SearchOptions): Promise<SearchResult>;
}

/** The `Page` row that lists retired fields (corpus finding 120). Its id differs per site. */
export const TRASH_PAGE_FILTERS = {
	logical_operator: 'and' as const,
	conditions: [
		['ui_category', 'is', 'trash'],
		['entity_type', 'is', 'DisplayColumn']
	] as [string, string, unknown][]
};

async function lookUpTrashPage(client: PageLister, siteUrl: string): Promise<{ url: string | null; failed: boolean }> {
	const origin = siteUrl.trim().replace(/\/+$/, '');
	if (origin === '') return { url: null, failed: false };
	try {
		const result = await client.search('Page', { filters: TRASH_PAGE_FILTERS, fields: ['name'], sort: 'id', page: { size: 1, number: 1 } });
		const id = result.data[0]?.id;
		// A site where nobody opened the field trash may have no row: the words say the menu path then.
		return { url: typeof id === 'number' && Number.isInteger(id) && id > 0 ? `${origin}/page/${id}` : null, failed: false };
	} catch {
		return { url: null, failed: true };
	}
}

/**
 * The address of the site's "Trash - Fields" page, `<site>/page/<id>`, or null when the site has
 * none or the lookup fails (RUN-21). A read. Never rejects.
 */
export async function readTrashPageUrl(client: PageLister, siteUrl: string): Promise<string | null> {
	return (await lookUpTrashPage(client, siteUrl)).url;
}

/** The same, looked up once a session. A lookup that failed is asked again the next time. */
export function createTrashPage(client: PageLister, siteUrl: string): () => Promise<string | null> {
	let held: Promise<{ url: string | null; failed: boolean }> | null = null;
	return async () => {
		const mine = (held ??= lookUpTrashPage(client, siteUrl));
		const answer = await mine;
		if (answer.failed && held === mine) held = null;
		return answer.url;
	};
}
