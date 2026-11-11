/**
 * The delete-set flow, driven as the list and the editor drive it, against the real store on an
 * empty in-memory IndexedDB. Only the toasts are stubbed.
 */
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const held = vi.hoisted(() => ({ store: null as unknown }));

vi.mock('$lib/io/set-store', async (original) => ({
	...(await original<typeof import('$lib/io/set-store')>()),
	sharedSetStore: async () => held.store
}));

import { notify } from '$lib/app/toast';
import { openSetStore, SetStoreError, type SetStore } from '$lib/io/set-store';
import { DeleteSet, type DeleteTarget } from './delete-set.svelte';

let store: SetStore;
let target: DeleteTarget;
let success: ReturnType<typeof vi.spyOn>;
let failure: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
	store = await openSetStore({ idb: new IDBFactory() });
	held.store = store;
	const made = await store.createSet({ name: 'Lens', origin: 'manual', originDetails: null, entries: [] });
	if (!made.ok) throw new Error('the set was not made');
	target = { id: made.set.id, name: 'Lens', entryCount: 0 };
	success = vi.spyOn(notify, 'success').mockImplementation(() => {});
	failure = vi.spyOn(notify, 'error').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

const exists = async (): Promise<boolean> => (await store.getSet(target.id)) !== null;
const remembered = async (): Promise<boolean> => (await store.getPreferences()).skipDeleteSetConfirm;

describe('asking (SET-22)', () => {
	it('SET-22: asks first, by name, and deletes nothing yet', async () => {
		const flow = new DeleteSet(vi.fn());
		await flow.ask({ ...target, entryCount: 3 });
		expect(flow.open).toBe(true);
		expect(flow.question).toBe('"Lens" and its 3 fields will be deleted. This cannot be undone.');
		expect(await exists()).toBe(true);
	});

	it('SET-22: reads the remembered preference; a store that cannot say asks every time', async () => {
		await store.setPreference('skipDeleteSetConfirm', true);
		const flow = new DeleteSet(vi.fn());
		await flow.loadPreference();
		expect(flow.skipConfirm).toBe(true);

		vi.spyOn(store, 'getPreferences').mockRejectedValueOnce(new SetStoreError('unavailable'));
		const other = new DeleteSet(vi.fn());
		await other.loadPreference();
		expect(other.skipConfirm).toBe(false);
	});

	it('a new question clears the last failure', async () => {
		const flow = new DeleteSet(vi.fn());
		await flow.ask(target);
		vi.spyOn(store, 'deleteSet').mockRejectedValueOnce(new SetStoreError('quota'));
		await flow.confirm(false);
		expect(flow.error).not.toBeNull();
		flow.open = false;
		await flow.ask(target);
		expect(flow.error).toBeNull();
	});
});

