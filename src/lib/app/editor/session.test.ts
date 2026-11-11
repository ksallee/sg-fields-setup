/**
 * The editor session, driven as the page drives it. The store is the real one, on an empty
 * in-memory IndexedDB. The site is a stub that answers what a test hands it. Navigation and the
 * new tab are spies. Only the toasts are silenced.
 */
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const held = vi.hoisted(() => ({ store: null as unknown }));

vi.mock('$lib/io/set-store', async (original) => ({
	...(await original<typeof import('$lib/io/set-store')>()),
	sharedSetStore: async () => held.store
}));

import { notify } from '$lib/app/toast';
import { writeImportBanner } from '$lib/io/import-banner';
import { readInstallSelection } from '$lib/io/install-selection';
import { openSetStore, SetStoreError, type SetStore } from '$lib/io/set-store';
import type { SiteData } from '$lib/pure/compare';
import { makeLiveField } from '$lib/testing/make-live-field';
import type { LiveField } from '$lib/pure/live-field';
import type { EntryDraft } from '$lib/pure/model';
import { EditorSession, type EditorSiteReads } from './session.svelte';

function draft(name: string, overrides: Partial<EntryDraft> = {}): EntryDraft {
	return {
		targetEntityType: 'Shot',
		programmaticName: `sg_${name.toLowerCase()}`,
		displayName: name,
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

/** A site the test steers: connected or not, and what a re-sync reads. */
class StubSite implements EditorSiteReads {
	connected = true;
	siteUrl = 'https://studio.shotgrid.autodesk.com';
	data: SiteData | null = null;
	labels = new Map<string, string>();
	fields = new Map<string, readonly LiveField[]>();
	asked: string[][] = [];
	/** Set to hold a re-sync's read open until `release` is called. */
	gate: Promise<void> | null = null;
	release: () => void = () => {};
	typeLabel = (name: string): string | undefined => this.labels.get(name);
	recheck = vi.fn(async () => {});

	hold(): void {
		this.gate = new Promise((done) => (this.release = done));
	}

	async fieldsByType(types: readonly string[]): Promise<Map<string, readonly LiveField[]>> {
		this.asked.push([...types]);
		await this.gate;
		return new Map(types.map((type) => [type, this.fields.get(type) ?? []]));
	}
}

function memoryStorage(): Storage {
	const items = new Map<string, string>();
	return {
		getItem: (key) => items.get(key) ?? null,
		setItem: (key, value) => void items.set(key, value),
		removeItem: (key) => void items.delete(key),
		clear: () => items.clear(),
		key: () => null,
		get length() {
			return items.size;
		}
	};
}

/**
 * A clock that moves a second with every write. The store tells a save made elsewhere by the
 * set's and the entries' `changedAt`, to the millisecond: on the real clock two saves of a test
 * can share one.
 */
let tick = 0;
const now = (): string => new Date(Date.parse('2026-11-10T09:00:00.000Z') + (tick += 1) * 1000).toISOString();

let idb: IDBFactory;
let store: SetStore;
let site: StubSite;
let goto: ReturnType<typeof vi.fn<(to: string | URL) => Promise<void>>>;
let openTab: ReturnType<typeof vi.fn<(path: string) => boolean>>;
let toasts: { success: ReturnType<typeof vi.spyOn>; error: ReturnType<typeof vi.spyOn>; warning: ReturnType<typeof vi.spyOn>; info: ReturnType<typeof vi.spyOn> };

beforeEach(async () => {
	idb = new IDBFactory();
	tick = 0;
	store = await openSetStore({ idb, now });
	held.store = store;
	site = new StubSite();
	goto = vi.fn(async () => {});
	openTab = vi.fn(() => true);
	vi.stubGlobal('sessionStorage', memoryStorage());
	toasts = {
		success: vi.spyOn(notify, 'success').mockImplementation(() => {}),
		error: vi.spyOn(notify, 'error').mockImplementation(() => {}),
		warning: vi.spyOn(notify, 'warning').mockImplementation(() => {}),
		info: vi.spyOn(notify, 'info').mockImplementation(() => {})
	};
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

async function makeSet(name: string, entries: EntryDraft[] = [draft('Lens'), draft('Focal'), draft('Slate')]): Promise<string> {
	const made = await store.createSet({ name, origin: 'manual', originDetails: null, entries });
	if (!made.ok) throw new Error('the set was not made');
	return made.set.id;
}

/** A session with the set loaded. Rows are in stored order: by programmatic name. */
async function opened(entries?: EntryDraft[], name = 'Lens kit'): Promise<{ session: EditorSession; id: string }> {
	const id = await makeSet(name, entries);
	const session = new EditorSession({ site, goto, openTab });
	await session.load(id);
	return { session, id };
}

const keyOf = (session: EditorSession, displayName: string): string => {
	const row = session.rows.find((candidate) => candidate.displayName === displayName);
	if (!row) throw new Error(`no row named ${displayName}`);
	return row.key;
};
const names = (session: EditorSession): string[] => session.rows.map((row) => row.displayName);
const storedNames = async (id: string): Promise<string[]> => ((await store.getSet(id))?.entries ?? []).map((entry) => entry.displayName);

describe('loading (EDT-1)', () => {
	it('EDT-1: a set that is found shows its fields, clean', async () => {
		const { session } = await opened();
		expect(session.phase).toBe('ready');
		expect(names(session)).toEqual(['Focal', 'Lens', 'Slate']);
		expect(session.title).toBe('Lens kit');
		expect(session.dirty).toBe(false);
		expect(session.status).toBe('saved');
		expect(session.view.groups.map((group) => [group.type, group.keys.length])).toEqual([['Shot', 3]]);
	});

	it('EDT-1: a set that is gone reads missing', async () => {
		const session = new EditorSession({ site, goto, openTab });
		await session.load('nope');
		expect(session.phase).toBe('missing');
		expect(session.wc).toBeNull();
		expect(session.title).toBe('Set');
	});

	it('MOD-2: a store fault shows its plain sentence, never the raw error', async () => {
		const fault = new SetStoreError('unavailable');
		vi.spyOn(store, 'getSet').mockRejectedValueOnce(fault);
		const session = new EditorSession({ site, goto, openTab });
		await session.load('s1');
		expect(session.phase).toBe('failed');
		expect(session.loadError).toBe(fault.message);
	});

	it('EDT-1: the page moved to another set while the first was loading: the first answers to nobody', async () => {
		const first = await makeSet('First', [draft('One')]);
		const second = await makeSet('Second', [draft('Two')]);
		const session = new EditorSession({ site, goto, openTab });
		const slow = session.load(first);
		await session.load(second);
		await slow;
		expect(session.title).toBe('Second');
		expect(names(session)).toEqual(['Two']);
	});

	it('EDT-1: opening another set starts from nothing: no selection, no open row, no search', async () => {
		const { session } = await opened();
		const other = await makeSet('Other', [draft('One')]);
		session.toggle(keyOf(session, 'Lens'));
		session.select(keyOf(session, 'Lens'), false);
		session.search = 'lens';
		session.filter = 'new';
		session.addGroup('Asset');
		await session.load(other);
		expect(session.expanded.size).toBe(0);
		expect(session.selection.selected.size).toBe(0);
		expect([session.search, session.filter, session.addedGroups]).toEqual(['', 'all', []]);
	});

	it('IMP-50: the import banner is read once: it shows on the first opening and not after a reload', async () => {
		const id = await makeSet('Imported');
		writeImportBanner(id, 3);
		const session = new EditorSession({ site, goto, openTab });
		await session.load(id);
		expect(session.banner).toBe(3);
		await session.load(id);
		expect(session.banner).toBeNull();
	});

	it('IMP-50: the banner is dismissed, and a set nothing was imported into has none', async () => {
		const id = await makeSet('Imported');
		writeImportBanner(id, 3);
		const session = new EditorSession({ site, goto, openTab });
		await session.load(id);
		session.dismissBanner();
		expect(session.banner).toBeNull();
		const { session: plain } = await opened(undefined, 'Plain');
		expect(plain.banner).toBeNull();
	});
});

describe('editing and saving (EDT-3, EDT-4, EDT-44 to EDT-48)', () => {
	it('EDT-44, EDT-46: edit, dirty, save, clean; the store holds the edit and the screen says saved', async () => {
		const { session, id } = await opened();
		session.edit(keyOf(session, 'Lens'), { displayName: 'Lens Height' });
		session.rename('Lens kit 2');
		session.describe('For the camera team');
		expect(session.dirty).toBe(true);
		expect(session.status).toBe('dirty');
		expect(session.saveReason).toBeNull();

		const saving = session.save();
		expect(session.saving).toBe(true);
		expect(session.status).toBe('saving');
		expect(await saving).not.toBeNull();

		expect(session.saving).toBe(false);
		expect(session.dirty).toBe(false);
		expect(session.status).toBe('saved');
		expect(toasts.success).toHaveBeenCalledWith('Saved "Lens kit 2".');
		const stored = await store.getSet(id);
		expect(stored?.set).toMatchObject({ name: 'Lens kit 2', description: 'For the camera team' });
		expect(await storedNames(id)).toContain('Lens Height');
	});

	it('EDT-46: open and selected rows survive the re-keying, each on its own field', async () => {
		const { session, id } = await opened([draft('Lens')]);
		// Added in an order the store does not keep: it sorts by type, then name.
		session.addField('Shot');
		const zebra = session.rows.at(-1)!.key;
		session.edit(zebra, { displayName: 'Zebra' });
		session.addField('Asset');
		const apple = session.rows.at(-1)!.key;
		session.edit(apple, { displayName: 'Apple', dataType: 'number' });
		session.addField('Shot');
		const mango = session.rows.at(-1)!.key;
		session.edit(mango, { displayName: 'Mango' });
		session.toggle(apple);
		session.select(zebra, false);
		session.select(keyOf(session, 'Lens'), false);
		expect([...session.expanded].sort()).toEqual([mango, zebra].sort());

		const keys = await session.save();

		const stored = (await store.getSet(id))!.entries;
		const idOf = (name: string): string => stored.find((entry) => entry.displayName === name)!.id;
		// Every row is keyed by its entry now.
		expect(session.rows.map((row) => row.key).sort()).toEqual(stored.map((entry) => entry.id).sort());
		expect([...session.expanded].sort()).toEqual([idOf('Zebra'), idOf('Mango')].sort());
		expect([...session.selection.selected].sort()).toEqual([idOf('Zebra'), idOf('Lens')].sort());
		expect(session.selection.anchor).toBe(idOf('Lens'));
		// The map the page restores focus with says the same.
		expect([keys?.get(zebra), keys?.get(apple), keys?.get(mango)]).toEqual([idOf('Zebra'), idOf('Apple'), idOf('Mango')]);
		expect(session.dirty).toBe(false);
	});

	it('EDT-47, SET-17: a save refused for a taken name keeps the working copy and shows why', async () => {
		await makeSet('Taken', []);
		const { session, id } = await opened();
		session.rename('Taken');
		session.edit(keyOf(session, 'Lens'), { displayName: 'Lens Height' });
		const before = session.wc;

		expect(await session.save()).toBeNull();

		expect(session.saveError).toBe('A set named "Taken" already exists. Choose another name.');
		expect(session.status).toBe('error');
		expect(session.wc).toBe(before);
		expect(session.dirty).toBe(true);
		expect(toasts.success).not.toHaveBeenCalled();
		expect((await store.getSet(id))?.set.name).toBe('Lens kit');
		// The next edit clears the message; the save then goes through.
		session.rename('Free');
		expect(session.saveError).toBeNull();
		expect(await session.save()).not.toBeNull();
		expect((await store.getSet(id))?.set.name).toBe('Free');
	});

	it('EDT-47: a save refused as stale, another tab having saved the same field, keeps the working copy and says so', async () => {
		const { session, id } = await opened();
		const lens = keyOf(session, 'Lens');
		// The other tab: its own connection to the same database.
		const tab = await openSetStore({ idb, now });
		const theirs = new EditorSession({ site, goto, openTab });
		held.store = tab;
		await theirs.load(id);
		theirs.edit(lens, { displayName: 'Lens Theirs' });
		expect(await theirs.save()).not.toBeNull();
		held.store = store;

		session.edit(lens, { description: 'Mine' });
		const before = session.wc;
		expect(await session.save()).toBeNull();

		expect(session.saveError).toBe(
			'The field "Lens" was changed in another tab. Nothing was saved. Reload to see it, or duplicate this set to keep your changes.'
		);
		expect(session.wc).toBe(before);
		expect(session.rowOf.get(lens)).toMatchObject({ displayName: 'Lens', description: 'Mine' });
		expect((await store.getSet(id))?.entries.find((entry) => entry.id === lens)).toMatchObject({ displayName: 'Lens Theirs', description: null });
		tab.close();
	});

	it('EDT-47: a store fault during a save keeps the working copy and shows the plain sentence', async () => {
		const { session } = await opened();
		session.rename('Renamed');
		const fault = new SetStoreError('quota');
		vi.spyOn(store, 'saveSet').mockRejectedValueOnce(fault);
		expect(await session.save()).toBeNull();
		expect(session.saveError).toBe(fault.message);
		expect(session.saving).toBe(false);
		expect(session.dirty).toBe(true);
	});

	it('EDT-48: a second save while the first is on its way does nothing', async () => {
		const { session } = await opened();
		const saveSet = vi.spyOn(store, 'saveSet');
		session.rename('Renamed');
		const first = session.save();
		expect(await session.save()).toBeNull();
		await first;
		expect(saveSet).toHaveBeenCalledTimes(1);
		expect(toasts.success).toHaveBeenCalledTimes(1);
	});

	it('EDT-11: a save with nothing to save, or with a field missing its values, sends nothing', async () => {
		const { session } = await opened();
		const saveSet = vi.spyOn(store, 'saveSet');
		expect(await session.save()).toBeNull();
		session.addField('Shot');
		expect(session.saveReason).toEqual({ reason: 'incomplete', count: 1 });
		expect(await session.save()).toBeNull();
		expect(saveSet).not.toHaveBeenCalled();
	});

	it('EDT-48: an edit, a delete or a bulk action during a save is not taken: the save ends on the stored set', async () => {
		const { session, id } = await opened();
		const lens = keyOf(session, 'Lens');
		session.select(keyOf(session, 'Focal'), false);
		session.rename('Renamed');
		const saving = session.save();
		session.edit(lens, { displayName: 'Typed during the save' });
		session.rename('Typed during the save');
		session.deleteRow(lens);
		session.addField('Shot');
		session.deleteSelected();
		session.assign('Asset');
		session.changeDataType('number');
		await saving;
		expect(session.title).toBe('Renamed');
		expect(names(session)).toEqual(['Focal', 'Lens', 'Slate']);
		expect(session.dirty).toBe(false);
		expect(await storedNames(id)).toEqual(['Focal', 'Lens', 'Slate']);
	});
});

describe('rows (EDT-18, EDT-19, EDT-25, EDT-33)', () => {
	it('EDT-18: a new field is a blank row on its type, open, with the search and filter cleared', async () => {
		const { session } = await opened();
		session.search = 'lens';
		session.filter = 'on_site';
		session.addField('Asset');
		const added = session.rows.at(-1)!;
		expect(added).toMatchObject({ targetEntityType: 'Asset', displayName: '', isNew: true });
		expect(added.key).toMatch(/^new-/);
		expect(session.expanded.has(added.key)).toBe(true);
		expect([session.search, session.filter]).toEqual(['', 'all']);
		expect(session.dirty).toBe(true);
	});

	it('EDT-19: an added entity type is an empty group, once, and closes the "add" row', async () => {
		const { session } = await opened();
		session.adding = true;
		session.addGroup('Asset');
		session.addGroup('Asset');
		session.addGroup('Shot');
		expect(session.adding).toBe(false);
		expect(session.addedGroups).toEqual(['Asset']);
		expect(session.view.groups.map((group) => [group.type, group.emptyHint])).toEqual([
			['Asset', true],
			['Shot', false]
		]);
		expect(session.dirty).toBe(false);
	});

	it('EDT-25: the name mode of a row is switched', async () => {
		const { session } = await opened();
		const lens = keyOf(session, 'Lens');
		session.nameMode(lens, 'derived');
		expect(session.rowOf.get(lens)?.nameMode).toBe('derived');
	});

	it('EDT-20: a row opens and closes', async () => {
		const { session } = await opened();
		const lens = keyOf(session, 'Lens');
		session.toggle(lens);
		expect(session.expanded.has(lens)).toBe(true);
		session.toggle(lens);
		expect(session.expanded.has(lens)).toBe(false);
	});

	it('EDT-33: a deleted row goes at once, with what pointed at it, and focus is asked onto the next row', async () => {
		const { session } = await opened();
		const [focal, lens, slate] = ['Focal', 'Lens', 'Slate'].map((name) => keyOf(session, name));
		session.toggle(lens);
		session.toggle(focal);
		session.select(lens, false);
		session.select(slate, false);
		session.deleteRow(lens);
		expect(names(session)).toEqual(['Focal', 'Slate']);
		expect([...session.expanded]).toEqual([focal]);
		expect([...session.selection.selected]).toEqual([slate]);
		expect(session.focus?.target).toEqual({ kind: 'row', key: slate });
		// The last row of the list: the one before it.
		session.deleteRow(slate);
		expect(session.focus?.target).toEqual({ kind: 'row', key: focal });
		session.deleteRow(focal);
		expect(session.focus?.target).toEqual({ kind: 'add-entity-type' });
	});

	it('EDT-33: each ask for focus is a new one, so the same neighbour can be asked for twice', async () => {
		const { session } = await opened([draft('A'), draft('B'), draft('C')]);
		session.deleteRow(keyOf(session, 'A'));
		const first = session.focus;
		session.addField('Shot');
		session.deleteRow(session.rows.at(-1)!.key);
		expect(session.focus?.target).toEqual({ kind: 'row', key: keyOf(session, 'C') });
		expect(session.focus?.serial).not.toBe(first?.serial);
	});
});

describe('selection and bulk actions (EDT-39 to EDT-43)', () => {
	it('EDT-39: a click selects, a shift click takes the range on screen, a group takes its rows', async () => {
		const { session } = await opened();
		const [focal, lens, slate] = ['Focal', 'Lens', 'Slate'].map((name) => keyOf(session, name));
		session.select(focal, false);
		session.select(slate, true);
		expect(session.selectedKeys).toEqual([focal, lens, slate]);
		session.clearSelection();
		expect(session.selectedKeys).toEqual([]);
		session.selectGroup([focal, lens]);
		expect(session.selectedKeys).toEqual([focal, lens]);
		expect(session.summary).toMatchObject({ visible: 2, hidden: 0 });
	});

	it('EDT-41: assign moves the selected rows on screen, clears them, and reports the computed fields left alone', async () => {
		site.labels.set('Asset', 'Asset (site)');
		const { session } = await opened([draft('Lens'), draft('Focal'), draft('Sum', { dataType: 'summary' })]);
		session.selectGroup(session.view.visibleKeys);
		session.assign('Asset');
		expect(session.rows.map((row) => [row.displayName, row.targetEntityType])).toEqual([
			['Focal', 'Asset'],
			['Lens', 'Asset'],
			['Sum', 'Shot']
		]);
		expect(session.selection.selected.size).toBe(0);
		expect(toasts.info).toHaveBeenCalledWith('Assigned 2 fields to Asset (site). Skipped 1 computed field.');
	});

	it('EDT-41: change data type changes the selected rows and keeps the selection', async () => {
		const { session } = await opened();
		const lens = keyOf(session, 'Lens');
		session.select(lens, false);
		session.changeDataType('number');
		expect(session.rowOf.get(lens)?.dataType).toBe('number');
		expect(session.selectedKeys).toEqual([lens]);
		expect(toasts.info).not.toHaveBeenCalled();
	});

	it('EDT-41: a selected row that a search hides is counted and left alone', async () => {
		const { session } = await opened();
		const [focal, lens, slate] = ['Focal', 'Lens', 'Slate'].map((name) => keyOf(session, name));
		session.selectGroup([focal, lens, slate]);
		session.search = 'lens';
		expect(session.summary).toMatchObject({ visible: 1, hidden: 2 });
		session.deleteSelected();
		session.search = '';
		expect(names(session)).toEqual(['Focal', 'Slate']);
		expect([...session.selection.selected].sort()).toEqual([focal, slate].sort());
	});

	it('EDT-43: a bulk delete removes the selected rows, forgets them and asks focus onto a neighbour', async () => {
		const { session } = await opened([draft('A'), draft('B'), draft('C'), draft('D')]);
		const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((name) => keyOf(session, name));
		session.toggle(b);
		session.select(b, false);
		session.select(c, false);
		session.deleteSelected();
		expect(names(session)).toEqual(['A', 'D']);
		expect(session.selection).toEqual({ selected: new Set(), anchor: null });
		expect(session.expanded.size).toBe(0);
		expect(session.focus?.target).toEqual({ kind: 'row', key: d });
		expect(a).not.toBe(d);
	});
});

describe('re-sync from the site (EDT-42)', () => {
	const live = (): void => {
		site.fields.set('Shot', [makeLiveField('Shot', 'sg_lens', { displayName: 'Lens (site)', description: 'From the site' })]);
	};

	it('EDT-42: the selected rows the site has take its values; the rest are counted', async () => {
		live();
		const { session } = await opened();
		const lens = keyOf(session, 'Lens');
		session.select(lens, false);
		session.select(keyOf(session, 'Focal'), false);
		await session.resync();
		expect(site.asked).toEqual([['Shot']]);
		expect(session.rowOf.get(lens)).toMatchObject({ displayName: 'Lens (site)', description: 'From the site', snapshotSite: site.siteUrl });
		expect(session.dirty).toBe(true);
		expect(session.selection.selected.size).toBe(0);
		expect(session.resyncing).toBe(false);
		expect(toasts.success).toHaveBeenCalledWith('Re-synced 1 field from the site. 1 is not on the site.');
	});

	it('EDT-42: none on the site is a warning, and nothing changes', async () => {
		const { session } = await opened();
		session.select(keyOf(session, 'Lens'), false);
		await session.resync();
		expect(toasts.warning).toHaveBeenCalledWith('None of the selected fields exist on the site.');
		expect(session.dirty).toBe(false);
	});

	it('EDT-42: a read that fails is a toast titled with what failed', async () => {
		const { session } = await opened();
		session.select(keyOf(session, 'Lens'), false);
		const fault = new Error('boom');
		vi.spyOn(site, 'fieldsByType').mockRejectedValueOnce(fault);
		await session.resync();
		expect(toasts.error).toHaveBeenCalledWith(fault, 'Could not re-sync from the site');
		expect(session.resyncing).toBe(false);
	});

	it('EDT-42: with no site, or a re-sync already on its way, nothing is read', async () => {
		const { session } = await opened();
		session.select(keyOf(session, 'Lens'), false);
		site.connected = false;
		await session.resync();
		expect(site.asked).toEqual([]);
		site.connected = true;
		site.hold();
		const first = session.resync();
		await session.resync();
		site.release();
		await first;
		expect(site.asked).toHaveLength(1);
	});

	it('EDT-42, EDT-44: Save waits while a re-sync is on its way, and says why (audit M2)', async () => {
		live();
		const { session, id } = await opened();
		const lens = keyOf(session, 'Lens');
		session.rename('Renamed');
		session.select(lens, false);
		site.hold();
		const resync = session.resync();
		expect(session.resyncing).toBe(true);
		expect(session.saveReason).toEqual({ reason: 'resyncing' });

		// Ctrl+S, or a click that got through: nothing is saved.
		expect(await session.save()).toBeNull();
		expect((await store.getSet(id))?.set.name).toBe('Lens kit');

		site.release();
		await resync;
		// The answer landed in the working copy, and the screen does not read "Saved".
		expect(session.rowOf.get(lens)?.displayName).toBe('Lens (site)');
		expect(session.status).toBe('dirty');
		expect(session.saveReason).toBeNull();
		expect(await session.save()).not.toBeNull();
		expect(await storedNames(id)).toContain('Lens (site)');
	});

	it('EDT-42: an answer that finds the working copy edited meanwhile is dropped, and the screen says so (audit M2)', async () => {
		live();
		const { session } = await opened();
		const lens = keyOf(session, 'Lens');
		session.select(lens, false);
		site.hold();
		const resync = session.resync();
		session.edit(lens, { description: 'Typed while the site was read' });
		site.release();
		await resync;
		expect(session.rowOf.get(lens)).toMatchObject({ displayName: 'Lens', description: 'Typed while the site was read' });
		expect(toasts.warning).toHaveBeenCalledWith('The set changed while the site was read. Nothing was re-synced. Try again.');
		expect(toasts.success).not.toHaveBeenCalled();
		// The selection stays, so "try again" is one click.
		expect(session.selectedKeys).toEqual([lens]);
	});

	it('EDT-42: an answer that arrives after the page moved to another set is dropped without a word', async () => {
		live();
		const { session } = await opened();
		const other = await makeSet('Other', [draft('Lens')]);
		session.select(keyOf(session, 'Lens'), false);
		site.hold();
		const resync = session.resync();
		const loading = session.load(other);
		site.release();
		await Promise.all([resync, loading]);
		expect(session.dirty).toBe(false);
		expect(names(session)).toEqual(['Lens']);
	});

	it('EDT-42: no re-sync starts during a save', async () => {
		live();
		const { session } = await opened();
		session.select(keyOf(session, 'Lens'), false);
		session.rename('Renamed');
		const saving = session.save();
		await session.resync();
		await saving;
		expect(site.asked).toEqual([]);
	});

	it('CMP-10: a re-check that fails is a toast', async () => {
		const { session } = await opened();
		await session.recheck();
		expect(site.recheck).toHaveBeenCalledTimes(1);
		expect(toasts.error).not.toHaveBeenCalled();
		site.recheck.mockRejectedValueOnce(new Error('boom'));
		await session.recheck();
		expect(toasts.error).toHaveBeenCalledWith('The site did not answer. Try again.', 'Could not re-check the entity types');
	});
});

describe('the comparison (CMP-2, CMP-5, CMP-8)', () => {
	it('CMP-2: the types whose fields the comparison reads are the rows\' types', async () => {
		const { session } = await opened([draft('Lens'), draft('Rig', { targetEntityType: 'Asset' })]);
		expect(session.targetTypes).toEqual(['Asset', 'Shot']);
	});

	it('CMP-5, CMP-8: with the site\'s fields held, a row whose field exists reads on site; with no site, new', async () => {
		const { session } = await opened([draft('Lens'), draft('Focal')]);
		expect(session.view.counts).toMatchObject({ on_site: 0, new: 2 });
		site.data = {
			entityTypes: [{ name: 'Shot', displayName: 'Shot', custom: false }],
			fieldsOf: (type) => (type === 'Shot' ? [makeLiveField('Shot', 'sg_lens', { displayName: 'Lens' })] : null)
		};
		const withSite = new EditorSession({ site, goto, openTab });
		await withSite.load(session.wc!.setId);
		expect(withSite.comparison.byKey.get(keyOf(withSite, 'Lens'))?.category).toBe('on_site');
		expect(withSite.view.counts).toMatchObject({ on_site: 1, new: 1 });
	});
});

describe('leaving while dirty (EDT-5)', () => {
	const elsewhere = new URL('http://localhost/');

	it('EDT-5: a clean set lets every navigation through', async () => {
		const { session } = await opened();
		expect(session.blocksLeaving({ willUnload: false, to: elsewhere })).toBe(false);
		expect(session.blocksLeaving({ willUnload: true, to: null })).toBe(false);
		expect(session.discardOpen).toBe(false);
	});

	it('EDT-5: a dirty set stops a navigation in the app and asks; "Discard changes" then goes there, unasked', async () => {
		const { session, id } = await opened();
		session.rename('Renamed');
		expect(session.blocksLeaving({ willUnload: false, to: elsewhere })).toBe(true);
		expect(session.discardOpen).toBe(true);
		expect(goto).not.toHaveBeenCalled();

		// The navigation `goto` starts comes back through the guard: it must pass this time.
		goto.mockImplementationOnce(async () => {
			expect(session.blocksLeaving({ willUnload: false, to: elsewhere })).toBe(false);
		});
		session.discard();
		expect(session.discardOpen).toBe(false);
		expect(goto).toHaveBeenCalledExactlyOnceWith(elsewhere);
		await vi.waitFor(() => expect(session.blocksLeaving({ willUnload: false, to: elsewhere })).toBe(true));
		expect((await store.getSet(id))?.set.name).toBe('Lens kit');
	});

	it('EDT-5: "Keep editing" closes the prompt and keeps the edit; the next try asks again', async () => {
		const { session } = await opened();
		session.rename('Renamed');
		session.blocksLeaving({ willUnload: false, to: elsewhere });
		session.discardOpen = false;
		expect(session.title).toBe('Renamed');
		expect(goto).not.toHaveBeenCalled();
		expect(session.blocksLeaving({ willUnload: false, to: elsewhere })).toBe(true);
		expect(session.discardOpen).toBe(true);
	});

	it('EDT-5: a closing or reloading tab is stopped with no prompt of the app\'s: the browser asks', async () => {
		const { session } = await opened();
		session.rename('Renamed');
		expect(session.blocksLeaving({ willUnload: true, to: null })).toBe(true);
		expect(session.blocksLeaving({ willUnload: false, to: null })).toBe(true);
		expect(session.discardOpen).toBe(false);
	});
});

describe('deleting the set (EDT-8)', () => {
	it('EDT-8: asks by the stored name and count, then deletes, says so and goes to the list past the leave prompt', async () => {
		const { session, id } = await opened();
		session.rename('Typed, not saved');
		session.addField('Shot');
		await session.askDelete();
		expect(session.deleting.open).toBe(true);
		expect(session.deleting.question).toBe('"Lens kit" and its 3 fields will be deleted. This cannot be undone.');
		expect(await store.getSet(id)).not.toBeNull();

		goto.mockImplementationOnce(async () => {
			expect(session.blocksLeaving({ willUnload: false, to: new URL('http://localhost/') })).toBe(false);
		});
		await session.deleting.confirm(false);
		expect(await store.getSet(id)).toBeNull();
		expect(toasts.success).toHaveBeenCalledWith('Deleted "Lens kit".');
		expect(goto).toHaveBeenCalledExactlyOnceWith('/');
		expect(session.discardOpen).toBe(false);
		expect((await store.getPreferences()).skipDeleteSetConfirm).toBe(false);
	});

	it('SET-22: "do not ask again" ticked is remembered for the next delete', async () => {
		const { session } = await opened();
		await session.askDelete();
		await session.deleting.confirm(true);
		expect((await store.getPreferences()).skipDeleteSetConfirm).toBe(true);
	});

	it('SET-22, EDT-8: with the preference remembered the set goes at once, and a double click deletes and leaves once (audit L8)', async () => {
		await store.setPreference('skipDeleteSetConfirm', true);
		const { session, id } = await opened();
		await vi.waitFor(() => expect(session.deleting.skipConfirm).toBe(true));
		const deleteSet = vi.spyOn(store, 'deleteSet');
		await Promise.all([session.askDelete(), session.askDelete()]);
		expect(session.deleting.open).toBe(false);
		expect(await store.getSet(id)).toBeNull();
		expect(deleteSet).toHaveBeenCalledTimes(1);
		expect(goto).toHaveBeenCalledExactlyOnceWith('/');
		expect(toasts.success).toHaveBeenCalledTimes(1);
	});

	it('EDT-8: before a set is loaded there is nothing to delete', async () => {
		const session = new EditorSession({ site, goto, openTab });
		await session.askDelete();
		expect(session.deleting.open).toBe(false);
	});
});

describe('duplicating (EDT-9)', () => {
	it('EDT-9: the whole working copy, unsaved edits included, as a new set in a new tab', async () => {
		const { session, id } = await opened();
		session.edit(keyOf(session, 'Lens'), { displayName: 'Lens Height' });
		await session.duplicate();
		const sets = (await store.listSets()).items;
		const copy = sets.find((row) => row.set.id !== id)!;
		expect(copy.set.name).toBe('Lens kit copy');
		expect(await storedNames(copy.set.id)).toEqual(['Focal', 'Lens Height', 'Slate']);
		expect(toasts.success).toHaveBeenCalledWith('Duplicated as "Lens kit copy".');
		expect(openTab).toHaveBeenCalledExactlyOnceWith(`/sets/${copy.set.id}`);
		expect(goto).not.toHaveBeenCalled();
		expect(session.duplicating).toBe(false);
		// The original is as it was: stored unchanged, still dirty here.
		expect(await storedNames(id)).toEqual(['Focal', 'Lens', 'Slate']);
		expect(session.dirty).toBe(true);
	});

	it('EDT-9: with rows selected, only those', async () => {
		const { session, id } = await opened();
		session.select(keyOf(session, 'Slate'), false);
		session.select(keyOf(session, 'Focal'), false);
		await session.duplicate();
		const copy = (await store.listSets()).items.find((row) => row.set.id !== id)!;
		expect(await storedNames(copy.set.id)).toEqual(['Focal', 'Slate']);
	});

	it('EDT-9: a blocked tab opens the copy here', async () => {
		const { session, id } = await opened();
		openTab.mockReturnValueOnce(false);
		await session.duplicate();
		const copy = (await store.listSets()).items.find((row) => row.set.id !== id)!;
		expect(goto).toHaveBeenCalledExactlyOnceWith(`/sets/${copy.set.id}`);
	});

	it('EDT-9: the stored set was deleted in another tab: the copy is made from the working copy, edits kept (audit M3)', async () => {
		const { session, id } = await opened();
		session.edit(keyOf(session, 'Lens'), { displayName: 'Lens Height' });
		await store.deleteSet(id);
		await session.duplicate();
		const sets = (await store.listSets()).items;
		expect(sets).toHaveLength(1);
		expect(sets[0].set).toMatchObject({ name: 'Lens kit copy', origin: 'manual' });
		expect(await storedNames(sets[0].set.id)).toEqual(['Focal', 'Lens Height', 'Slate']);
		expect(toasts.error).not.toHaveBeenCalled();
	});

	it('EDT-9: a refusal or a store fault is a toast titled with the set, and nothing opens', async () => {
		const { session } = await opened();
		vi.spyOn(store, 'duplicateSet').mockResolvedValueOnce({ ok: false, reason: 'set_missing' });
		await session.duplicate();
		expect(toasts.error).toHaveBeenLastCalledWith('This set no longer exists.', 'Could not duplicate "Lens kit"');
		const fault = new SetStoreError('quota');
		vi.spyOn(store, 'duplicateSet').mockRejectedValueOnce(fault);
		await session.duplicate();
		expect(toasts.error).toHaveBeenLastCalledWith(fault, 'Could not duplicate "Lens kit"');
		expect(openTab).not.toHaveBeenCalled();
		expect(session.duplicating).toBe(false);
	});

	it('EDT-9: not while a field is missing its values, and not twice at once', async () => {
		const { session } = await opened();
		const duplicateSet = vi.spyOn(store, 'duplicateSet');
		const first = session.duplicate();
		await session.duplicate();
		await first;
		expect(duplicateSet).toHaveBeenCalledTimes(1);
		session.addField('Shot');
		expect(session.duplicateReason).toEqual({ reason: 'incomplete', count: 1 });
		await session.duplicate();
		expect(duplicateSet).toHaveBeenCalledTimes(1);
	});
});

describe('install (EDT-10, PLN-1)', () => {
	it('EDT-10: the whole set: no selection is handed over, and the path says so', async () => {
		const { session, id } = await opened();
		session.install();
		expect(readInstallSelection(id)).toBeNull();
		expect(goto).toHaveBeenCalledExactlyOnceWith(`/sets/${id}/install`);
	});

	it('EDT-10, PLN-1: the selected rows: their entry ids, in order on screen, and the path asks for them', async () => {
		const { session, id } = await opened();
		const [focal, slate] = ['Focal', 'Slate'].map((name) => keyOf(session, name));
		session.select(slate, false);
		session.select(focal, false);
		session.install();
		expect(readInstallSelection(id)).toEqual([focal, slate]);
		expect(goto).toHaveBeenCalledExactlyOnceWith(`/sets/${id}/install?selection=1`);
	});

	it('EDT-10: not with unsaved changes, and not with no site', async () => {
		const { session } = await opened();
		site.connected = false;
		const offline = new EditorSession({ site, goto, openTab });
		await offline.load(session.wc!.setId);
		expect(offline.installReason).toEqual({ reason: 'no_site' });
		offline.install();
		session.rename('Renamed');
		expect(session.installReason).toEqual({ reason: 'dirty' });
		session.install();
		expect(goto).not.toHaveBeenCalled();
	});
});
