import { describe, expect, it } from 'vitest';
import statusList from '../pure/fixtures/live-field-status-list.json';
import listing from '../pure/fixtures/live-schema.json';
import versionFields from '../pure/fixtures/live-version-fields.json';
import type { FieldReply } from '../pure/live-field';
import { COMMON_ENTITY_TYPES } from '../pure/common-entity-types';
import { createLiveSchema, type SchemaSource } from './schema';

/** A promise the test settles by hand. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

interface Fake extends SchemaSource {
	calls: string[];
	/** What the next reads answer. A function is called per read. */
	types: () => Promise<unknown>;
	fields: (entityType: string) => Promise<unknown>;
	field: (entityType: string, field: string, projectId?: number) => Promise<FieldReply>;
}

function fake(): Fake {
	const source: Fake = {
		calls: [],
		types: async () => listing.data,
		fields: async () => versionFields.data,
		field: async () => ({ status: 'found', raw: statusList.data }),
		readRawEntityTypes() {
			source.calls.push('types');
			return source.types();
		},
		readRawFields(entityType) {
			source.calls.push(`fields ${entityType}`);
			return source.fields(entityType);
		},
		readField(entityType, field, projectId) {
			source.calls.push(`field ${entityType}.${field}${projectId === undefined ? '' : ` @${projectId}`}`);
			return source.field(entityType, field, projectId);
		}
	};
	return source;
}

const refusal = (status: number, message: string): Error => Object.assign(new Error(message), { status });

describe('entity types', () => {
	it('reads the type list once per session (CMP-1)', async () => {
		const source = fake();
		const schema = createLiveSchema(source);
		const [first, second] = await Promise.all([schema.entityTypes(), schema.entityTypes()]);
		const third = await schema.entityTypes();
		expect(source.calls).toEqual(['types']);
		expect(first).toBe(second);
		expect(third.find((type) => type.name === 'CustomEntity66')?.displayName).toBe('Camera Rig');
	});

	it('re-reads the type list on a re-check, and keeps the new answer (CMP-10, D6)', async () => {
		const source = fake();
		const schema = createLiveSchema(source);
		await schema.entityTypes();
		source.types = async () => ({ ...listing.data, CustomEntity08: { name: { value: 'Rig', editable: false } } });
		const fresh = await schema.refreshEntityTypes();
		expect(fresh.some((type) => type.name === 'CustomEntity08')).toBe(true);
		expect(await schema.entityTypes()).toBe(fresh);
		expect(source.calls).toEqual(['types', 'types']);
	});

	it('does not keep a failed read: the next ask reads again', async () => {
		const source = fake();
		const schema = createLiveSchema(source);
		source.types = () => Promise.reject(new Error('offline'));
		await expect(schema.entityTypes()).rejects.toThrow('offline');
		source.types = async () => listing.data;
		expect((await schema.entityTypes()).length).toBe(8);
		expect(source.calls).toEqual(['types', 'types']);
	});
});

