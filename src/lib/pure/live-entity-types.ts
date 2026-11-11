/**
 * The site's entity types, read from `GET /schema`.
 *
 * The listing is keyed by API name. Each entry holds the display name as a wrapped value:
 * `data.Version.name.value` (corpus `endpoints/get_schema`). Presence in the listing is the
 * enabled test, in both directions: a custom entity slot that is not listed answers 404 everywhere
 * else. `visible` is not the test, it read true on every listed type (corpus `findings/008`).
 */

export interface LiveEntityType {
	/** API name, the one a URL takes: `Version`, `CustomEntity19`. */
	name: string;
	/**
	 * Display name, trimmed: a site may store a trailing space (corpus `findings/008`). The API
	 * name when the listing carries none.
	 */
	displayName: string;
	/**
	 * A custom entity slot, by its API name: `CustomEntityNN`, `CustomNonProjectEntityNN`,
	 * `CustomThreadedEntityNN`. Being listed is what makes it enabled. A slot's connection type
	 * (`CustomEntity29_sg_scene_Connection`) is not a slot.
	 */
	custom: boolean;
}

const CUSTOM_SLOT = /^Custom(?:NonProject|Threaded)?Entity\d+$/;

export function isCustomEntityName(name: string): boolean {
	return CUSTOM_SLOT.test(name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The types of a listing, in the listing's order. `data` is the `data` of `GET /schema`.
 * Anything that is not an object reads as no types.
 */
export function readEntityTypes(data: unknown): LiveEntityType[] {
	if (!isRecord(data)) return [];
	return Object.entries(data).map(([name, entry]) => {
		const wrapped = isRecord(entry) ? entry['name'] : undefined;
		const value = isRecord(wrapped) ? wrapped['value'] : wrapped;
		const displayName = typeof value === 'string' ? value.trim() : '';
		return { name, displayName: displayName || name, custom: isCustomEntityName(name) };
	});
}

/** The display name for an API name. Null when the site does not have the type. */
export function entityTypeDisplayName(types: readonly LiveEntityType[], name: string): string | null {
	return types.find((type) => type.name === name)?.displayName ?? null;
}

/** Whether the type is on the site. The API name is matched exactly, case included. */
export function hasEntityType(types: readonly LiveEntityType[], name: string): boolean {
	return types.some((type) => type.name === name);
}
