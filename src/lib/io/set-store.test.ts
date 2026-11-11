import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { Entry, EntryDraft } from '$lib/pure/model';
import { refusalMessage } from '$lib/pure/set-plan';
import { editRow, openWorkingCopy, removeRow, setDescription, type WorkingCopy } from '$lib/pure/working-copy';
import { draftsOf, saveRequest, type SaveRequest } from '$lib/pure/working-copy-save';
import {
	DB_NAME,
	DB_VERSION,
	SetStoreError,
	openSetStore,
	sharedSetStore,
	type SetStore
} from './set-store';

const T0 = '2026-11-10T09:00:00.000Z';

/** A save request that changes nothing, to build on. */
const NOTHING: SaveRequest = { details: null, removedIds: [], changed: [], added: [] };

function draft(overrides: Partial<EntryDraft> = {}): EntryDraft {
	return {
		targetEntityType: 'Shot',
		programmaticName: 'sg_lens',
		displayName: 'Lens',
		dataType: 'text',
		validTypes: [],
		validValues: [],
		defaultValue: null,
		description: null,
		uniquePerProject: false,
		snapshot: null,
		snapshotSite: null,
		snapshotTime: null,
		...overrides
	};
}

/** A store on its own empty database, with a clock that moves one second per plan and ids id1, id2... */
async function open(idb: IDBFactory = new IDBFactory()): Promise<{ store: SetStore; idb: IDBFactory }> {
	let tick = 0;
	let n = 0;
	const store = await openSetStore({
		idb,
		now: () => new Date(Date.parse(T0) + (tick += 1) * 1000).toISOString(),
		newId: () => `id${(n += 1)}`
	});
	return { store, idb };
}

