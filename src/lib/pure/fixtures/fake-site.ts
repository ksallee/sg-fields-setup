/**
 * Test helper: a site's schema endpoints in memory, answering as the corpus measured them. The
 * install run is tested against this and nothing else, so it follows the findings line by line
 * and guesses nothing. Where a behaviour was not measured the comment says so.
 *
 * What it models (corpus findings 019, 040, 115, 116, 117, 118, 119 and the endpoint cards):
 *
 * - Fields per entity type, live or retired. A retired field is a 404 to read, update and retire.
 * - Create: the name comes from the display name (`predictFieldName` with the data type), is only in `links.self`,
 *   and gets `_1`, `_2` when a live field has it. A retired field with the name is the 400 code
 *   105 with `source.field_name`. The per-type requirements of a create are enforced.
 * - Update: `{property_name, value}` writes with the refusals of findings 116 and 121. A request
 *   is checked whole, against the state it would leave, and applied whole or not at all. An
 *   empty or blank value is refused. Repeats are dropped from a list's values and from valid
 *   types, and kept on a status list.
 * - Valid types: an unknown entity type is a 400. A type in the wrong case (`shot`) is a 500 that
 *   leaves the field retired and broken (finding 121).
 * - Reverse fields (findings 116 and 121): an entity or a multi-entity link holds a field on each
 *   of its valid types. Creating the link makes them. Adding a type to an entity link makes one,
 *   removing a type retires it, and its name stays taken: adding the type back makes a new field
 *   under the next name. Retiring or reviving the link retires or revives them with it. A write
 *   that only reorders makes nothing. `reverseFields` shows them to a test.
 * - Status codes: a status list's values and default must be codes the site has (findings 116 and
 *   121). The site has `DEFAULT_STATUSES` unless a test gives it others.
 * - Retire: 204, and the name stays taken.
 * - Revive: 204 on a retired field, which returns with its settings and visible in every project;
 *   404 `Retired field <Type>.<name> does not exist.` on a name never used; 400
 *   `Field <Type>.<name> is not retired.` on a live field.
 * - `visible` per project: read with a project, written only with one.
 *
 * What a test adds: seeded fields, refusals and dropped connections on the next call, a write
 * that answers success and does nothing, a hook before a call, and the log of every call.
 *
 * The object is a `SchemaWritePort` as it stands, and its three reads have the shape of
 * `SchemaSource` (`src/lib/io/schema.ts`). `reader()` gives the run's `RunReader`.
 */
import { readEntityTypes } from '../live-entity-types';
import { readFieldReply, readFields, type FieldReply } from '../live-field';
import { predictFieldName } from '../field-name';
import type { CreatePayload, PropertyWrite } from '../plan';
import type { ReviveAnswer, RunReader, SchemaWritePort } from '../run-port';
import { isRecord } from '../is-record';

export const FAKE_OPS = [
	'readRawEntityTypes',
	'readRawFields',
	'readField',
	'createField',
	'updateField',
	'retireField',
	'reviveField'
] as const;

export type FakeOp = (typeof FAKE_OPS)[number];

/** The calls that change the site. */
export const FAKE_WRITES: readonly FakeOp[] = ['createField', 'updateField', 'retireField', 'reviveField'];

/** A field's settings when a test seeds one. Everything has a default. */
export interface FakeFieldSettings {
	dataType?: string;
	displayName?: string;
	description?: string;
	defaultValue?: unknown;
	validValues?: string[];
	validTypes?: string[];
	unique?: boolean;
	/** A stock field: the site may not hide it (`visible.editable` false, corpus finding 056). */
	stock?: boolean;
	/** The projects where it is hidden. */
	hiddenIn?: number[];
}

/** A field as the fake holds it, for a test to look at. A copy: changing it changes nothing. */
export interface FakeField {
	entityType: string;
	name: string;
	dataType: string;
	displayName: string;
	description: string;
	defaultValue: unknown;
	validValues: string[] | null;
	validTypes: string[] | null;
	unique: boolean;
	stock: boolean;
	retired: boolean;
	/** True after the wrong-case valid type's 500: retired, and not known to come back (corpus finding 121). */
	broken: boolean;
	hiddenIn: number[];
	/** For a reverse field: the link it is the other side of. Null for every other field. */
	reverseOf: { entityType: string; name: string } | null;
}

/** One call, as the log keeps it. */
export interface FakeCall {
	/** 1 for the first call. */
	seq: number;
	op: FakeOp;
	/** Whether the call is one of `FAKE_WRITES`. */
	write: boolean;
	entityType: string | null;
	field: string | null;
	projectId: number | null;
	/** What was sent: the create payload or the update's properties. Null for the others. */
	body: unknown;
	/**
	 * `ok`: answered. `refused`: an error status. `dropped`: no answer came back. `ignored`: answered
	 * success and did nothing. `pending` while in flight.
	 */
	outcome: 'pending' | 'ok' | 'refused' | 'dropped' | 'ignored';
	/** The error status of a refusal, else null. */
	status: number | null;
	/** For a create that answered: the name the server gave. */
	created: string | null;
	/** True when another write was in flight at any moment of this write. */
	overlapped: boolean;
}

/** A refusal, shaped like sg-widgets core's `SchemaApiError`. */
export class FakeSiteError extends Error {
	readonly status: number;
	readonly code: number | null;
	readonly title: string | null;
	readonly detail: string | null;
	readonly source: unknown;
	readonly body: unknown;