describe('fields of a type', () => {
	it('reads a type once per session and maps the listing to live fields (CMP-2, IMP-29)', async () => {
		const source = fake();
		const schema = createLiveSchema(source);
		const first = await schema.fields('Version');
		const second = await schema.fieldsOrEmpty('Version');
		expect(source.calls).toEqual(['fields Version']);
		expect(second).toBe(first);
		expect(first.find((field) => field.name === 'sg_version_type')?.validValues).toEqual(['Type A', 'Type B', 'Type C']);
	});

	it('makes one request for two callers asking at once', async () => {
		const source = fake();
		const pending = deferred<unknown>();
		source.fields = () => pending.promise;
		const schema = createLiveSchema(source);
		const both = Promise.all([schema.fields('Version'), schema.fieldsOrEmpty('Version'), schema.fields('Version')]);
		expect(source.calls).toEqual(['fields Version']);
		pending.resolve(versionFields.data);
		const [a, b, c] = await both;
		expect(a).toBe(b);
		expect(b).toBe(c);
	});

	it('caches each type on its own', async () => {
		const source = fake();
		const schema = createLiveSchema(source);
		await Promise.all([schema.fields('Version'), schema.fields('Shot'), schema.fields('Version')]);
		expect(source.calls).toEqual(['fields Version', 'fields Shot']);
	});

	it('counts a type that cannot be read as having no fields, without throwing (CMP-2)', async () => {
		const source = fake();
		source.fields = () => Promise.reject(refusal(500, 'boom'));
		const schema = createLiveSchema(source);
		expect(await schema.fieldsOrEmpty('Version')).toEqual([]);
	});

	it('rejects on the strict path for the same failure', async () => {
		const source = fake();
		source.fields = () => Promise.reject(refusal(500, 'boom'));
		const schema = createLiveSchema(source);
		await expect(schema.fields('Version')).rejects.toThrow('boom');
	});

	it('survives a source that throws instead of rejecting (CMP-2)', async () => {
		const source = fake();
		source.fields = () => {
			throw new Error('sync');
		};
		const schema = createLiveSchema(source);
		expect(await schema.fieldsOrEmpty('Version')).toEqual([]);
	});

	it('does not keep a failed read: the next ask reads again', async () => {
		const source = fake();
		source.fields = () => Promise.reject(refusal(500, 'boom'));
		const schema = createLiveSchema(source);
		expect(await schema.fieldsOrEmpty('Version')).toEqual([]);
		source.fields = async () => versionFields.data;
		expect((await schema.fieldsOrEmpty('Version')).length).toBe(13);
		expect(source.calls).toEqual(['fields Version', 'fields Version']);
	});

	it('keeps the answer that the site does not have the type, so it is asked once (CMP-2, CMP-10)', async () => {
		const source = fake();
		source.fields = () => Promise.reject(refusal(404, "Entity type 'CustomEntity08' does not exist."));
		const schema = createLiveSchema(source);
		expect(await schema.fieldsOrEmpty('CustomEntity08')).toEqual([]);
		expect(await schema.fieldsOrEmpty('CustomEntity08')).toEqual([]);
		await expect(schema.fields('CustomEntity08')).rejects.toThrow('does not exist');
		expect(source.calls).toEqual(['fields CustomEntity08']);
	});

	it('answers the fields it holds without a read, and null for a type not read or not readable (CMP-11)', async () => {
		const source = fake();
		const schema = createLiveSchema(source);
		expect(schema.cachedFields('Version')).toBeNull();
		const fields = await schema.fields('Version');
		expect(schema.cachedFields('Version')).toBe(fields);
		source.fields = () => Promise.reject(refusal(404, 'gone'));
		await schema.fieldsOrEmpty('Nope');
		expect(schema.cachedFields('Nope')).toBeNull();
		expect(source.calls).toEqual(['fields Version', 'fields Nope']);
	});
});

describe('refresh', () => {
	it('bypasses the cache and replaces it (D6)', async () => {
		const source = fake();
		const schema = createLiveSchema(source);
		const before = await schema.fields('Version');
		source.fields = async () => ({ code: versionFields.data.code });
		const fresh = await schema.refreshFields('Version');
		expect(fresh.map((field) => field.name)).toEqual(['code']);
		expect(await schema.fields('Version')).toBe(fresh);
		expect(schema.cachedFields('Version')).toBe(fresh);
		expect(before.length).toBe(13);
		expect(source.calls).toEqual(['fields Version', 'fields Version']);
	});

	it('hands a caller that asks during a refresh the refreshed read, not the old one', async () => {
		const source = fake();
		const schema = createLiveSchema(source);
		await schema.fields('Version');
		const pending = deferred<unknown>();
		source.fields = () => pending.promise;
		const refreshing = schema.refreshFields('Version');
		const asked = schema.fields('Version');
		pending.resolve({ code: versionFields.data.code });
		expect(await asked).toBe(await refreshing);
		expect(source.calls).toEqual(['fields Version', 'fields Version']);
	});

	it('lets a slow old read not overwrite a newer one', async () => {
		const source = fake();
		const old = deferred<unknown>();
		source.fields = () => old.promise;
		const schema = createLiveSchema(source);
		const first = schema.fields('Version');
		source.fields = async () => ({ code: versionFields.data.code });
		const fresh = await schema.refreshFields('Version');
		old.resolve(versionFields.data);
		await first;
		expect(schema.cachedFields('Version')).toBe(fresh);
		expect(await schema.fields('Version')).toBe(fresh);
	});

	it('rejects when the refreshed read fails, and holds nothing for the type', async () => {
		const source = fake();
		const schema = createLiveSchema(source);
		await schema.fields('Version');
		source.fields = () => Promise.reject(refusal(500, 'boom'));
		await expect(schema.refreshFields('Version')).rejects.toThrow('boom');
		expect(schema.cachedFields('Version')).toBeNull();
	});

	it('forgets everything on clear, so the next asks read again (RUN refresh, D6)', async () => {
		const source = fake();
		const schema = createLiveSchema(source);
		await schema.entityTypes();
		await schema.fields('Version');
		schema.clear();
		expect(schema.cachedFields('Version')).toBeNull();
		await schema.entityTypes();
		await schema.fields('Version');
		expect(source.calls).toEqual(['types', 'fields Version', 'types', 'fields Version']);
	});
});