/** Everything in the database, read behind the store's back. */
async function dump(idb: IDBFactory): Promise<{ sets: unknown[]; entries: unknown[] }> {
	const db = await new Promise<IDBDatabase>((resolve, reject) => {
		const req = idb.open(DB_NAME);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	const all = (name: string) =>
		new Promise<unknown[]>((resolve, reject) => {
			const req = db.transaction(name, 'readonly').objectStore(name).getAll();
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	const result = { sets: await all('sets'), entries: await all('entries') };
	db.close();
	return result;
}

/**
 * Makes the `nth` write to the entries store fail as a full disk would, for as long as the
 * returned function is not called. The write throws inside the open transaction.
 */
async function failEntryWrite(idb: IDBFactory, nth: number): Promise<() => void> {
	const db = await new Promise<IDBDatabase>((resolve, reject) => {
		const req = idb.open(DB_NAME);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	const proto = Object.getPrototypeOf(db.transaction('entries', 'readonly').objectStore('entries'));
	db.close();
	const real = proto.put;
	let calls = 0;
	const spy = vi.spyOn(proto, 'put').mockImplementation(function (this: IDBObjectStore, ...args: unknown[]) {
		if (this.name === 'entries' && (calls += 1) === nth) {
			throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
		}
		return real.apply(this, args);
	});
	return () => spy.mockRestore();
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('createSet', () => {
	it('MOD-4, IMP-49: stores the set and its entries, and returns them as stored', async () => {
		const { store, idb } = await open();
		const result = await store.createSet({
			name: '  Camera report ',
			description: 'Lens fields',
			origin: 'import',
			originDetails: { sourceFiles: 'report.csv', importedAt: T0 },
			entries: [draft({ programmaticName: 'sg_zoom' }), draft({ targetEntityType: 'Asset' })]
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.set).toEqual({
			id: 'id1',
			name: 'Camera report',
			description: 'Lens fields',
			origin: 'import',
			originDetails: { sourceFiles: 'report.csv', importedAt: T0 },
			createdAt: '2026-11-10T09:00:01.000Z',
			changedAt: '2026-11-10T09:00:01.000Z'
		});
		expect(result.entries.map((e) => [e.targetEntityType, e.programmaticName, e.setId])).toEqual([
			['Asset', 'sg_lens', 'id1'],
			['Shot', 'sg_zoom', 'id1']
		]);
		expect(await store.getSet('id1')).toEqual({ set: result.set, entries: result.entries });
		expect((await dump(idb)).entries).toHaveLength(2);
	});

	it('SET-16: creates an empty manual set', async () => {
		const { store } = await open();
		const result = await store.createSet({ name: 'By hand', origin: 'manual' });
		expect(result).toMatchObject({ ok: true, set: { origin: 'manual', description: null }, entries: [] });
	});

	it('MOD-1: refuses a blank name and stores nothing', async () => {
		const { store, idb } = await open();
		expect(await store.createSet({ name: '  ', origin: 'manual', entries: [draft()] })).toEqual({
			ok: false,
			reason: 'blank_name'
		});
		expect(await dump(idb)).toEqual({ sets: [], entries: [] });
	});

	it('MOD-2, SET-17: refuses a name that differs only by case, naming the clashing set', async () => {
		const { store, idb } = await open();
		await store.createSet({ name: 'Camera Report', origin: 'manual' });
		const result = await store.createSet({ name: ' camera report', origin: 'manual', entries: [draft()] });
		expect(result).toEqual({ ok: false, reason: 'name_taken', clashing: { id: 'id1', name: 'Camera Report' } });
		const stored = await dump(idb);
		expect(stored.sets).toHaveLength(1);
		expect(stored.entries).toEqual([]);
	});

	it('MOD-5: refuses entries that repeat a pair and stores nothing', async () => {
		const { store, idb } = await open();
		const result = await store.createSet({ name: 'Lens', origin: 'manual', entries: [draft(), draft()] });
		expect(result).toMatchObject({ ok: false, reason: 'duplicate_entries' });
		expect(await dump(idb)).toEqual({ sets: [], entries: [] });
	});

	it('MOD-4, IMP-51: if an entry cannot be stored, the set is not left behind', async () => {
		const { store, idb } = await open();
		const restore = await failEntryWrite(idb, 2);
		const failed = store.createSet({
			name: 'Lens',
			origin: 'import',
			entries: [draft({ programmaticName: 'sg_a' }), draft({ programmaticName: 'sg_b' }), draft({ programmaticName: 'sg_c' })]
		});
		await expect(failed).rejects.toMatchObject({ name: 'SetStoreError', kind: 'quota' });
		restore();
		expect(await dump(idb)).toEqual({ sets: [], entries: [] });
		expect((await store.listSets()).total).toBe(0);
	});

	it('MOD-4, MOD-2: if the set row is refused by the database, no entry is left behind and no raw error shows', async () => {
		const { store, idb } = await open();
		// A row another version of the app wrote badly: its name key does not match its name.
		const db = await new Promise<IDBDatabase>((resolve) => {
			const req = idb.open(DB_NAME);
			req.onsuccess = () => resolve(req.result);
		});
		await new Promise<void>((resolve) => {
			const tx = db.transaction('sets', 'readwrite');
			tx.objectStore('sets').put({
				id: 'odd',
				name: 'Other',
				nameKey: 'lens',
				description: null,
				origin: 'manual',
				originDetails: null,
				createdAt: T0,
				changedAt: T0
			});
			tx.oncomplete = () => resolve();
		});
		db.close();

		const failed = store.createSet({ name: 'Lens', origin: 'manual', entries: [draft()] });
		await expect(failed).rejects.toBeInstanceOf(SetStoreError);
		await expect(failed).rejects.toMatchObject({ kind: 'failed', message: new SetStoreError('failed').message });
		const stored = await dump(idb);
		expect(stored.sets).toHaveLength(1);
		expect(stored.entries).toEqual([]);
	});

	it('stores plain data: a value that cannot be cloned as it is, such as a proxy, still saves', async () => {
		const { store } = await open();
		const proxied = new Proxy(draft({ snapshot: new Proxy({ name: { value: 'Lens' } }, {}) }), {});
		const result = await store.createSet({ name: 'Lens', origin: 'manual', entries: [proxied] });
		expect(result.ok && result.entries[0].snapshot).toEqual({ name: { value: 'Lens' } });
	});
});

describe('getSet', () => {
	it('EDT-1: gives the entries ordered by target entity type, then programmatic name', async () => {
		const { store } = await open();
		await store.createSet({
			name: 'Lens',
			origin: 'manual',
			entries: [
				draft({ targetEntityType: 'Shot', programmaticName: 'sg_b' }),
				draft({ targetEntityType: 'Asset', programmaticName: 'sg_z' }),
				draft({ targetEntityType: 'Shot', programmaticName: 'sg_a' })
			]
		});
		const loaded = await store.getSet('id1');
		expect(loaded?.entries.map((e) => `${e.targetEntityType}.${e.programmaticName}`)).toEqual([
			'Asset.sg_z',
			'Shot.sg_a',
			'Shot.sg_b'
		]);
	});

	it('gives only the entries of the set asked for, and no storage detail', async () => {
		const { store } = await open();
		await store.createSet({ name: 'One', origin: 'manual', entries: [draft()] });
		await store.createSet({ name: 'Two', origin: 'manual', entries: [draft(), draft({ programmaticName: 'sg_b' })] });
		const one = await store.getSet('id1');
		expect(one?.entries).toHaveLength(1);
		expect(Object.keys(one!.set).sort()).toEqual(
			['changedAt', 'createdAt', 'description', 'id', 'name', 'origin', 'originDetails']
		);
	});

	it('gives null for a set that is not there', async () => {
		const { store } = await open();
		expect(await store.getSet('nope')).toBeNull();
	});

	it('D1: sets are still there when the app opens again', async () => {
		const { store, idb } = await open();
		await store.createSet({ name: 'Lens', origin: 'manual', entries: [draft()] });
		store.close();
		const again = await openSetStore({ idb });
		expect((await again.getSet('id1'))?.entries).toHaveLength(1);
	});
});

describe('listSets', () => {
	it('SET-3, SET-4: lists each set with its entry count, recently changed first', async () => {
		const { store } = await open();
		await store.createSet({ name: 'One', origin: 'manual', entries: [draft()] });
		await store.createSet({ name: 'Two', origin: 'import', entries: [draft(), draft({ programmaticName: 'sg_b' })] });
		await store.createSet({ name: 'Three', origin: 'manual' });
		const page = await store.listSets();
		expect(page.items.map((item) => [item.set.name, item.entryCount])).toEqual([
			['Three', 0],
			['Two', 2],
			['One', 1]
		]);
		expect(page.total).toBe(3);
		expect(page.hasMore).toBe(false);
	});

	it('SET-2, SET-5, SET-9: applies the search, the origin filter and the sort', async () => {
		const { store } = await open();
		await store.createSet({ name: 'Lens kit', origin: 'manual' });
		await store.createSet({ name: 'Slate', description: 'With LENS data', origin: 'import' });
		await store.createSet({ name: 'Weekly', origin: 'manual' });
		const found = await store.listSets({ search: 'lens', sort: 'name' });
		expect(found.items.map((item) => item.set.name)).toEqual(['Lens kit', 'Slate']);
		const filtered = await store.listSets({ search: 'lens', origin: 'import' });
		expect(filtered.items.map((item) => item.set.name)).toEqual(['Slate']);
	});

	it('SET-8, B8, MOD-22: an exact multiple of the page size ends without an empty page', async () => {
		const { store } = await open();
		for (let i = 0; i < 40; i += 1) await store.createSet({ name: `Set ${i}`, origin: 'manual' });
		const first = await store.listSets();
		const second = await store.listSets({ offset: first.items.length });
		expect([first.items.length, first.total, first.hasMore]).toEqual([20, 40, true]);
		expect([second.items.length, second.total, second.hasMore]).toEqual([20, 40, false]);
		expect(new Set([...first.items, ...second.items].map((item) => item.set.id)).size).toBe(40);
	});

	it('SET-11: an empty store is an empty page', async () => {
		const { store } = await open();
		expect(await store.listSets()).toEqual({ items: [], total: 0, offset: 0, limit: 20, hasMore: false });
	});
});

describe('saveSet', () => {
	async function seeded() {
		const opened = await open();
		const created = await opened.store.createSet({
			name: 'Camera report',
			description: 'Lens fields',
			origin: 'manual',
			entries: [draft({ programmaticName: 'sg_lens' }), draft({ programmaticName: 'sg_slate', displayName: 'Slate' })]
		});
		if (!created.ok) throw new Error('seed failed');
		const [lens, slate] = created.entries;
		return { ...opened, set: created.set, lens, slate };
	}

	it('EDT-44, EDT-46: applies name, removals, changes and additions, and returns the set reloaded', async () => {
		const { store, set, lens, slate } = await seeded();
		const result = await store.saveSet(set.id, {
			details: { name: 'Camera kit', description: '' },
			removedIds: [lens.id],
			changed: [{ ...slate, displayName: 'Slate number' }],
			added: [draft({ programmaticName: 'sg_zoom', displayName: 'Zoom' })]
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.set).toMatchObject({ id: set.id, name: 'Camera kit', description: null, createdAt: set.createdAt });
		expect(result.set.changedAt > set.changedAt).toBe(true);
		expect(result.entries.map((e) => [e.programmaticName, e.displayName])).toEqual([
			['sg_slate', 'Slate number'],
			['sg_zoom', 'Zoom']
		]);
		expect(await store.getSet(set.id)).toEqual({ set: result.set, entries: result.entries });
	});

	it('EDT-47: returns the stored entries made for the additions, in the order of the request', async () => {
		const { store, set } = await seeded();
		const result = await store.saveSet(set.id, {
			...NOTHING,
			added: [draft({ programmaticName: 'sg_zoom' }), draft({ targetEntityType: 'Asset' }), draft({ programmaticName: 'sg_a' })]
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.added.map((e) => `${e.targetEntityType}.${e.programmaticName}`)).toEqual([
			'Shot.sg_zoom',
			'Asset.sg_lens',
			'Shot.sg_a'
		]);
		for (const entry of result.added) expect(result.entries).toContainEqual(entry);
		const none = await store.saveSet(set.id, NOTHING);
		expect(none.ok && none.added).toEqual([]);
	});

	it('EDT-47: a request applied again is safe: a removal already done is skipped, a change to a removed entry is refused', async () => {
		const { store, set, lens, slate } = await seeded();
		const first = await store.saveSet(set.id, { ...NOTHING, removedIds: [lens.id] });
		const again = await store.saveSet(set.id, { ...NOTHING, removedIds: [lens.id] });
		expect(first.ok && again.ok && again.set).toEqual(first.ok && first.set);
		expect(again.ok && again.entries).toEqual([slate]);
		expect(await store.saveSet(set.id, { ...NOTHING, changed: [{ ...lens, displayName: 'Back' }] })).toEqual({
			ok: false,
			reason: 'entry_missing',
			entryIds: [lens.id]
		});
		expect((await store.getSet(set.id))?.entries).toEqual([slate]);
	});

	it('EDT-44, MOD-5: deleting an entry and adding one with the same pair in one save works', async () => {
		const { store, set, lens } = await seeded();
		const result = await store.saveSet(set.id, {
			...NOTHING,
			removedIds: [lens.id],
			added: [draft({ programmaticName: 'sg_lens', dataType: 'number' })]
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const again = result.entries.filter((e) => e.programmaticName === 'sg_lens');
		expect(again).toHaveLength(1);
		expect(again[0].id).not.toBe(lens.id);
		expect(again[0].dataType).toBe('number');
	});

	it('EDT-45: a save with nothing changed writes nothing', async () => {
		const { store, idb, set, lens, slate } = await seeded();
		const before = await dump(idb);
		const result = await store.saveSet(set.id, { ...NOTHING, changed: [lens, slate] });
		expect(result).toMatchObject({ ok: true, set });
		expect(await dump(idb)).toEqual(before);
	});

	it('EDT-45: only a changed entry gets a new changed time', async () => {
		const { store, set, lens, slate } = await seeded();
		const result = await store.saveSet(set.id, {
			...NOTHING,
			changed: [lens, { ...slate, description: 'The slate' }]
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const byName = new Map(result.entries.map((e) => [e.programmaticName, e]));
		expect(byName.get('sg_lens')).toEqual(lens);
		expect(byName.get('sg_slate')!.changedAt > slate.changedAt).toBe(true);
	});

	it('MOD-1, MOD-2, MOD-5: refusals are typed and store nothing', async () => {
		const { store, idb, set, lens } = await seeded();
		await store.createSet({ name: 'Weekly Status', origin: 'manual' });
		const before = await dump(idb);
		const base = { ...NOTHING, removedIds: [lens.id] };

		expect(await store.saveSet(set.id, { ...base, details: { name: ' ', description: null } })).toEqual({
			ok: false,
			reason: 'blank_name'
		});
		expect(await store.saveSet(set.id, { ...base, details: { name: 'weekly status', description: null } })).toMatchObject({
			ok: false,
			reason: 'name_taken',
			clashing: { name: 'Weekly Status' }
		});
		expect(await store.saveSet(set.id, { ...base, added: [draft({ programmaticName: 'sg_slate' })] })).toEqual({
			ok: false,
			reason: 'duplicate_entries',
			pairs: [{ targetEntityType: 'Shot', programmaticName: 'sg_slate' }]
		});
		expect(await store.saveSet(set.id, { ...base, changed: [{ ...lens, id: 'ghost' }] })).toEqual({
			ok: false,
			reason: 'entry_missing',
			entryIds: ['ghost']
		});
		expect(await dump(idb)).toEqual(before);
	});

	it('MOD-2: a set keeps its own name, and may change its case', async () => {
		const { store, set } = await seeded();
		expect(await store.saveSet(set.id, { ...NOTHING, details: { name: 'CAMERA REPORT', description: null } })).toMatchObject({
			ok: true,
			set: { name: 'CAMERA REPORT' }
		});
		expect(await store.createSet({ name: 'camera report', origin: 'manual' })).toMatchObject({
			ok: false,
			reason: 'name_taken',
			clashing: { name: 'CAMERA REPORT' }
		});
	});

	it('MOD-2: a renamed set frees its old name', async () => {
		const { store, set } = await seeded();
		await store.saveSet(set.id, { ...NOTHING, details: { name: 'Lens kit', description: null } });
		expect(await store.createSet({ name: 'Camera report', origin: 'manual' })).toMatchObject({ ok: true });
	});

	it('refuses to save a set that is gone', async () => {
		const { store } = await open();
		expect(await store.saveSet('nope', NOTHING)).toEqual({ ok: false, reason: 'set_missing' });
	});

	it('EDT-48, B7: a save that fails part-way leaves storage exactly as it was', async () => {
		const { store, idb, set, lens, slate } = await seeded();
		const before = await dump(idb);
		const loaded = await store.getSet(set.id);

		// The removal and the first write land in the transaction. The second write fails.
		const restore = await failEntryWrite(idb, 2);
		const failed = store.saveSet(set.id, {
			details: { name: 'Renamed', description: 'Changed' },
			removedIds: [lens.id],
			changed: [{ ...slate, displayName: 'Changed' }],
			added: [draft({ programmaticName: 'sg_a' }), draft({ programmaticName: 'sg_b' })]
		});
		await expect(failed).rejects.toMatchObject({
			name: 'SetStoreError',
			kind: 'quota',
			message: new SetStoreError('quota').message
		});
		restore();

		expect(await dump(idb)).toEqual(before);
		expect(await store.getSet(set.id)).toEqual(loaded);
	});

	it('EDT-47: saving again after a failure never creates an entry twice', async () => {
		const { store, idb, set, slate } = await seeded();
		const request = {
			...NOTHING,
			changed: [{ ...slate, displayName: 'Changed' }],
			added: [draft({ programmaticName: 'sg_a' }), draft({ programmaticName: 'sg_b' })]
		};
		const restore = await failEntryWrite(idb, 3);
		await expect(store.saveSet(set.id, request)).rejects.toBeInstanceOf(SetStoreError);
		restore();

		const retried = await store.saveSet(set.id, request);
		expect(retried.ok && retried.entries.map((e) => e.programmaticName)).toEqual(['sg_a', 'sg_b', 'sg_lens', 'sg_slate']);
		expect((await dump(idb)).entries).toHaveLength(4);
	});

	it('MOD-21: a set of 500 entries is created, saved and loaded in reasonable time', async () => {
		const { store } = await open();
		const drafts = Array.from({ length: 500 }, (_, i) =>
			draft({
				targetEntityType: ['Shot', 'Asset', 'Version', 'Task', 'Sequence'][i % 5],
				programmaticName: `sg_field_${i}`,
				displayName: `Field ${i}`,
				dataType: 'list',
				validValues: ['one', 'two', 'three'],
				snapshot: { name: { value: `Field ${i}`, editable: true }, data_type: { value: 'list', editable: false } },
				snapshotSite: 'https://example.shotgrid.autodesk.com',
				snapshotTime: T0
			})
		);

		const started = performance.now();
		const created = await store.createSet({ name: 'Big', origin: 'import', entries: drafts });
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		const saved = await store.saveSet(created.set.id, {
			details: null,
			removedIds: created.entries.slice(0, 50).map((e) => e.id),
			changed: created.entries.slice(50).map((e) => ({ ...e, description: 'Edited' })),
			added: Array.from({ length: 50 }, (_, i) => draft({ programmaticName: `sg_new_${i}` }))
		});
		const loaded = await store.getSet(created.set.id);
		const page = await store.listSets();
		const elapsed = performance.now() - started;

		expect(saved.ok && saved.entries).toHaveLength(500);
		expect(loaded?.entries).toHaveLength(500);
		expect(loaded?.entries.filter((e) => e.description === 'Edited')).toHaveLength(450);
		expect(page.items[0].entryCount).toBe(500);
		expect(elapsed).toBeLessThan(5000);
	});
});

describe('two tabs on one set (audit H1, M3)', () => {
	/** One set with two fields, and a second store on the same database: the other tab. */
	async function twoTabs() {
		const here = await open();
		const there = await openSetStore({ idb: here.idb });
		const created = await here.store.createSet({
			name: 'Camera report',
			description: 'Lens fields',
			origin: 'import',
			originDetails: { sourceFiles: 'report.csv', importedAt: T0 },
			entries: [draft({ programmaticName: 'sg_lens' }), draft({ programmaticName: 'sg_slate', displayName: 'Slate' })]
		});
		if (!created.ok) throw new Error('seed failed');
		const load = () => openWorkingCopy(created.set, created.entries);
		const key = (wc: WorkingCopy, name: string) => wc.rows.find((row) => row.programmaticName === name)!.key;
		return { a: there, b: here.store, idb: here.idb, set: created.set, load, key };
	}

	it('H1: a save from a tab on the old state does not write over a newer save of the same field', async () => {
		const { a, b, set, load, key } = await twoTabs();
		// Both tabs load the set. Tab A renames the lens and saves.
		const tabA = load();
		const tabB = load();
		const savedA = await a.saveSet(set.id, saveRequest(editRow(tabA, key(tabA, 'sg_lens'), { displayName: 'Lens B' })));
		expect(savedA.ok).toBe(true);

		// Tab B, still showing "Lens", edits its description and saves.
		const editedB = editRow(tabB, key(tabB, 'sg_lens'), { description: 'Which lens.' });
		const savedB = await b.saveSet(set.id, saveRequest(editedB));
		expect(savedB).toEqual({ ok: false, reason: 'stale', details: false, fields: ['Lens'] });
		if (savedB.ok) return;
		expect(refusalMessage(savedB)).toBe(
			'The field "Lens" was changed in another tab. Nothing was saved. Reload to see it, or duplicate this set to keep your changes.'
		);
		// A's rename is still there, and nothing of B's was written.
		const now = await b.getSet(set.id);
		expect(now?.entries.map((e) => [e.displayName, e.description])).toEqual([
			['Lens B', null],
			['Slate', null]
		]);
		expect(savedA.ok && now?.set.changedAt).toBe(savedA.ok && savedA.set.changedAt);

		// What B can do next: its working copy is kept, and a duplicate of it stores its work.
		const copy = await b.duplicateSet(set.id, { name: editedB.name, description: editedB.description, entries: draftsOf(editedB) });
		expect(copy).toMatchObject({ ok: true, set: { name: 'Camera report copy' } });
		expect(copy.ok && copy.entries.map((e) => [e.displayName, e.description])).toEqual([
			['Lens', 'Which lens.'],
			['Slate', null]
		]);
	});

	it('H1: the other tab changed the description, this one changes it too: refused, and a removal of a field changed there as well', async () => {
		const { a, b, set, load, key } = await twoTabs();
		const tabA = load();
		const tabB = load();
		await a.saveSet(set.id, saveRequest(setDescription(editRow(tabA, key(tabA, 'sg_slate'), { displayName: 'Slate number' }), 'Theirs.')));
		const result = await b.saveSet(set.id, saveRequest(setDescription(removeRow(tabB, key(tabB, 'sg_slate')), 'Mine.')));
		expect(result).toEqual({ ok: false, reason: 'stale', details: true, fields: ['Slate number'] });
		expect((await b.getSet(set.id))?.entries).toHaveLength(2);
	});

	it('M3: a set deleted in another tab cannot be saved, and its open working copy is duplicated all the same', async () => {
		const { a, b, idb, set, load, key } = await twoTabs();
		const tabB = load();
		const editedB = setDescription(editRow(tabB, key(tabB, 'sg_lens'), { description: 'Which lens.' }), 'Edited.');
		await a.deleteSet(set.id);

		expect(await b.saveSet(set.id, saveRequest(editedB))).toEqual({ ok: false, reason: 'set_missing' });
		// The whole working copy is given: the stored set is not needed. Origin comes from what the tab loaded.
		const copy = await b.duplicateSet(set.id, {
			name: editedB.name,
			description: editedB.description,
			entries: draftsOf(editedB),
			origin: editedB.saved.origin,
			originDetails: editedB.saved.originDetails
		});
		expect(copy).toMatchObject({
			ok: true,
			set: { name: 'Camera report copy', description: 'Edited.', origin: 'import', originDetails: { sourceFiles: 'report.csv', importedAt: T0 } }
		});
		expect(copy.ok && copy.entries.map((e) => [e.programmaticName, e.description])).toEqual([
			['sg_lens', 'Which lens.'],
			['sg_slate', null]
		]);
		expect((await dump(idb)).sets).toMatchObject([{ name: 'Camera report copy' }]);

		// A selection of it is rescued the same way.
		const part = await b.duplicateSet(set.id, { name: editedB.name, description: editedB.description, entries: draftsOf(editedB, [key(editedB, 'sg_slate')]) });
		expect(part).toMatchObject({ ok: true, set: { name: 'Camera report copy 2', origin: 'manual', originDetails: null } });
		expect(part.ok && part.entries.map((e) => e.programmaticName)).toEqual(['sg_slate']);
	});

	it('M3: a deleted set is still missing when the working copy is not all given', async () => {
		const { a, b, idb, set, load } = await twoTabs();
		const tabB = load();
		await a.deleteSet(set.id);
		const entries = draftsOf(tabB);
		expect(await b.duplicateSet(set.id)).toEqual({ ok: false, reason: 'set_missing' });
		expect(await b.duplicateSet(set.id, { entries })).toEqual({ ok: false, reason: 'set_missing' });
		expect(await b.duplicateSet(set.id, { name: 'Camera report', entries })).toEqual({ ok: false, reason: 'set_missing' });
		expect(await b.duplicateSet(set.id, { name: 'Camera report', description: null })).toEqual({ ok: false, reason: 'set_missing' });
		expect(await b.duplicateSet(set.id, { name: '  ', description: null, entries })).toEqual({ ok: false, reason: 'set_missing' });
		expect((await dump(idb)).sets).toEqual([]);
	});

	it('H1: changes to different fields from two tabs are both kept', async () => {
		const { a, b, set, load, key } = await twoTabs();
		const tabA = load();
		const tabB = load();
		await a.saveSet(set.id, saveRequest(editRow(tabA, key(tabA, 'sg_lens'), { displayName: 'Lens B' })));
		const result = await b.saveSet(set.id, saveRequest(editRow(tabB, key(tabB, 'sg_slate'), { description: 'Board.' })));
		expect(result.ok && result.entries.map((e) => [e.displayName, e.description])).toEqual([
			['Lens B', null],
			['Slate', 'Board.']
		]);
		// The tab reloads from what was stored, so its next save is on the new state.
		if (!result.ok) return;
		const next = openWorkingCopy(result.set, result.entries);
		const again = await b.saveSet(set.id, saveRequest(editRow(next, key(next, 'sg_lens'), { description: 'Which lens.' })));
		expect(again).toMatchObject({ ok: true });
	});
});

describe('duplicateSet', () => {
	async function seeded() {
		const opened = await open();
		const created = await opened.store.createSet({
			name: 'Lens',
			description: 'Lens fields',
			origin: 'import',
			originDetails: { sourceFiles: 'report.csv', importedAt: T0 },
			entries: [
				draft({ programmaticName: 'sg_lens', snapshot: { a: { value: 1 } }, snapshotSite: 'https://x', snapshotTime: T0 }),
				draft({ programmaticName: 'sg_slate', dataType: 'list', validValues: ['a', 'b'], defaultValue: 'a' })
			]
		});
		if (!created.ok) throw new Error('seed failed');
		return { ...opened, source: created };
	}

	const attributes = ({ id: _id, setId: _setId, createdAt: _c, changedAt: _u, ...rest }: Entry) => rest;

	it('SET-18, SET-19: copies the set and every entry, with new identities and times', async () => {
		const { store, source } = await seeded();
		const result = await store.duplicateSet(source.set.id);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.set).toMatchObject({
			name: 'Lens copy',
			description: 'Lens fields',
			origin: 'import',
			originDetails: { sourceFiles: 'report.csv', importedAt: T0 }
		});
		expect(result.set.id).not.toBe(source.set.id);
		expect(result.set.createdAt > source.set.createdAt).toBe(true);
		expect(result.entries.map(attributes)).toEqual(source.entries.map(attributes));
		const sourceIds = new Set(source.entries.map((e) => e.id));
		expect(result.entries.every((e) => !sourceIds.has(e.id) && e.setId === result.set.id)).toBe(true);
		expect(await store.getSet(source.set.id)).toEqual({ set: source.set, entries: source.entries });
	});

	it('SET-20, Q9: duplicating again takes the next free number, so it always succeeds', async () => {
		const { store, source } = await seeded();
		const names: string[] = [];
		for (let i = 0; i < 3; i += 1) {
			const result = await store.duplicateSet(source.set.id);
			if (result.ok) names.push(result.set.name);
		}
		expect(names).toEqual(['Lens copy', 'Lens copy 2', 'Lens copy 3']);
	});

	it('EDT-9: copies the working copy given instead of the stored entries, unsaved edits included', async () => {
		const { store, source } = await seeded();
		const working = [{ ...source.entries[0], displayName: 'Edited lens' }, draft({ programmaticName: 'sg_new' })];
		const result = await store.duplicateSet(source.set.id, {
			name: 'Lens kit',
			description: 'Edited',
			entries: working
		});
		expect(result).toMatchObject({ ok: true, set: { name: 'Lens kit copy', description: 'Edited', origin: 'import' } });
		expect(result.ok && result.entries.map((e) => [e.programmaticName, e.displayName, e.snapshotTime])).toEqual([
			['sg_lens', 'Edited lens', T0],
			['sg_new', 'Lens', null]
		]);
		expect((await store.getSet(source.set.id))?.entries).toEqual(source.entries);
	});

	it('EDT-9: copies only the selection when given one', async () => {
		const { store, source } = await seeded();
		const result = await store.duplicateSet(source.set.id, { entries: [source.entries[1]] });
		expect(result.ok && result.entries.map((e) => e.programmaticName)).toEqual(['sg_slate']);
	});

	it('refuses to duplicate a set that is gone, and entries that repeat a pair', async () => {
		const { store, source, idb } = await seeded();
		expect(await store.duplicateSet('nope')).toEqual({ ok: false, reason: 'set_missing' });
		expect(await store.duplicateSet(source.set.id, { entries: [draft(), draft()] })).toMatchObject({
			ok: false,
			reason: 'duplicate_entries'
		});
		expect((await dump(idb)).sets).toHaveLength(1);
	});
});

describe('deleteSet', () => {
	it('MOD-3: deletes the set and all its entries, and no others', async () => {
		const { store, idb } = await open();
		await store.createSet({ name: 'One', origin: 'manual', entries: [draft(), draft({ programmaticName: 'sg_b' })] });
		await store.createSet({ name: 'Two', origin: 'manual', entries: [draft()] });
		await store.deleteSet('id1');
		const stored = await dump(idb);
		expect(stored.sets).toMatchObject([{ name: 'Two' }]);
		expect(stored.entries).toMatchObject([{ setId: 'id4' }]);
		expect(await store.getSet('id1')).toBeNull();
		expect((await store.listSets()).total).toBe(1);
	});

	it('MOD-2: a deleted set frees its name', async () => {
		const { store } = await open();
		await store.createSet({ name: 'One', origin: 'manual' });
		await store.deleteSet('id1');
		expect(await store.createSet({ name: 'one', origin: 'manual' })).toMatchObject({ ok: true });
	});

	it('SET-23: deleting a set that is already gone is not an error', async () => {
		const { store } = await open();
		await expect(store.deleteSet('nope')).resolves.toBeUndefined();
	});
});

describe('preferences', () => {
	it('SET-22: asks before deleting a set until told otherwise', async () => {
		const { store } = await open();
		expect(await store.getPreferences()).toEqual({ skipDeleteSetConfirm: false });
	});

	it('SET-22: remembers "do not ask again", also after the app opens again', async () => {
		const { store, idb } = await open();
		await store.setPreference('skipDeleteSetConfirm', true);
		expect(await store.getPreferences()).toEqual({ skipDeleteSetConfirm: true });
		store.close();
		const again = await openSetStore({ idb });
		expect(await again.getPreferences()).toEqual({ skipDeleteSetConfirm: true });
		await again.setPreference('skipDeleteSetConfirm', false);
		expect(await again.getPreferences()).toEqual({ skipDeleteSetConfirm: false });
	});

	it('SET-22: a stored value that is not a boolean reads as "ask"', async () => {
		const { store, idb } = await open();
		store.close();
		// Written behind the store's back, as an older or a broken build might have.
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const req = idb.open(DB_NAME);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction('preferences', 'readwrite');
			tx.objectStore('preferences').put({ key: 'skipDeleteSetConfirm', value: 'yes' });
			tx.oncomplete = () => resolve();
			tx.onabort = () => reject(tx.error);
		});
		db.close();
		expect(await store.getPreferences()).toEqual({ skipDeleteSetConfirm: false });
	});
});

describe('storage faults', () => {
	it('a browser without IndexedDB gives a typed error with a plain message', async () => {
		const failed = openSetStore({ idb: undefined });
		vi.stubGlobal('indexedDB', undefined);
		await expect(openSetStore()).rejects.toMatchObject({ name: 'SetStoreError', kind: 'unavailable' });
		await expect(failed).rejects.toMatchObject({ kind: 'unavailable', message: new SetStoreError('unavailable').message });
	});

	it('an open the browser refuses, as in some private windows, is unavailable, with the cause kept', async () => {
		const refused = new DOMException('A mutation operation was attempted on a database that did not allow mutations.', 'InvalidStateError');
		const idb = {
			open() {
				const req = {} as { onerror: (() => void) | null; error: DOMException };
				req.error = refused;
				queueMicrotask(() => req.onerror?.());
				return req;
			}
		} as unknown as IDBFactory;
		const failed = openSetStore({ idb });
		await expect(failed).rejects.toMatchObject({ kind: 'unavailable', message: new SetStoreError('unavailable').message, cause: refused });
		await expect(failed).rejects.not.toMatchObject({ message: expect.stringContaining('mutation') });
	});

	it('an upgrade blocked by another tab is a typed error', async () => {
		const idb = new IDBFactory();
		// Another tab holds the database open at an older version and does not let go.
		const old = await new Promise<IDBDatabase>((resolve) => {
			const req = idb.open(DB_NAME, DB_VERSION);
			req.onsuccess = () => resolve(req.result);
		});
		const failed = openSetStore({ idb, version: DB_VERSION + 1 });
		await expect(failed).rejects.toMatchObject({ kind: 'blocked', message: new SetStoreError('blocked').message });
		old.close();
	});

	it('a database that opens after the blocked open gave up is let go: a later upgrade is not blocked by it', async () => {
		const idb = new IDBFactory();
		const old = await new Promise<IDBDatabase>((resolve) => {
			const req = idb.open(DB_NAME, DB_VERSION);
			req.onsuccess = () => resolve(req.result);
		});
		await expect(openSetStore({ idb, version: DB_VERSION + 1 })).rejects.toMatchObject({ kind: 'blocked' });
		// The other tab lets go. The open that was given up on now succeeds, with nobody holding it.
		old.close();
		await new Promise((resolve) => setTimeout(resolve, 20));
		const later = await new Promise<'opened' | 'blocked'>((resolve, reject) => {
			const req = idb.open(DB_NAME, DB_VERSION + 2);
			req.onblocked = () => resolve('blocked');
			req.onerror = () => reject(req.error);
			req.onsuccess = () => {
				req.result.close();
				resolve('opened');
			};
		});
		expect(later).toBe('opened');
	});

	it('the store lets a newer tab upgrade, then says this tab is out of date', async () => {
		const { store, idb } = await open();
		await store.createSet({ name: 'Lens', origin: 'manual' });
		await new Promise<void>((resolve, reject) => {
			const req = idb.open(DB_NAME, DB_VERSION + 1);
			req.onblocked = () => reject(new Error('blocked'));
			req.onsuccess = () => {
				req.result.close();
				resolve();
			};
		});
		await expect(store.listSets()).rejects.toMatchObject({ kind: 'outdated', message: new SetStoreError('outdated').message });
	});

	it('every message is plain: short sentences, no error names', () => {
		for (const kind of ['unavailable', 'blocked', 'outdated', 'quota', 'failed'] as const) {
			const message = new SetStoreError(kind).message;
			expect(message).not.toMatch(/Error|Exception|IndexedDB|IDB/);
			expect(message.endsWith('.')).toBe(true);
		}
	});

	it('a closed store opens again on the next call', async () => {
		const { store } = await open();
		await store.createSet({ name: 'Lens', origin: 'manual' });
		store.close();
		expect((await store.listSets()).total).toBe(1);
	});
});

describe('sharedSetStore', () => {
	it('gives every caller the same store, on the browser database', async () => {
		vi.stubGlobal('indexedDB', new IDBFactory());
		const [a, b] = await Promise.all([sharedSetStore(), sharedSetStore()]);
		expect(a).toBe(b);
		a.close();
	});
});