	constructor(status: number, error: { code?: number; title?: string; detail?: string; source?: unknown; message?: string }) {
		const title = error.title ?? null;
		const detail = error.detail ?? null;
		const said = detail ?? title;
		const extra = sourceTexts(error.source).filter((text) => !said?.includes(text));
		super(error.message ?? ([said, ...extra].filter((text) => text).join(' ') || `Flow PT API error ${status}`));
		this.name = 'FakeSiteError';
		this.status = status;
		this.code = error.code ?? null;
		this.title = title;
		this.detail = detail;
		this.source = error.source ?? null;
		this.body = {
			errors: [{ status, code: this.code, title, detail, source: this.source, meta: null }]
		};
	}
}

function sourceTexts(source: unknown): string[] {
	if (source === null || typeof source !== 'object') return [];
	return Object.values(source as Record<string, unknown>)
		.flat()
		.filter((value): value is string => typeof value === 'string');
}

/** A refusal to answer the next call with. `message` alone is enough. */
export interface InjectedRefusal {
	status: number;
	message: string;
	code?: number;
	source?: unknown;
}

export interface FakeSiteOptions {
	siteUrl?: string;
	/** The site's entity types by API name, or as `{apiName: displayName}`. Default: Version, Shot, Asset, Task. */
	entityTypes?: readonly string[] | Readonly<Record<string, string>>;
	/** The ids of the site's projects. A `visible` write for any other id is refused (corpus finding 115). */
	projects?: readonly number[];
	/**
	 * The site's status codes. A status list's values and default must be among them: any other
	 * code is a 400 (corpus findings 116 and 121). Default: `DEFAULT_STATUSES`.
	 */
	statuses?: readonly string[];
}

interface Held {
	dataType: string;
	displayName: string;
	description: string;
	defaultValue: unknown;
	validValues: string[] | null;
	validTypes: string[] | null;
	unique: boolean;
	stock: boolean;
	retired: boolean;
	broken: boolean;
	hiddenIn: Set<number>;
	/** A reverse field: the link it belongs to. */
	reverseOf: { entityType: string; name: string } | null;
	/** A reverse field that went to the trash with its link, and comes back with it. */
	retiredWithLink: boolean;
}

type Injected =
	| { kind: 'refuse'; refusal: InjectedRefusal }
	| { kind: 'drop'; when: 'before' | 'after' }
	| { kind: 'ignore' };

const DEFAULT_TYPES = ['Version', 'Shot', 'Asset', 'Task'];

/**
 * The status codes of a site when a test names none: a small set of the codes a stock site ships
 * with. The probed site held 41 (corpus finding 121); the list itself is not in the corpus, so
 * these are stand-ins, not a measurement. A test that needs another code passes `statuses`.
 */
export const DEFAULT_STATUSES: readonly string[] = ['wtg', 'rdy', 'ip', 'hld', 'fin', 'omt', 'na', 'rev', 'vwd', 'apr', 'act', 'opn', 'res', 'clsd'];
const DEFAULT_CARRIERS = ['list', 'status_list', 'checkbox'];
const VALUE_CARRIERS = ['list', 'status_list'];
const TYPE_CARRIERS = ['entity', 'multi_entity'];
const CREATE_PROPERTIES = ['name', 'description', 'valid_values', 'default_value', 'valid_types', 'unique'];

function unique(items: readonly string[]): string[] {
	return [...new Set(items)];
}

