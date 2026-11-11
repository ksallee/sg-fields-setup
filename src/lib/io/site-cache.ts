/**
 * When what the app holds of a site is dropped (audit finding 1).
 *
 * Two caches hold a site's schema for the life of the page: the app's `LiveSchema`
 * (`$lib/io/schema`), which the editor's comparison and the import read, and the widgets'
 * context (`SgContext` of sg-widgets-core), which the pickers read. Neither hears of a write by
 * itself. These are the three moments they are told:
 *
 * | when                                         | call                 | drops                         |
 * |----------------------------------------------|----------------------|-------------------------------|
 * | a run ended, however it ended; Refresh       | `afterSiteWrite`     | both, whole                   |
 * | "Re-sync from site" in the editor (EDT-42)   | `freshFieldsOrEmpty` | the listings of the types asked|
 * | "Re-check" of a missing type (CMP-10)        | `recheckEntityTypes` | the type list, and the widgets'|
 *
 * Each takes the caches it works on, so a test hands it its own.
 */
import type { SgContext } from 'sg-widgets-core';
import type { LiveEntityType } from '$lib/pure/live-entity-types';
import type { LiveField } from '$lib/pure/live-field';
import type { LiveSchema } from './schema';

/** What of the widgets' context a cache drop touches. `SgContext` fits. */
export type WidgetCaches = Pick<SgContext, 'invalidate' | 'schema' | 'statuses'>;

/**
 * Call when a write to the site may have happened: a run that finished, was cancelled or failed.
 * Also the install screen's Refresh. The app's schema cache is emptied and the widgets' context
 * invalidated, so the next read of either goes to the site. `context` is null where there are no
 * widgets on the live site to tell, as on the fake site.
 */
export function afterSiteWrite(caches: { schema: Pick<LiveSchema, 'clear'>; context: Pick<SgContext, 'invalidate'> | null }): void {
	caches.schema.clear();
	caches.context?.invalidate();
}

/**
 * The fields of each type, read from the site now, past the cache, and kept (EDT-42). Never
 * rejects: a type that cannot be read has no fields, as `fieldsOrEmpty` has it (CMP-2).
 */
export async function freshFieldsOrEmpty(schema: Pick<LiveSchema, 'refreshFields'>, types: readonly string[]): Promise<Map<string, readonly LiveField[]>> {
	const lists = await Promise.all(types.map((type) => schema.refreshFields(type).catch((): readonly LiveField[] => [])));
	return new Map(types.map((type, index) => [type, lists[index]]));
}

/**
 * The re-check of CMP-10: reads the type list again, then invalidates the widgets' context. The
 * field listings stay: the comparison reads them (CMP-11).
 *
 * A picker that is already on screen read its list once and keeps it, whatever the cache does.
 * So the context comes back under a new identity, with its `schema` and `statuses` services
 * copied: the same calls on the same caches, but a picker handed it reads again, and a type just
 * enabled shows with no reload. Rejects when the read fails, and then nothing is dropped.
 */
export async function recheckEntityTypes<C extends WidgetCaches>(caches: {
	schema: Pick<LiveSchema, 'refreshEntityTypes'>;
	context: C | null;
}): Promise<{ entityTypes: readonly LiveEntityType[]; context: C | null }> {
	const entityTypes = await caches.schema.refreshEntityTypes();
	const context = caches.context;
	if (context === null) return { entityTypes, context: null };
	context.invalidate();
	return { entityTypes, context: { ...context, schema: { ...context.schema }, statuses: { ...context.statuses } } };
}
