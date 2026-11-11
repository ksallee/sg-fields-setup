/**
 * The import's reads of the site (IMP-15, IMP-16, IMP-29). Thin: which types are read is decided
 * in `$lib/pure/import-build`; this makes the calls, through a `LiveSchema`, so the cache and the
 * shared requests are its own.
 *
 * Both go through `fieldsOrEmpty`: a type whose fields cannot be read has none (IMP-16). The type
 * list is the one read that can fail the import, and it does so as a value.
 */
import { COMMON_ENTITY_TYPES } from '$lib/pure/common-entity-types';
import { resolvedEntityTypes, type ImportBucket, type ImportSite } from '$lib/pure/import-build';
import type { ImportMode } from '$lib/pure/import-entity-type';
import type { LiveField } from '$lib/pure/live-field';
import type { LiveSchema } from './schema';

async function fieldsOf(schema: Pick<LiveSchema, 'fieldsOrEmpty'>, types: readonly string[]): Promise<Map<string, readonly LiveField[]>> {
	return new Map(await Promise.all(types.map(async (type) => [type, await schema.fieldsOrEmpty(type)] as const)));
}

/** The fields of the common types, for the inferred fallbacks (IMP-15, IMP-16). Never rejects. */
export function commonFields(schema: Pick<LiveSchema, 'fieldsOrEmpty'>): Promise<Map<string, readonly LiveField[]>> {
	return fieldsOf(schema, COMMON_ENTITY_TYPES);
}

/**
 * The connected site as the build needs it: its types, and the fields of the types this import
 * resolves to and no others (IMP-29). Null when the type list cannot be read.
 */
export async function readImportSite(
	schema: Pick<LiveSchema, 'entityTypes' | 'fieldsOrEmpty'>,
	url: string,
	buckets: readonly ImportBucket[],
	mode: ImportMode,
	delimiter: string
): Promise<ImportSite | null> {
	const entityTypes = await schema.entityTypes().catch(() => null);
	if (entityTypes === null) return null;
	return { url, entityTypes, fieldsByType: await fieldsOf(schema, resolvedEntityTypes(buckets, mode, delimiter, entityTypes)) };
}
