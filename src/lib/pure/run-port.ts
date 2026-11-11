/**
 * What the install run needs from a site: four writes and three reads, and how it reads their
 * answers (specs/08-install-run.md, corpus findings 040, 116, 119).
 *
 * The run never imports a client. It is handed these two interfaces:
 *
 * - `SchemaWritePort`: the only calls that change a site. sg-widgets core's `SchemaClient` fits
 *   after a few lines of adapting (issue #18):
 *
 *   ```ts
 *   const port: SchemaWritePort = {
 *   	createField: (type, payload) => {
 *   		const [name, ...properties] = payload.properties; // `name` is always first (PLN-13)
 *   		return client.createField(type, { dataType: payload.data_type, displayName: String(name.value), properties });
 *   	},
 *   	updateField: (type, field, properties) => client.updateField(type, field, [...properties]),
 *   	retireField: (type, field) => client.retireField(type, field),
 *   	reviveField: (type, field) => client.reviveField(type, field)
 *   };
 *   ```
 *
 * - `RunReader`: the reads, each one fresh from the site. `LiveSchema` fits: `refreshEntityTypes`,
 *   `refreshFields` and `fieldForPlan`.
 *
 * A refusal is whatever the port throws that has a numeric `status` and a `message`
 * (`SchemaApiError` does). Anything else thrown is not the site's answer: the connection dropped,
 * or something broke. The run tells the two apart (RUN-16, RUN-17).
 */
import type { LiveEntityType } from './live-entity-types';
import type { LiveField, LiveFieldRead } from './live-field';
import type { CreatePayload, PropertyWrite } from './plan';

/** What a revive answered. `revived: false` carries the server's refusal. */
export type ReviveAnswer = { revived: true } | { revived: false; status: number; message: string };

/** The four schema writes. Each rejects with a `PortRefusal` when the site refuses. */
export interface SchemaWritePort {
	/**
	 * `POST /schema/<Type>/fields` with the payload as planned. Answers the programmatic name the
	 * server assigned: the last segment of the response's `links.self` (RUN-11).
	 */
	createField(entityType: string, payload: CreatePayload): Promise<{ name: string }>;
	/** `PUT /schema/<Type>/fields/<field>` with these properties. The answer is not read: it proves nothing (RUN-15). */
	updateField(entityType: string, field: string, properties: readonly PropertyWrite[]): Promise<unknown>;
	/** `DELETE /schema/<Type>/fields/<field>`. Spends the name for good. */
	retireField(entityType: string, field: string): Promise<void>;
	/**
	 * `POST /schema/<Type>/fields/<field>` with `{revive: true}`. A refusal of the revive itself may
	 * come back as `revived: false` or be thrown: the run handles both.
	 */
	reviveField(entityType: string, field: string): Promise<ReviveAnswer>;
}

/** The reads of a run. Every call reads the site: no cache (RUN-6). Each rejects when the read fails. */
export interface RunReader {
	/** The site's entity types (PLN-14). */
	entityTypes(): Promise<readonly LiveEntityType[]>;
	/** Every live field of a type (PLN-16). */
	fields(entityType: string): Promise<readonly LiveField[]>;
	/** One field. "Does not exist" is the `absent` value; every other failure rejects (PLN-3). */
	field(entityType: string, name: string): Promise<LiveFieldRead>;
}

/** A refusal as the run reads it. Structural: no class is asked for. */
export interface PortRefusal {
	status: number;
	message: string;
	/** The first error's `source`, when the server sent one. */
	source?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The thrown value as a refusal, or null when it is not one: no numeric status, so not the site's answer. */
export function asRefusal(error: unknown): PortRefusal | null {
	if (!isRecord(error) && !(error instanceof Error)) return null;
	const loose = error as { status?: unknown; message?: unknown; source?: unknown };
	if (typeof loose.status !== 'number' || !Number.isFinite(loose.status)) return null;
	return { status: loose.status, message: typeof loose.message === 'string' ? loose.message : '', source: loose.source };
}

/** What a thrown value says, as text. */
export function errorMessage(error: unknown): string {
	if (error instanceof Error && error.message !== '') return error.message;
	if (isRecord(error) && typeof error['message'] === 'string' && error['message'] !== '') return error['message'];
	if (typeof error === 'string' && error !== '') return error;
	return 'Unknown error.';
}

const RETIRED_NAME = /retired field with the same field_name:\s*([A-Za-z0-9_]+)/;

function sourceFieldName(source: unknown): string | null {
	if (!isRecord(source) || !('field_name' in source)) return null;
	const value = source['field_name'];
	const texts = (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === 'string');
	return texts.join(' ');
}

/**
 * Whether a create was refused because a retired field holds the name: the only create error with
 * `source.field_name`, and its title says "a retired field with the same field_name" (corpus
 * finding 119). Either sign is enough: a proxy may drop the source and keep the words.
 */
export function isRetiredNameRefusal(refusal: PortRefusal): boolean {
	return sourceFieldName(refusal.source) !== null || RETIRED_NAME.test(refusal.message);
}

/** The programmatic name the refusal says is retired, or null when it names none. */
export function retiredNameIn(refusal: PortRefusal): string | null {
	const fromSource = RETIRED_NAME.exec(sourceFieldName(refusal.source) ?? '');
	return (fromSource ?? RETIRED_NAME.exec(refusal.message))?.[1] ?? null;
}

/**
 * What a revive's answer means. Only the three measured answers are read (corpus finding 119):
 *
 * | answer                                                | reading           |
 * |-------------------------------------------------------|-------------------|
 * | 204                                                   | `revived`         |
 * | 404 `Retired field <Type>.<name> does not exist.`     | `nothing-retired` |
 * | 400 `Field <Type>.<name> is not retired.`             | `already-live`    |
 * | anything else                                         | `unknown`         |
 *
 * `nothing-retired` is the one answer that lets a create follow, so it is read strictly: the
 * status, the words and the field's own name must all be there. A 404 that says anything else (a
 * type the site lacks, a proxy's own 404) is `unknown`, and the run fails the item without
 * creating. Creating after a misread revive is how a name gets spent. The type's spelling is not
 * checked: the server spells some types in snake case (corpus finding 118).
 */
export type ReviveReading = 'revived' | 'nothing-retired' | 'already-live' | 'unknown';

export function readRevive(answer: ReviveAnswer, name: string): ReviveReading {
	if (answer.revived) return 'revived';
	const message = answer.message;
	if (answer.status === 404 && message.startsWith('Retired field ') && message.includes(`.${name} does not exist`)) {
		return 'nothing-retired';
	}
	if (answer.status === 400 && message.startsWith('Field ') && message.includes(`.${name} is not retired`)) {
		return 'already-live';
	}
	return 'unknown';
}