function isUnfilled(value: unknown): boolean {
	return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

function strings(value: unknown): string[] | null {
	return Array.isArray(value) && value.every((item) => typeof item === 'string') ? [...(value as string[])] : null;
}

/**
 * The type as `links.self` spells it: `Version` as it is, the others in snake case. Measured on
 * Version, a custom entity (`custom_entityNN`) and Tag (corpus finding 118). Not measured: every
 * other type, among them one with two capitals such as `PublishedFile`; snake case is assumed.
 */
function selfSegment(entityType: string): string {
	if (entityType === 'Version') return entityType;
	return entityType.replace(/(?!^)([A-Z])/g, '_$1').toLowerCase();
}

function invalidProperty(api: string, property: string, valid: readonly string[]): FakeSiteError {
	return new FakeSiteError(400, {
		code: 103,
		title: `API ${api}() invalid property '${property}': Valid property names: ${JSON.stringify(valid)}`
	});
}

export class FakeSite implements SchemaWritePort {
	readonly siteUrl: string;
	/** Every call, in the order they started. */
	readonly calls: FakeCall[] = [];

	private readonly types: Map<string, string>;
	private readonly projects: Set<number>;
	private readonly statuses: Set<string>;
	private readonly fieldsOf = new Map<string, Map<string, Held>>();
	private readonly undeclared = new Set<string>();
	private readonly injected = new Map<FakeOp, Injected[]>();
	private readonly hooks = new Map<FakeOp, (() => void)[]>();
	/** When each reverse field was made, by `<Type>.<name>`: 1 for the first. */
	private readonly made = new Map<string, number>();
	private writesInFlight: FakeCall[] = [];

	constructor(options: FakeSiteOptions = {}) {
		this.siteUrl = options.siteUrl ?? 'https://fake.shotgrid.autodesk.com';
		const types = options.entityTypes ?? DEFAULT_TYPES;
		this.types = new Map(Array.isArray(types) ? types.map((name) => [name, name]) : Object.entries(types));
		this.projects = new Set(options.projects ?? []);
		this.statuses = new Set(options.statuses ?? DEFAULT_STATUSES);
	}

	/* Seeding and looking: what a test does to the site behind the API's back. */

	/** Puts a live field on the site. A link comes with its reverse fields, as on the site. */
	seed(entityType: string, name: string, settings: FakeFieldSettings = {}): this {
		return this.place(entityType, name, this.held(settings, false));
	}

	/** Puts a retired field on the site: in the trash, its name taken. A link's reverse fields are in the trash with it. */
	seedRetired(entityType: string, name: string, settings: FakeFieldSettings = {}): this {
		return this.place(entityType, name, this.held(settings, true));
	}

	/** A name the row answers and the schema leaves out: its read is 200 with no record. */
	seedUndeclared(entityType: string, name: string): this {
		this.undeclared.add(`${entityType}.${name}`);
		return this;
	}

	/**
	 * Deletes a field for good, as the site's trash page does. The name is free again. Not measured:
	 * what a revive of the name answers afterwards (the fake answers as for a name never used), and
	 * what becomes of a link's reverse fields (the fake leaves them where they are).
	 */
	deleteForGood(entityType: string, name: string): this {
		this.fieldsOf.get(entityType)?.delete(name);
		return this;
	}

	/** A field, live or retired, or null when the name was never used. */
	get(entityType: string, name: string): FakeField | null {
		const held = this.fieldsOf.get(entityType)?.get(name);
		if (!held) return null;
		return {
			entityType,
			name,
			dataType: held.dataType,
			displayName: held.displayName,
			description: held.description,
			defaultValue: held.defaultValue,
			validValues: held.validValues ? [...held.validValues] : null,
			validTypes: held.validTypes ? [...held.validTypes] : null,
			unique: held.unique,
			stock: held.stock,
			retired: held.retired,
			broken: held.broken,
			hiddenIn: [...held.hiddenIn],
			reverseOf: held.reverseOf ? { ...held.reverseOf } : null
		};
	}

	/**
	 * The reverse fields of a link, live and retired, in the order they were made (corpus findings
	 * 116 and 121). Each is a field name taken on its type for good.
	 */
	reverseFields(entityType: string, name: string): FakeField[] {
		return this.reverseOf(entityType, name).flatMap(([type, field]) => this.get(type, field) ?? []);
	}

	/** The names of a type's live fields, in creation order. */
	liveNames(entityType: string): string[] {
		return [...(this.fieldsOf.get(entityType) ?? [])].filter(([, held]) => !held.retired).map(([name]) => name);
	}

	/** The names of a type's retired fields. */
	retiredNames(entityType: string): string[] {
		return [...(this.fieldsOf.get(entityType) ?? [])].filter(([, held]) => held.retired).map(([name]) => name);
	}

	/* Faults and hooks. Each applies to the next call of that operation, in the order given. */

	/** The next call of `op` is refused with this status and message. Nothing is changed. */
	failNext(op: FakeOp, refusal: InjectedRefusal): this {
		return this.inject(op, { kind: 'refuse', refusal });
	}

	/**
	 * The next call of `op` gets no answer: it rejects with a `TypeError`, as `fetch` does. `before`:
	 * the request never arrived. `after`: it was applied and the answer was lost.
	 */
	dropNext(op: FakeOp, when: 'before' | 'after' = 'before'): this {
		return this.inject(op, { kind: 'drop', when });
	}

	/** The next call of `op` answers success and changes nothing (corpus finding 028). For update, retire and revive. */
	ignoreNext(op: 'updateField' | 'retireField' | 'reviveField'): this {
		return this.inject(op, { kind: 'ignore' });
	}

	/** Runs `hook` once, just before the next call of `op` is handled: a change made by someone else mid-run. */
	beforeNext(op: FakeOp, hook: () => void): this {
		this.hooks.set(op, [...(this.hooks.get(op) ?? []), hook]);
		return this;
	}

	/* The log. */

	/** The write calls, in order. */
	writes(): FakeCall[] {
		return this.calls.filter((call) => call.write);
	}

	/** The write calls as short lines: `createField Version`, `updateField Version.sg_lens`. */
	writeLog(): string[] {
		return this.writes().map((call) => `${call.op} ${call.entityType}${call.field === null ? '' : `.${call.field}`}`);
	}

	/** Whether any two writes were in flight at once (RUN-6). */
	writesOverlapped(): boolean {
		return this.calls.some((call) => call.overlapped);
	}

	/* The API. */

	/** The `data` of `GET /schema`. */
	readRawEntityTypes(): Promise<Record<string, unknown>> {
		return this.call('readRawEntityTypes', {}, () => {
			const data: Record<string, unknown> = {};
			for (const [name, displayName] of this.types) {
				data[name] = { name: { value: displayName, editable: false }, visible: { value: true, editable: false } };
			}
			return data;
		});
	}

	/** The `data` of `GET /schema/<Type>/fields`: the live fields, at site scope or a project's. */
	readRawFields(entityType: string, projectId?: number): Promise<Record<string, unknown>> {
		return this.call('readRawFields', { entityType, projectId }, () => {
			this.needType(entityType);
			const data: Record<string, unknown> = {};
			for (const [name, held] of this.table(entityType)) {
				if (!held.retired) data[name] = this.record(entityType, held, projectId);
			}
			return data;
		});
	}

	/** `GET /schema/<Type>/fields/<field>`. A retired field and an unused name are the same `missing`. */
	readField(entityType: string, field: string, projectId?: number): Promise<FieldReply> {
		return this.call('readField', { entityType, field, projectId }, (): FieldReply => {
			this.needType(entityType);
			if (this.undeclared.has(`${entityType}.${field}`)) return { status: 'undeclared' };
			const held = this.table(entityType).get(field);
			if (!held || held.retired) return { status: 'missing', message: `Field '${entityType}.${field}' does not exist.` };
			return { status: 'found', raw: this.record(entityType, held, projectId) };
		});
	}

	/** `POST /schema/<Type>/fields`. */
	createField(entityType: string, payload: CreatePayload): Promise<{ name: string; self: string }> {
		const call = this.start('createField', { entityType, body: payload });
		return this.finish(call, () => {
			this.needType(entityType);
			const created = this.create(entityType, payload);
			call.created = created.name;
			return created;
		});
	}

	/** `PUT /schema/<Type>/fields/<field>`. Answers the record, as the site does. */
	updateField(
		entityType: string,
		field: string,
		properties: readonly (PropertyWrite | { property_name: string; value: unknown })[],
		projectId?: number
	): Promise<unknown> {
		return this.call(
			'updateField',
			{ entityType, field, projectId, body: properties },
			() => {
				const held = this.needLive(entityType, field);
				this.update(entityType, field, held, properties, projectId);
				return this.record(entityType, held, projectId);
			},
			() => {
				const held = this.fieldsOf.get(entityType)?.get(field);
				return held ? this.record(entityType, held, projectId) : null;
			}
		);
	}

	/** `DELETE /schema/<Type>/fields/<field>`. */
	retireField(entityType: string, field: string): Promise<void> {
		return this.call(
			'retireField',
			{ entityType, field },
			() => {
				this.needLive(entityType, field).retired = true;
				// The reverse fields go with it: measured on a multi-entity link (finding 116) and an entity link (121).
				this.retireReverse(entityType, field);
			},
			() => undefined
		);
	}

	/**
	 * `POST /schema/<Type>/fields/<field>` with `{revive: true}`, answered as sg-widgets core's
	 * client does: a 4xx other than 401 and 403 comes back as `revived: false`, everything else
	 * rejects.
	 */
	async reviveField(entityType: string, field: string): Promise<ReviveAnswer> {
		try {
			return await this.call(
				'reviveField',
				{ entityType, field },
				(): ReviveAnswer => {
					this.needType(entityType);
					const held = this.table(entityType).get(field);
					if (!held) {
						throw new FakeSiteError(404, {
							code: 103,
							title: 'Not Found',
							detail: `Retired field ${entityType}.${field} does not exist.`
						});
					}
					if (!held.retired) throw new FakeSiteError(400, { code: 103, title: `Field ${entityType}.${field} is not retired.` });
					// Not measured: whether the field a wrong-case valid type took down can be revived. The fake does not hand it back.
					if (held.broken) throw new FakeSiteError(500, { code: 100, title: 'Shotgun Server Error' });
					held.retired = false;
					// It comes back as it was retired, except that it is visible in every project (corpus finding 115).
					held.hiddenIn.clear();
					// Its reverse fields come back with it (finding 121, measured on an entity link; a multi-entity
					// link's revive was not measured and is taken to do the same). Their visibility was not measured.
					for (const [type, name] of this.reverseOf(entityType, field)) {
						const reverse = this.table(type).get(name);
						if (reverse?.retiredWithLink) {
							reverse.retired = false;
							reverse.retiredWithLink = false;
						}
					}
					return { revived: true };
				},
				(): ReviveAnswer => ({ revived: true })
			);
		} catch (error) {
			if (error instanceof FakeSiteError && error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 403) {
				return { revived: false, status: error.status, message: error.message };
			}
			throw error;
		}
	}

	/** The reads as the run takes them, parsed by the app's own readers. */
	reader(): RunReader {
		return {
			entityTypes: async () => readEntityTypes(await this.readRawEntityTypes()),
			fields: async (entityType) => readFields(entityType, await this.readRawFields(entityType)),
			field: async (entityType, name) => readFieldReply(entityType, name, await this.readField(entityType, name))
		};
	}

	/* Inside. */

	private inject(op: FakeOp, fault: Injected): this {
		this.injected.set(op, [...(this.injected.get(op) ?? []), fault]);
		return this;
	}

	private table(entityType: string): Map<string, Held> {
		let table = this.fieldsOf.get(entityType);
		if (!table) {
			table = new Map();
			this.fieldsOf.set(entityType, table);
		}
		return table;
	}

	private held(settings: FakeFieldSettings, retired: boolean): Held {
		const dataType = settings.dataType ?? 'text';
		return {
			dataType,
			displayName: settings.displayName ?? '',
			description: settings.description ?? '',
			defaultValue: settings.defaultValue ?? null,
			validValues: settings.validValues ? [...settings.validValues] : VALUE_CARRIERS.includes(dataType) ? [] : null,
			validTypes: settings.validTypes ? [...settings.validTypes] : null,
			unique: settings.unique ?? false,
			stock: settings.stock ?? false,
			retired,
			broken: false,
			hiddenIn: new Set(settings.hiddenIn ?? []),
			reverseOf: null,
			retiredWithLink: false
		};
	}

	/** Puts a seeded field in its table. A link gets the reverse fields it lacks, in the state of the link. */
	private place(entityType: string, name: string, held: Held): this {
		this.table(entityType).set(name, held);
		if (!TYPE_CARRIERS.includes(held.dataType)) return this;
		const have = new Set(this.reverseOf(entityType, name).map(([type]) => type));
		for (const type of held.validTypes ?? []) {
			if (!have.has(type)) this.makeReverse(entityType, name, held.dataType, type);
		}
		if (held.retired) this.retireReverse(entityType, name);
		return this;
	}

	/** Where the reverse fields of a link are: `[entity type, field name]`, in the order they were made. */
	private reverseOf(entityType: string, name: string): [string, string][] {
		const found: [string, string][] = [];
		for (const [type, table] of this.fieldsOf) {
			for (const [field, held] of table) {
				if (held.reverseOf?.entityType === entityType && held.reverseOf.name === name) found.push([type, field]);
			}
		}
		const madeAt = ([type, field]: [string, string]) => this.made.get(`${type}.${field}`) ?? 0;
		return found.sort((a, b) => madeAt(a) - madeAt(b));
	}

	/**
	 * Makes the field a link holds on one of its valid types (corpus findings 116 and 121).
	 *
	 * Measured, from the event log, for links on Version: an entity link's field is `sg_versions_<n>`
	 * under the next free number, a retired name counting as taken (`Shot.sg_versions_3`,
	 * `Sequence.sg_versions_1`); a multi-entity link's is `version_<field>_versions`
	 * (`version_sg_deliveries_versions`, a multi_entity whose valid type is Version, finding 056).
	 *
	 * Not measured, and assumed here: the names for a link on another type (the type lowercased, plus
	 * `s`); the data type, valid types and display name of an entity link's reverse field (modelled
	 * as the multi-entity one, labelled with its own name); that an entity link's reverse field is
	 * in the type's field listing; what happens when the multi-entity name is already taken (a
	 * number is added).
	 */
	private makeReverse(linkType: string, linkName: string, linkDataType: string, onType: string): void {
		if (!this.types.has(onType)) return;
		const table = this.table(onType);
		const plural = `${linkType.toLowerCase()}s`;
		const base = linkDataType === 'multi_entity' ? `${linkType.toLowerCase()}_${linkName}_${plural}` : `sg_${plural}`;
		let name = linkDataType === 'multi_entity' ? base : `${base}_1`;
		for (let n = 2; table.has(name); n += 1) name = `${base}_${n}`;
		table.set(name, {
			dataType: 'multi_entity',
			displayName: name,
			description: '',
			defaultValue: null,
			validValues: null,
			validTypes: [linkType],
			unique: false,
			stock: false,
			retired: false,
			broken: false,
			hiddenIn: new Set(),
			reverseOf: { entityType: linkType, name: linkName },
			retiredWithLink: false
		});
		this.made.set(`${onType}.${name}`, this.made.size + 1);
	}

	/** The link went to the trash: its live reverse fields go with it (findings 116 and 121). */
	private retireReverse(entityType: string, name: string): void {
		for (const [type, field] of this.reverseOf(entityType, name)) {
			const reverse = this.table(type).get(field);
			if (reverse && !reverse.retired) {
				reverse.retired = true;
				reverse.retiredWithLink = true;
			}
		}
	}

	/**
	 * An entity link's valid types changed from `before` to `after` (finding 121): a field is made on
	 * each type added and the field of each type removed is retired, its name taken for good. A type
	 * that stays, in whatever place, keeps its field: a reorder makes nothing.
	 */
	private syncReverse(entityType: string, name: string, before: readonly string[], after: readonly string[]): void {
		for (const [type, field] of this.reverseOf(entityType, name)) {
			const reverse = this.table(type).get(field);
			if (reverse && !reverse.retired && !after.includes(type)) reverse.retired = true;
		}
		for (const type of after) {
			if (!before.includes(type)) this.makeReverse(entityType, name, 'entity', type);
		}
	}

	/** A field's record as the site sends it, every value wrapped (corpus `endpoints/get_schema_type_fields`). */
	private record(entityType: string, held: Held, projectId?: number): Record<string, unknown> {
		const properties: Record<string, unknown> = {
			default_value: { value: held.defaultValue, editable: DEFAULT_CARRIERS.includes(held.dataType) },
			summary_default: { value: 'none', editable: true }
		};
		if (held.validValues) properties['valid_values'] = { value: [...held.validValues], editable: true };
		if (held.validTypes) properties['valid_types'] = { value: [...held.validTypes], editable: held.dataType === 'entity' };
		return {
			name: { value: held.displayName, editable: true },
			description: { value: held.description, editable: true },
			entity_type: { value: entityType, editable: false },
			data_type: { value: held.dataType, editable: false },
			editable: { value: true, editable: false },
			mandatory: { value: false, editable: false },
			unique: { value: held.unique, editable: false },
			// A project the site does not have reads as visible (corpus finding 115).
			visible: { value: projectId === undefined || !held.hiddenIn.has(projectId), editable: !held.stock },
			properties
		};
	}

	private needType(entityType: string): void {
		// Measured on the reads. The writes on a missing type were not measured: the same 404 is assumed.
		if (!this.types.has(entityType)) {
			throw new FakeSiteError(404, { code: 103, title: 'Not Found', detail: `Entity type '${entityType}' does not exist.` });
		}
	}

	/** The live field, or the 404 a missing and a retired field both get (corpus finding 119). */
	private needLive(entityType: string, field: string): Held {
		this.needType(entityType);
		const held = this.table(entityType).get(field);
		if (!held || held.retired) {
			throw new FakeSiteError(404, { code: 103, title: 'Not Found', detail: `Field '${entityType}.${field}' does not exist.` });
		}
		return held;
	}

	private create(entityType: string, payload: CreatePayload): { name: string; self: string } {
		const api = 'schema_field_create';
		const dataType = payload.data_type;
		if (dataType === 'calculated') throw new FakeSiteError(500, { code: 105, title: 'NoMethodError' });
		if (dataType === 'color' || dataType === 'image') {
			throw new FakeSiteError(400, { code: 103, title: 'Request Parameters invalid.', source: { data_type: ['data_type is not valid'] } });
		}

		const sent = new Map<string, unknown>();
		for (const property of payload.properties) {
			// A property the create does not take was not measured. Refused here, as the update refuses one.
			if (!CREATE_PROPERTIES.includes(property.property_name)) throw invalidProperty(api, property.property_name, CREATE_PROPERTIES);
			sent.set(property.property_name, property.value);
		}
		const displayName = sent.get('name');
		// Not measured: a create with no name, or a blank one. The "missing required" 400 of a status list with no values is assumed.
		if (typeof displayName !== 'string' || displayName.trim() === '') {
			throw new FakeSiteError(400, { code: 103, title: `API ${api}() missing required 'properties' ["name"]` });
		}

		const validValues = sent.has('valid_values') ? strings(sent.get('valid_values')) : null;
		const validTypes = sent.has('valid_types') ? strings(sent.get('valid_types')) : null;
		const defaultValue = sent.get('default_value') ?? null;
		// Measured with the property left out (findings 019 and 116). Not measured: an empty list, here and for valid
		// types below. It is taken as left out.
		if (dataType === 'status_list' && (validValues === null || validValues.length === 0)) {
			throw new FakeSiteError(400, { code: 103, title: `API ${api}() missing required 'properties' ["valid_values"]` });
		}
		// Measured with no default at all (finding 019). Not measured: a default sent as a string at creation. An
		// update stores the string (finding 116); the create is taken to refuse it as it refuses none.
		if (dataType === 'checkbox' && typeof defaultValue !== 'boolean') {
			throw new FakeSiteError(500, { code: 105, title: 'Only true or false allowed in checkbox' });
		}
		if (TYPE_CARRIERS.includes(dataType) && (validTypes === null || validTypes.length === 0)) {
			throw new FakeSiteError(400, { code: 103, title: `API ${api}() missing required 'properties' ["valid_types"]` });
		}
		if (dataType === 'multi_entity' && validTypes !== null && validTypes.length !== 1) {
			throw new FakeSiteError(400, {
				code: 103,
				title: `API ${api}() 'valid_types' value expected Array with one element: ${JSON.stringify(validTypes)}`
			});
		}
		// The checks of an update (corpus finding 121). On a create they were not measured: the same answers are assumed,
		// and the wrong-case 500 is taken to create nothing.
		if (validTypes !== null && this.checkTypes(api, validTypes) === 'wrong-case') {
			throw new FakeSiteError(500, { code: 100, title: 'Shotgun Server Error' });
		}
		if (dataType === 'status_list') this.checkStatuses(api, [...(validValues ?? []), ...(typeof defaultValue === 'string' ? [defaultValue] : [])]);
		// Not measured on a create. The update refuses a default outside the values, so this does too.
		if (VALUE_CARRIERS.includes(dataType) && typeof defaultValue === 'string' && !(validValues ?? []).includes(defaultValue)) {
			throw new FakeSiteError(400, { code: 103, title: `API ${api}() 'default_value' not in valid_values : ${JSON.stringify(validValues ?? [])}` });
		}

		const table = this.table(entityType);
		// A non-ASCII display name gives `sg_<data_type>`: measured on a currency field only (finding 117), assumed
		// for every other type.
		const base = predictFieldName(displayName, dataType) ?? '';
		let name = base;
		// A live field with the name: the new one is suffixed, at 201, with no warning (corpus finding 019). Measured
		// with the same display name three times over. Not measured, and assumed to follow: another display name that
		// derives a live name; and a live base whose `_1` is retired, taken here as the retired-name refusal for `_1`.
		for (let suffix = 1; table.get(name)?.retired === false; suffix += 1) name = `${base}_${suffix}`;
		if (table.get(name)?.retired) {
			const said = `there is a retired field with the same field_name: ${name}`;
			throw new FakeSiteError(400, {
				code: 105,
				title: `API ${api}() failed, ${said}. Delete the retired field forever from the Trash Page in Shotgun and try again.`,
				source: { field_name: said }
			});
		}

		const description = sent.get('description');
		table.set(name, {
			dataType,
			displayName,
			description: typeof description === 'string' ? description : '',
			// Not measured: a default sent at creation on a type that carries none. It is dropped here. (On an update it
			// is a 400, finding 117.)
			defaultValue: DEFAULT_CARRIERS.includes(dataType) ? defaultValue : null,
			// Repeats: dropped on a list and on valid types, kept on a status list (measured on update, finding 121).
			validValues: VALUE_CARRIERS.includes(dataType) ? (dataType === 'list' ? unique(validValues ?? []) : (validValues ?? [])) : null,
			// Not measured: the order valid types take at creation (finding 121 lists it). The order sent is assumed,
			// as an update keeps it. The run's PLN-20 test rests on this.
			validTypes: TYPE_CARRIERS.includes(dataType) && validTypes ? unique(validTypes) : null,
			// Measured on a text field (finding 116). Not measured: `unique` at creation on another type. Taken on all.
			unique: sent.get('unique') === true,
			stock: false,
			retired: false,
			broken: false,
			// A new field is visible in every project (corpus finding 115).
			hiddenIn: new Set(),
			reverseOf: null,
			retiredWithLink: false
		});
		// A link makes a field on each of its valid types (corpus findings 116 and 121).
		if (TYPE_CARRIERS.includes(dataType)) {
			for (const type of unique(validTypes ?? [])) this.makeReverse(entityType, name, dataType, type);
		}
		return { name, self: `/api/v1/schema/${selfSegment(entityType)}/fields/${name}` };
	}

	/** Throws the 400 for a name that is no entity type. Answers `wrong-case` for a type spelled in another case: the caller's 500. */
	private checkTypes(api: string, types: readonly string[]): 'wrong-case' | null {
		const lower = new Set([...this.types.keys()].map((name) => name.toLowerCase()));
		const strays = types.filter((name) => !this.types.has(name));
		if (strays.some((name) => lower.has(name.toLowerCase()))) return 'wrong-case';
		if (strays.length > 0) {
			throw new FakeSiteError(400, {
				code: 103,
				title: `API ${api}() invalid/missing entity`,
				source: { entity_type: `invalid/missing entity:\n"${strays[0]}"\nValid types:\n${JSON.stringify([...this.types.keys()])}` }
			});
		}
		return null;
	}

	private checkStatuses(api: string, codes: readonly string[]): void {
		const stray = codes.find((code) => !this.statuses.has(code));
		if (stray === undefined) return;
		throw new FakeSiteError(400, {
			code: 103,
			title: `API ${api}() invalid/missing 'status_list' string`,
			source: { status: `invalid/missing 'status_list' string:\n"${stray}"\nValid statuses:\n${JSON.stringify([...this.statuses])}` }
		});
	}

	/**
	 * One `PUT`. The request is checked whole, against the state it would leave, whatever the order
	 * of its properties, and applied whole or not at all (corpus finding 121).
	 */
	private update(
		entityType: string,
		field: string,
		held: Held,
		properties: readonly { property_name: string; value: unknown }[],
		projectId?: number
	): void {
		const api = 'schema_field_update';
		if (properties.length === 0) {
			throw new FakeSiteError(400, { code: 103, title: `API ${api}() can't create/update with no 'properties'` });
		}
		const valid = ['name', 'visible', 'description', 'summary_default'];
		if (VALUE_CARRIERS.includes(held.dataType)) valid.push('valid_values');
		valid.push('default_value', 'custom_metadata');
		if (TYPE_CARRIERS.includes(held.dataType)) valid.push('valid_types');

		const next = { ...held, hiddenIn: new Set(held.hiddenIn) };
		const sent = new Set<string>();
		properties.forEach((property, index) => {
			const { property_name: name, value } = property;
			if (name === 'unique') {
				// 500 on a text field created unique, 400 on a list and a currency field (corpus finding 116). Not
				// measured: a text field created without `unique`, and the other types. The 500 is given to every
				// text field and the 400 to the rest.
				if (held.dataType === 'text') throw new FakeSiteError(500, { code: 105, title: `API ${api}() does not support updating 'unique'.` });
				throw invalidProperty(api, name, valid);
			}
			if (!valid.includes(name)) throw invalidProperty(api, name, valid);
			sent.add(name);
			if (name === 'visible') {
				if (projectId === undefined) {
					throw new FakeSiteError(400, { code: 104, title: `API ${api}(): The 'visible' property requires a project to be updated.` });
				}
				if (!this.projects.has(projectId)) {
					throw new FakeSiteError(400, { code: 105, title: `API ${api}(): The Project with the given project_id does not exist.` });
				}
				// Not measured: a `visible` write on a field the site may not hide (`visible.editable` false, a stock
				// field). The fake applies it. The app never sends one: `visibility-run` reads `editable` first.
				// The string "false" hides too (corpus finding 115).
				if (value === false || value === 'false') next.hiddenIn.add(projectId);
				else next.hiddenIn.delete(projectId);
				return;
			}
			if (isUnfilled(value)) {
				throw new FakeSiteError(400, {
					code: 103,
					title: 'Request Parameters invalid.',
					source: { properties: { [index]: { value: ['value must be filled'] } } }
				});
			}
			if ((name === 'name' || name === 'description') && (typeof value !== 'string' || value.trim() === '')) {
				throw new FakeSiteError(400, {
					code: 103,
					title: `API ${api}() invalid/missing '${name}' value string:\n${JSON.stringify({ property_name: name, value })}`
				});
			}
			switch (name) {
				case 'name':
					next.displayName = value as string;
					return;
				case 'description':
					// Stored as sent, surrounding spaces included.
					next.description = value as string;
					return;
				case 'valid_types': {
					if (held.dataType === 'multi_entity') {
						throw new FakeSiteError(400, {
							code: 103,
							title: `API ${api}() can't update 'valid_types' on this field: ${JSON.stringify(value)}`
						});
					}
					const types = strings(value);
					if (types === null) throw new FakeSiteError(400, { code: 103, title: 'Request Parameters invalid.' });
					// In the order sent, repeats dropped.
					next.validTypes = unique(types);
					return;
				}
				case 'valid_values': {
					const values = strings(value);
					if (values === null) throw new FakeSiteError(400, { code: 103, title: 'Request Parameters invalid.' });
					// A list drops repeats. A status list keeps them.
					next.validValues = held.dataType === 'list' ? unique(values) : values;
					return;
				}
				case 'default_value':
					if (!DEFAULT_CARRIERS.includes(held.dataType)) {
						throw new FakeSiteError(400, {
							code: 103,
							title: `API ${api}() default value is read-only for all data types except status_list, list, checkbox`
						});
					}
					// Stored as sent: a checkbox given the string "false" reads back the string.
					next.defaultValue = value;
					return;
				default:
					// summary_default and custom_metadata are accepted and not modelled.
					return;
			}
		});

		// The state the whole request would leave. Not measured: which refusal wins when a request earns several. The
		// order here is the order of the code: a property's own refusal, in the order sent, then the valid types, the
		// status codes, the default and the values.
		if (sent.has('valid_types') && next.validTypes && this.checkTypes(api, next.validTypes) === 'wrong-case') {
			// The trap of finding 121: a 500, and the field is gone, its valid types stored as sent and its reverse
			// fields retired.
			held.validTypes = next.validTypes;
			held.retired = true;
			held.broken = true;
			this.retireReverse(entityType, field);
			throw new FakeSiteError(500, { code: 100, title: 'Shotgun Server Error' });
		}
		if (VALUE_CARRIERS.includes(held.dataType)) {
			const values = next.validValues ?? [];
			const current = typeof next.defaultValue === 'string' ? next.defaultValue : null;
			if (held.dataType === 'status_list') {
				this.checkStatuses(api, [...(sent.has('valid_values') ? values : []), ...(sent.has('default_value') && current !== null ? [current] : [])]);
			}
			if (sent.has('default_value') && !values.includes(next.defaultValue as string)) {
				throw new FakeSiteError(400, {
					code: 103,
					title: `API ${api}() 'default_value' not in valid_values :\n${JSON.stringify({ property_name: 'default_value', value: next.defaultValue })}`
				});
			}
			// A status list's values must include its default. A list keeps a default outside its values (finding 116).
			if (held.dataType === 'status_list' && sent.has('valid_values') && current !== null && !values.includes(current)) {
				throw new FakeSiteError(400, {
					code: 103,
					title: `API ${api}() 'valid_values' ${JSON.stringify(values)} must include the 'default_value' '${current}'`
				});
			}
		}
		const before = held.validTypes ?? [];
		Object.assign(held, next);
		if (sent.has('valid_types') && held.dataType === 'entity') this.syncReverse(entityType, field, before, held.validTypes ?? []);
	}

	private start(op: FakeOp, info: { entityType?: string; field?: string; projectId?: number; body?: unknown }): FakeCall {
		const write = FAKE_WRITES.includes(op);
		const call: FakeCall = {
			seq: this.calls.length + 1,
			op,
			write,
			entityType: info.entityType ?? null,
			field: info.field ?? null,
			projectId: info.projectId ?? null,
			body: info.body === undefined ? null : structuredClone(info.body),
			outcome: 'pending',
			status: null,
			created: null,
			overlapped: false
		};
		this.calls.push(call);
		if (write) {
			if (this.writesInFlight.length > 0) {
				call.overlapped = true;
				for (const other of this.writesInFlight) other.overlapped = true;
			}
			this.writesInFlight.push(call);
		}
		return call;
	}

	private call<T>(
		op: FakeOp,
		info: { entityType?: string; field?: string; projectId?: number; body?: unknown },
		handle: () => T,
		ignored?: () => T
	): Promise<T> {
		return this.finish(this.start(op, info), handle, ignored);
	}

	private async finish<T>(call: FakeCall, handle: () => T, ignored?: () => T): Promise<T> {
		try {
			// A turn of the event loop, so that two calls started together are seen in flight together.
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
			for (const hook of this.hooks.get(call.op)?.splice(0) ?? []) hook();

			const fault = this.injected.get(call.op)?.shift();
			if (fault?.kind === 'refuse') {
				throw new FakeSiteError(fault.refusal.status, {
					code: fault.refusal.code,
					title: fault.refusal.message,
					source: fault.refusal.source
				});
			}
			if (fault?.kind === 'drop') {
				if (fault.when === 'after') handle();
				call.outcome = 'dropped';
				throw new TypeError('Failed to fetch');
			}
			if (fault?.kind === 'ignore') {
				if (!ignored) throw new Error(`${call.op} cannot be ignored`);
				call.outcome = 'ignored';
				return ignored();
			}
			const answer = handle();
			call.outcome = 'ok';
			return answer;
		} catch (error) {
			if (error instanceof FakeSiteError) {
				call.outcome = 'refused';
				call.status = error.status;
			}
			throw error;
		} finally {
			this.writesInFlight = this.writesInFlight.filter((other) => other !== call);
		}
	}
}

export function createFakeSite(options: FakeSiteOptions = {}): FakeSite {
	return new FakeSite(options);
}