describe('confirming (SET-23, EDT-8)', () => {
	it('SET-23: deletes the set, closes, says so, and tells the screen', async () => {
		const deleted = vi.fn();
		const flow = new DeleteSet(deleted);
		await flow.ask(target);
		await flow.confirm(false);
		expect(await exists()).toBe(false);
		expect(flow.open).toBe(false);
		expect(flow.busy).toBe(false);
		expect(success).toHaveBeenCalledWith('Deleted "Lens".');
		expect(deleted).toHaveBeenCalledExactlyOnceWith(target);
		expect(await remembered()).toBe(false);
		expect(flow.skipConfirm).toBe(false);
	});

	it('SET-22: "do not ask again" is stored once the delete has succeeded, never before', async () => {
		const flow = new DeleteSet(vi.fn());
		const setPreference = vi.spyOn(store, 'setPreference');
		const order: string[] = [];
		const deleteSet = store.deleteSet.bind(store);
		vi.spyOn(store, 'deleteSet').mockImplementation(async (id) => {
			order.push(`delete starts, remembered: ${setPreference.mock.calls.length > 0}`);
			await deleteSet(id);
			order.push('delete done');
		});
		setPreference.mockImplementation(async () => void order.push('preference stored'));
		await flow.ask(target);
		await flow.confirm(true);
		expect(order).toEqual(['delete starts, remembered: false', 'delete done', 'preference stored']);
		expect(flow.skipConfirm).toBe(true);
	});

	it('SET-22: a delete that failed stores no preference: the next delete still asks', async () => {
		const flow = new DeleteSet(vi.fn());
		vi.spyOn(store, 'deleteSet').mockRejectedValueOnce(new SetStoreError('quota'));
		await flow.ask(target);
		await flow.confirm(true);
		expect(await remembered()).toBe(false);
		expect(flow.skipConfirm).toBe(false);
	});

	it('SET-24: a failure shows in the dialog, which stays open, and nothing is announced', async () => {
		const deleted = vi.fn();
		const flow = new DeleteSet(deleted);
		const fault = new SetStoreError('quota');
		vi.spyOn(store, 'deleteSet').mockRejectedValueOnce(fault);
		await flow.ask(target);
		await flow.confirm(false);
		expect(flow.open).toBe(true);
		expect(flow.error).toBe(fault.message);
		expect(flow.busy).toBe(false);
		expect(success).not.toHaveBeenCalled();
		expect(deleted).not.toHaveBeenCalled();
		// The same dialog, confirmed again, goes through.
		await flow.confirm(false);
		expect(await exists()).toBe(false);
		expect(flow.open).toBe(false);
	});

	it('a preference that does not stick is no failure: the set is gone either way', async () => {
		const flow = new DeleteSet(vi.fn());
		vi.spyOn(store, 'setPreference').mockRejectedValueOnce(new SetStoreError('quota'));
		await flow.ask(target);
		await flow.confirm(true);
		expect(await exists()).toBe(false);
		expect(flow.error).toBeNull();
		expect(flow.skipConfirm).toBe(true);
	});

	it('a second confirm while the first is on its way does nothing', async () => {
		const deleted = vi.fn();
		const flow = new DeleteSet(deleted);
		const deleteSet = vi.spyOn(store, 'deleteSet');
		await flow.ask(target);
		const first = flow.confirm(false);
		expect(flow.busy).toBe(true);
		await flow.confirm(false);
		await first;
		expect(deleteSet).toHaveBeenCalledTimes(1);
		expect(deleted).toHaveBeenCalledTimes(1);
	});

	it('a confirm with nothing asked does nothing', async () => {
		const flow = new DeleteSet(vi.fn());
		const deleteSet = vi.spyOn(store, 'deleteSet');
		await flow.confirm(true);
		expect(deleteSet).not.toHaveBeenCalled();
	});
});

describe('with "do not ask again" remembered (SET-22)', () => {
	async function skipping(deleted = vi.fn()): Promise<DeleteSet> {
		await store.setPreference('skipDeleteSetConfirm', true);
		const flow = new DeleteSet(deleted);
		await flow.loadPreference();
		return flow;
	}

	it('SET-22: deletes at once, with no dialog', async () => {
		const deleted = vi.fn();
		const flow = await skipping(deleted);
		await flow.ask(target);
		expect(flow.open).toBe(false);
		expect(await exists()).toBe(false);
		expect(success).toHaveBeenCalledWith('Deleted "Lens".');
		expect(deleted).toHaveBeenCalledExactlyOnceWith(target);
	});

	it('EDT-8: a second click while the delete is on its way deletes once and leaves once (audit L8)', async () => {
		const deleted = vi.fn();
		const flow = await skipping(deleted);
		const deleteSet = vi.spyOn(store, 'deleteSet');
		const first = flow.ask(target);
		expect(flow.inFlight.has(target.id)).toBe(true);
		const second = flow.ask(target);
		await Promise.all([first, second]);
		expect(deleteSet).toHaveBeenCalledTimes(1);
		expect(deleted).toHaveBeenCalledTimes(1);
		expect(success).toHaveBeenCalledTimes(1);
		expect(flow.inFlight.size).toBe(0);
	});

	it('SET-22: two rows can go at the same time', async () => {
		const other = await store.createSet({ name: 'Slate', origin: 'manual', originDetails: null, entries: [] });
		if (!other.ok) throw new Error('the set was not made');
		const deleted = vi.fn();
		const flow = await skipping(deleted);
		await Promise.all([flow.ask(target), flow.ask({ id: other.set.id, name: 'Slate', entryCount: 0 })]);
		expect((await store.listSets()).total).toBe(0);
		expect(deleted).toHaveBeenCalledTimes(2);
	});

	it('SET-24: a failure is a toast titled with what failed, and the set can be deleted again', async () => {
		const flow = await skipping();
		const fault = new SetStoreError('quota');
		vi.spyOn(store, 'deleteSet').mockRejectedValueOnce(fault);
		await flow.ask(target);
		expect(failure).toHaveBeenCalledWith(fault, 'Could not delete the set');
		expect(flow.inFlight.size).toBe(0);
		await flow.ask(target);
		expect(await exists()).toBe(false);
	});
});
