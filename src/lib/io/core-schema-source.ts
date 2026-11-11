/**
 * The schema reads, through sg-widgets-core.
 *
 * Core does the HTTP: the address, the bearer, the refusal. The fields of a type and the one
 * field come from its `RestSchemaClient` (`readRawFields`, `readField`), which answers the
 * wrapped records the snapshots need. No request is built here.
 *
 * The type list has no raw read in core 0.4.0. `RestClient.entityTypes()` answers display names
 * only, so that one read runs through a core client whose `fetch` keeps a copy of the body, and
 * answers that body.
 *
 * "Does not exist" is core's `missing` result: a 404 whose detail reads `Field '<Type>.<field>'
 * does not exist.`, which is what `isFieldMissing` holds. A type the site does not have is a 404
 * too, saying `Entity type`, and stays a rejection (PLN-3).
 */
import { RestClient, RestSchemaClient, SchemaApiError, SgApiError, type RestClientOptions } from 'sg-widgets-core';
import { isFieldMissing, type FieldReply } from '$lib/pure/live-field';
import type { SchemaSource } from './schema';

/** A name that is one path segment. Refused before asking, so a bad name never reaches the site. */
const NAME = /^[A-Za-z0-9_]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The first error's `detail`: the line that says which name is wrong (corpus `findings/002`). */
function detailOf(body: unknown): string | null {
	const errors = isRecord(body) ? body['errors'] : null;
	const first: unknown = Array.isArray(errors) ? errors[0] : null;
	const detail = isRecord(first) ? first['detail'] : null;
	return typeof detail === 'string' && detail !== '' ? detail : null;
}

/** The same refusal, saying what the site said. `RestClient`'s own message is the title, "Not Found". */
function withDetail(error: unknown): unknown {
	if (!(error instanceof SgApiError)) return error;
	const detail = detailOf(error.body);
	return detail ? new SchemaApiError(error.status, error.body, detail) : error;
}

export function coreSchemaSource(options: RestClientOptions): SchemaSource {
	const send = options.fetch ?? globalThis.fetch.bind(globalThis);
	const schema = new RestSchemaClient(options);

	return {
		async readRawEntityTypes() {
			let body: unknown = null;
			const listen: typeof fetch = async (input, init) => {
				const response = await send(input, init);
				if (response.ok) body = await response.clone().json();
				return response;
			};
			try {
				// A client per read keeps two reads apart.
				await new RestClient({ ...options, fetch: listen }).entityTypes();
			} catch (error) {
				throw withDetail(error);
			}
			return isRecord(body) ? (body['data'] ?? null) : null;
		},

		async readRawFields(entityType) {
			if (!NAME.test(entityType)) throw new Error(`'${entityType}' is not an entity type name.`);
			return schema.readRawFields(entityType);
		},

		async readField(entityType, field, projectId): Promise<FieldReply> {
			if (!NAME.test(entityType)) throw new Error(`'${entityType}' is not an entity type name.`);
			if (!NAME.test(field)) throw new Error(`'${field}' is not a field name.`);
			const read = await schema.readField(entityType, field, projectId);
			if (read.status === 'found') return { status: 'found', raw: read.raw };
			if (read.status === 'undeclared') return { status: 'undeclared' };
			// Core's message is the site's detail. Held to this app's rule all the same, so the two never drift.
			if (isFieldMissing(404, read.message)) return { status: 'missing', message: read.message };
			throw new SchemaApiError(404, null, read.message);
		}
	};
}
