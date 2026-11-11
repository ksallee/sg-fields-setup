/**
 * One field of the site's schema, as the rest of the app reads it.
 *
 * A field's record comes from `GET /schema/<Type>/fields` (keyed by programmatic name) or from
 * `GET /schema/<Type>/fields/<field>`. Every value in it is wrapped: `{value, editable}`, where
 * `editable` says whether that setting may be changed (corpus `endpoints/get_schema_type_fields`).
 *
 * Where each attribute is read from. Every position is stated by the corpus and was seen on a live
 * site (2026-11-10: all 71 fields of Version and all 26 of a custom entity, each value wrapped).
 *
 * | attribute    | position                         | corpus                                         |
 * |--------------|----------------------------------|------------------------------------------------|
 * | dataType     | `data_type.value`                | sample, `endpoints/get_schema_type_fields`     |
 * | displayName  | `name.value`                     | sample, same card                              |
 * | unique       | `unique.value`                   | sample, same card                              |
 * | description  | `description.value`              | key list, `findings/056`, `findings/009`       |
 * | defaultValue | `properties.default_value.value` | sample, same card                              |
 * | validValues  | `properties.valid_values.value`  | `findings/009`, `findings/field_types/list`    |
 * | validTypes   | `properties.valid_types.value`   | `findings/field_types/multi_entity`            |
 * | hideable     | `visible.editable`               | `findings/056`                                 |
 *
 * So PLN-6 holds: description and unique sit beside the data type; default value, valid values
 * and valid types sit among the properties. One thing was not seen anywhere: a unique flag that
 * reads true. The position is sure, a true value in it is not yet.
 *
 * The reading is defensive all the same. A missing key, a null or a value of the wrong kind reads
 * as none, never as a throw. A value that came bare, without its wrapper, is taken as the value.
 */

/** A field's schema record exactly as the site sent it. */
export type RawFieldRecord = Record<string, unknown>;

