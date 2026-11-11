/**
 * The schema reads, through sg-widgets-core 0.3.1.
 *
 * The core client does the HTTP: the address, the bearer, the refusal. Its schema methods answer
 * a normalised field, though, and drop the wrapped record the snapshots need (gap W2). They also
 * look for the description among the properties, where the site does not put it. So each read
 * here runs through a core client whose `fetch` keeps a copy of the body, and answers that body.
 * No request is built here.
 *
 * Two things lean on how 0.3.1 behaves and not on what it promises:
 *
 * - The one-field read without a project. `fieldWithProject` asks for a project. It leaves a
 *   parameter out of the address when it is undefined, so it is called with none. A test here
 *   holds that.
 * - The body is listened to, not handed over.
 *
 * Both go when core ships its schema client (sg-widgets #357): its `readRawFields` and
 * `readField` answer what `SchemaSource` asks for.
 */
import { RestClient, SgApiError, type RestClientOptions } from 'sg-widgets-core';
import { isFieldMissing, type FieldReply } from '$lib/pure/live-field';
import type { SchemaSource } from './schema';

/** A name that is one path segment. Core puts it into the address as it is. */
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

/** The same refusal, saying what the site said. Core's own message is the title, "Not Found". */
function withDetail(error: unknown): unknown {
	if (!(error instanceof SgApiError)) return error;
	const detail = detailOf(error.body);
	return detail ? new SgApiError(error.status, error.body, detail) : error;
}

export function coreSchemaSource(options: RestClientOptions): SchemaSource {
	const send = options.fetch ?? globalThis.fetch.bind(globalThis);

	/** Runs one core read and answers the `data` the site sent for it. A client per read keeps two reads apart. */
	async function dataOf(read: (client: RestClient) => Promise<unknown>): Promise<unknown> {
		let body: unknown = null;
		const listen: typeof fetch = async (input, init) => {
			const response = await send(input, init);
			if (response.ok) body = await response.clone().json();
			return response;
		};
		await read(new RestClient({ ...options, fetch: listen }));
		return isRecord(body) ? (body['data'] ?? null) : null;
	}

	return {
		async readRawEntityTypes() {
			try {
				return await dataOf((client) => client.entityTypes());
			} catch (error) {
				throw withDetail(error);
			}
		},

		async readRawFields(entityType) {
			if (!NAME.test(entityType)) throw new Error(`'${entityType}' is not an entity type name.`);
			try {
				return await dataOf((client) => client.fields(entityType));
			} catch (error) {
				throw withDetail(error);
			}
		},

		async readField(entityType, field, projectId): Promise<FieldReply> {
			if (!NAME.test(entityType)) throw new Error(`'${entityType}' is not an entity type name.`);
			if (!NAME.test(field)) throw new Error(`'${field}' is not a field name.`);
			try {
				// Undefined leaves `project_id` out of the address in 0.3.1; the type asks for a number.
				const raw = await dataOf((client) => client.fieldWithProject(entityType, field, projectId as number));
				return raw === null ? { status: 'undeclared' } : { status: 'found', raw };
			} catch (error) {
				if (!(error instanceof SgApiError)) throw error;
				// Core throws a 200 for `data: null` on a field it has no override for.
				if (error.status === 200) return { status: 'undeclared' };
				const detail = detailOf(error.body);
				if (isFieldMissing(error.status, detail)) return { status: 'missing', message: detail ?? '' };
				throw withDetail(error);
			}
		}
	};
}
