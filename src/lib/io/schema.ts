/**
 * The site's schema for one session: what is read, and what is kept.
 *
 * Thin. The reading of a response is in `$lib/pure/live-entity-types` and `$lib/pure/live-field`.
 * This holds the calls and the cache.
 *
 * Kept in memory for the life of the object, one per connected site (D6):
 *
 * - The entity type list, read once (CMP-1). It is small and cheap (corpus `endpoints/get_schema`).
 * - Each type's fields, read once per type, only for the types asked for (CMP-2, CMP-4). This is
 *   the expensive call, about 48 KB and 330 ms a type, so it is never looped over the type list
 *   (corpus `findings/002`).
 *
 * Two callers asking for the same thing at once share one request. A failed read is not kept: the
 * next ask reads again. The one failure kept is a 404, the site saying it does not have the type,
 * since that is an answer. `refresh...` and `clear` read again whatever is held.
 *
 * Two paths that must not be mixed up:
 *
 * - `fieldsOrEmpty` is for the advisory comparison and the import. It never throws; a type that
 *   cannot be read has no fields (CMP-2, IMP-16).
 * - `fieldForPlan` is for the install plan and the run. It reads one field from the site every
 *   time, answers "absent" as a value, and throws every other failure (PLN-3, PLN-4).
 */
import { readEntityTypes, type LiveEntityType } from '$lib/pure/live-entity-types';
import { readFieldReply, readFields, type FieldReply, type LiveField, type LiveFieldRead } from '$lib/pure/live-field';

/**
 * The types whose fields are read ahead (SET-25), in the order the import's inference tries them
 * (IMP-15). Fixed: the warm-up never reads every type (SET-26).
 */
export const COMMON_ENTITY_TYPES = ['Shot', 'Asset', 'Sequence', 'Task', 'Version', 'Note', 'Project'] as const;

/**
 * The three reads, as raw as the site sends them. `readField` and `readRawFields` are named and
 * shaped after the schema client sg-widgets-core is growing (sg-widgets #357), so that client can
 * stand in here once it ships.
 */
export interface SchemaSource {
	/** The `data` of `GET /schema`: one entry per type, keyed by API name. */
	readRawEntityTypes(): Promise<unknown>;
	/** The `data` of `GET /schema/<Type>/fields`: one wrapped record per field, keyed by programmatic name. Rejects when the type cannot be read. */
	readRawFields(entityType: string): Promise<unknown>;
	/**
	 * `GET /schema/<Type>/fields/<field>`, at site scope or at a project's. A field that does not
	 * exist is the `missing` reply. Every other failure rejects, a type the site does not have
	 * included.
	 */
	readField(entityType: string, field: string, projectId?: number): Promise<FieldReply>;
}

export interface LiveSchema {
	/** The site's entity types, in the listing's order. Read once (CMP-1). Rejects when the read fails. */
	entityTypes(): Promise<readonly LiveEntityType[]>;
	/** The type list if it is held, else null. Never reads. */
	cachedEntityTypes(): readonly LiveEntityType[] | null;
	/** Reads the type list again and keeps the new one: the re-check of CMP-10. Rejects when the read fails. */
	refreshEntityTypes(): Promise<readonly LiveEntityType[]>;

	/**
	 * A type's fields, in the listing's order. Read once per type. **Rejects** when the type cannot
	 * be read. For a caller that shows the failure, such as the reference panel (EDT-21).
	 */
	fields(entityType: string): Promise<readonly LiveField[]>;
	/**
	 * The same read and the same cache as `fields`, for the comparison and the import. **Never
	 * rejects**: a type that cannot be read has no fields (CMP-2, IMP-16). Not for the plan.
	 */
	fieldsOrEmpty(entityType: string): Promise<readonly LiveField[]>;
	/** A type's fields if they are held, else null. Never reads (CMP-11). */
	cachedFields(entityType: string): readonly LiveField[] | null;
	/** Reads a type's fields again, past the cache, and keeps the new ones (D6). Rejects when the read fails. */
	refreshFields(entityType: string): Promise<readonly LiveField[]>;

	/**
	 * One field, read from the site every time, never from the cache: the plan's read (PLN-3).
	 * "Does not exist" and "no usable data type" answer `absent` (PLN-4). **Every other failure
	 * rejects** and must never be taken for absent. With a project the read is at that project's
	 * scope; only hidden values were seen to differ there (corpus `findings/009`).
	 */
	fieldForPlan(entityType: string, name: string, projectId?: number): Promise<LiveFieldRead>;

	/**
	 * Starts reading the fields of `COMMON_ENTITY_TYPES` in the background (SET-25, SET-26). Best
	 * effort: the promise resolves when the reads have settled and never rejects. Nobody has to
	 * wait on it.
	 */
	warmUp(): Promise<void>;
	/** Forgets everything held, so the next asks read the site again (D6, the install screen's refresh). */
	clear(): void;
}

interface Held<T> {
	promise: Promise<T>;
	/** Set once the read has answered. */
	value: T | null;
}

/** A source that throws before it returns a promise is a failed read like any other. */
function attempt<T>(read: () => Promise<T>): Promise<T> {
	try {
		return Promise.resolve(read());
	} catch (error) {
		return Promise.reject(error);
	}
}

/** The site saying it does not have the thing. An answer, where any other failure is not one. */
function isNotFound(error: unknown): boolean {
	return error !== null && typeof error === 'object' && (error as { status?: unknown }).status === 404;
}

export function createLiveSchema(source: SchemaSource): LiveSchema {
	let types: Held<readonly LiveEntityType[]> | null = null;
	const byType = new Map<string, Held<readonly LiveField[]>>();

	function loadTypes(): Held<readonly LiveEntityType[]> {
		const held: Held<readonly LiveEntityType[]> = { value: null, promise: Promise.resolve([]) };
		held.promise = attempt(() => source.readRawEntityTypes()).then(
			(data) => (held.value = Object.freeze(readEntityTypes(data))),
			(error: unknown) => {
				if (types === held) types = null;
				throw error;
			}
		);
		types = held;
		return held;
	}

	function loadFields(entityType: string): Held<readonly LiveField[]> {
		const held: Held<readonly LiveField[]> = { value: null, promise: Promise.resolve([]) };
		held.promise = attempt(() => source.readRawFields(entityType)).then(
			(data) => (held.value = Object.freeze(readFields(entityType, data))),
			(error: unknown) => {
				// A newer read may have taken this type's place: leave that one alone.
				if (!isNotFound(error) && byType.get(entityType) === held) byType.delete(entityType);
				throw error;
			}
		);
		byType.set(entityType, held);
		return held;
	}

	function fields(entityType: string): Promise<readonly LiveField[]> {
		return (byType.get(entityType) ?? loadFields(entityType)).promise;
	}

	function fieldsOrEmpty(entityType: string): Promise<readonly LiveField[]> {
		return fields(entityType).catch(() => []);
	}

	return {
		entityTypes: () => (types ?? loadTypes()).promise,
		cachedEntityTypes: () => types?.value ?? null,
		refreshEntityTypes: () => loadTypes().promise,

		fields,
		fieldsOrEmpty,
		cachedFields: (entityType) => byType.get(entityType)?.value ?? null,
		refreshFields: (entityType) => loadFields(entityType).promise,

		async fieldForPlan(entityType, name, projectId) {
			return readFieldReply(entityType, name, await source.readField(entityType, name, projectId));
		},

		async warmUp() {
			await Promise.all(COMMON_ENTITY_TYPES.map((entityType) => fieldsOrEmpty(entityType)));
		},

		clear() {
			types = null;
			byType.clear();
		}
	};
}