export interface LiveField {
	/** API name of the type the field was read on. */
	entityType: string;
	/** Programmatic name: the key in the listing, or the name the one-field read asked for. */
	name: string;
	/**
	 * Data type exactly as read. Authoritative even when the app has never heard of it (MOD-16).
	 * Never empty: a record with no data type is not a field (PLN-4).
	 */
	dataType: string;
	/** Display name as read, not trimmed. Comparing trims (CMP-6, PLN). '' when the record has none. */
	displayName: string;
	/** '' when the record has none. */
	description: string;
	/** Null when the record has none. Otherwise as read, of whatever kind. */
	defaultValue: unknown;
	/** In the site's order. Empty when the record has none (PLN-11). */
	validValues: string[];
	/** In the site's order. Empty when the record has none (PLN-11). */
	validTypes: string[];
	/** Missing means off (PLN-6). */
	unique: boolean;
	/**
	 * Whether the site may hide the field: `visible.editable`. The one fact the stock versus custom
	 * rule reads (corpus `findings/056`). Null when the record says nothing.
	 */
	hideable: boolean | null;
	/** The record verbatim, the same object that was read. For snapshots (W2). Do not change it. */
	raw: RawFieldRecord;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The value of a wrapped setting. A setting that came bare is its own value. */
function unwrap(setting: unknown): unknown {
	return isRecord(setting) && 'value' in setting ? setting['value'] : setting;
}

function text(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * One record as a live field. Null when the record is not an object or has no usable data type:
 * only an empty or missing type is "no type" (MOD-16), and a field without one counts as absent
 * (PLN-4).
 */
export function readField(entityType: string, name: string, record: unknown): LiveField | null {
	if (!isRecord(record)) return null;
	const dataType = text(unwrap(record['data_type']));
	if (dataType.trim() === '') return null;
	const properties = isRecord(record['properties']) ? record['properties'] : {};
	const visible = record['visible'];
	const hideable = isRecord(visible) && typeof visible['editable'] === 'boolean' ? visible['editable'] : null;
	return {
		entityType,
		name,
		dataType,
		displayName: text(unwrap(record['name'])),
		description: text(unwrap(record['description'])),
		defaultValue: unwrap(properties['default_value']) ?? null,
		validValues: strings(unwrap(properties['valid_values'])),
		validTypes: strings(unwrap(properties['valid_types'])),
		unique: unwrap(record['unique']) === true,
		hideable,
		raw: record
	};
}

/**
 * Every field of a type, in the listing's order. `data` is the `data` of
 * `GET /schema/<Type>/fields`. A record with no data type is left out, as the one-field read
 * counts it absent (PLN-4). Anything that is not an object reads as no fields.
 */
export function readFields(entityType: string, data: unknown): LiveField[] {
	if (!isRecord(data)) return [];
	const fields: LiveField[] = [];
	for (const [name, record] of Object.entries(data)) {
		const field = readField(entityType, name, record);
		if (field) fields.push(field);
	}
	return fields;
}

/* Stock versus custom. */

/**
 * Whether the field counts as custom: the site may hide it (EDT-21, corpus `findings/056`).
 *
 * The name prefix decides nothing (B6). The rule is a strong hint and not a proof. Every custom
 * field reads true. A few stock fields do too: on the probed site `Project.code` and
 * `platform_status` on Version and Shot. Nothing in the schema names where a field came from. A
 * record that says nothing counts as stock.
 */
export function isCustomField(field: LiveField): boolean {
	return field.hideable === true;
}

function byDisplayName(a: LiveField, b: LiveField): number {
	const order = a.displayName.trim().localeCompare(b.displayName.trim(), 'en', { sensitivity: 'base' });
	if (order !== 0) return order;
	return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * A type's fields as custom and stock, each sorted by display name (EDT-21): trimmed, without
 * case, then by programmatic name, since a display name identifies nothing (corpus
 * `findings/019`). The list given is left as it was.
 */
export function splitFields(fields: readonly LiveField[]): { custom: LiveField[]; stock: LiveField[] } {
	const custom: LiveField[] = [];
	const stock: LiveField[] = [];
	for (const field of fields) (isCustomField(field) ? custom : stock).push(field);
	return { custom: custom.sort(byDisplayName), stock: stock.sort(byDisplayName) };
}

/* One field, read for the plan. */

/**
 * What a read of one field answered, before it is judged. The shape a schema source hands over:
 *
 * - `found`: 200 with a record.
 * - `missing`: the 404 `Field '<Type>.<field>' does not exist.`
 * - `undeclared`: 200 with `data: null`. The row answers the field and the schema leaves it out
 *   (corpus `endpoints/get_schema_type_fields_field`).
 *
 * Any other outcome is not a reply. It is an error, and the source throws it.
 */
export type FieldReply = { status: 'found'; raw: unknown } | { status: 'missing'; message: string } | { status: 'undeclared' };

/**
 * One field read for the plan (PLN-3, PLN-4). `absent` is a value of its own. A failed read is
 * never one of these: it throws.
 */
export type LiveFieldRead =
	| { kind: 'present'; field: LiveField }
	| {
			kind: 'absent';
			/**
			 * - `does-not-exist`: the site said so. A retired field and a name never used read the same
			 *   (PLN-5).
			 * - `no-data-type`: a record came back with no usable data type (PLN-4).
			 * - `undeclared`: 200 with no record. No data type either, so absent by PLN-4. The name may
			 *   still be taken by a field the schema does not declare.
			 */
			reason: 'does-not-exist' | 'no-data-type' | 'undeclared';
			/** The site's own words when it gave any, else a plain line. */
			message: string;
	  };

const FIELD_MISSING = /^Field '[^']+' does not exist/;

/**
 * Whether a refusal is the one that means "this field does not exist": a 404 whose detail reads
 * `Field 'Version.sg_not_a_field' does not exist.` (corpus `endpoints/get_schema_type_fields_field`).
 * A 404 for a type the site does not have reads `Entity type 'X' does not exist.` and is not it.
 * No other failure is (PLN-3).
 */
export function isFieldMissing(status: number, detail: string | null | undefined): boolean {
	return status === 404 && typeof detail === 'string' && FIELD_MISSING.test(detail);
}

export function readFieldReply(entityType: string, name: string, reply: FieldReply): LiveFieldRead {
	if (reply.status === 'missing') return { kind: 'absent', reason: 'does-not-exist', message: reply.message };
	if (reply.status === 'undeclared') {
		return { kind: 'absent', reason: 'undeclared', message: `The schema does not declare ${entityType}.${name}.` };
	}
	const field = readField(entityType, name, reply.raw);
	if (field) return { kind: 'present', field };
	return { kind: 'absent', reason: 'no-data-type', message: `${entityType}.${name} came back with no data type.` };
}