describe('one field, for the plan', () => {
	it('reads the field from the site every time, never from the cache (PLN-3)', async () => {
		const source = fake();
		const schema = createLiveSchema(source);
		await schema.fields('Version');
		const first = await schema.fieldForPlan('Version', 'sg_status_list');
		await schema.fieldForPlan('Version', 'sg_status_list');
		expect(first.kind === 'present' && first.field.defaultValue).toBe('rev');
		expect(source.calls).toEqual(['fields Version', 'field Version.sg_status_list', 'field Version.sg_status_list']);
	});

	it('answers absent for a field that does not exist (PLN-3)', async () => {
		const source = fake();
		source.field = async () => ({ status: 'missing', message: "Field 'Version.sg_nope' does not exist." });
		const read = await createLiveSchema(source).fieldForPlan('Version', 'sg_nope');
		expect(read).toEqual({ kind: 'absent', reason: 'does-not-exist', message: "Field 'Version.sg_nope' does not exist." });
	});

	it('answers absent for a read with no usable data type (PLN-4)', async () => {
		const source = fake();
		source.field = async () => ({ status: 'found', raw: { name: { value: 'X', editable: true } } });
		expect((await createLiveSchema(source).fieldForPlan('Version', 'x')).kind).toBe('absent');
		source.field = async () => ({ status: 'undeclared' });
		expect(await createLiveSchema(source).fieldForPlan('Note', 'read_by_current_user')).toMatchObject({ kind: 'absent', reason: 'undeclared' });
	});

	it('surfaces every other failure as an error, never as absent (PLN-3)', async () => {
		const source = fake();
		const schema = createLiveSchema(source);
		source.field = () => Promise.reject(refusal(404, "Entity type 'CustomEntity08' does not exist."));
		await expect(schema.fieldForPlan('CustomEntity08', 'code')).rejects.toThrow("Entity type 'CustomEntity08' does not exist.");
		source.field = () => Promise.reject(refusal(500, 'boom'));
		await expect(schema.fieldForPlan('Version', 'code')).rejects.toThrow('boom');
		source.field = () => Promise.reject(new TypeError('Failed to fetch'));
		await expect(schema.fieldForPlan('Version', 'code')).rejects.toThrow('Failed to fetch');
	});

	it('reads with a project when one is given, and without otherwise', async () => {
		const source = fake();
		const schema = createLiveSchema(source);
		await schema.fieldForPlan('Version', 'sg_status_list');
		await schema.fieldForPlan('Version', 'sg_status_list', 70);
		expect(source.calls).toEqual(['field Version.sg_status_list', 'field Version.sg_status_list @70']);
	});
});

describe('warm-up', () => {
	it('names the common types in the order the import infers by (SET-25, IMP-15)', () => {
		expect(COMMON_ENTITY_TYPES).toEqual(['Shot', 'Asset', 'Sequence', 'Task', 'Version', 'Note', 'Project']);
	});

	it('starts a read of each common type and of nothing else (SET-25, SET-26)', async () => {
		const source = fake();
		const schema = createLiveSchema(source);
		const done = schema.warmUp();
		expect(source.calls).toEqual(COMMON_ENTITY_TYPES.map((type) => `fields ${type}`));
		await done;
		expect(schema.cachedFields('Shot')?.length).toBe(13);
		await schema.fields('Task');
		expect(source.calls.length).toBe(7);
	});

	it('stays silent when reads fail, and blocks nothing (SET-25)', async () => {
		const source = fake();
		source.fields = (entityType) => (entityType === 'Note' ? Promise.reject(new Error('offline')) : Promise.resolve(versionFields.data));
		const schema = createLiveSchema(source);
		await expect(schema.warmUp()).resolves.toBeUndefined();
		expect(schema.cachedFields('Note')).toBeNull();
		expect(schema.cachedFields('Project')?.length).toBe(13);
	});

	it('does not read a type again that is already held or on its way', async () => {
		const source = fake();
		const schema = createLiveSchema(source);
		await schema.fields('Version');
		await Promise.all([schema.warmUp(), schema.warmUp()]);
		expect(source.calls.filter((call) => call === 'fields Version').length).toBe(1);
		expect(source.calls.length).toBe(7);
	});
});
