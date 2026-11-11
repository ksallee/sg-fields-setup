import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { encodeSetFile } from '$lib/pure/set-file';
import { SET_FILE_SIZE_CAP_BYTES } from '$lib/pure/set-file';
import { importSetFile, importSetFileFrom } from './import-set-file';
import { openSetStore, type SetStore } from './set-store';

async function open(): Promise<SetStore> {
	let n = 0;
	return openSetStore({ idb: new IDBFactory(), newId: () => `id${(n += 1)}` });
}

const ENTRY = {
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
	snapshotTime: null
};

function file(name: string, entries: object[] = [ENTRY], origin = 'manual'): string {
	return JSON.stringify({ format: 'sg-fields-setup/set', version: 1, name, description: null, origin, originDetails: null, entries });
}

describe('importSetFile (D1)', () => {
	it('stores the set with the file origin and its entries', async () => {
		const store = await open();
		const result = await importSetFile(store, file('Lens'));
		expect(result).toMatchObject({ ok: true, name: 'Lens', askedName: 'Lens', entryCount: 1, duplicatesDropped: 0 });
		if (!result.ok) return;
		const stored = await store.getSet(result.id);
		expect(stored?.set).toMatchObject({ name: 'Lens', origin: 'manual' });
		expect(stored?.entries.map((entry) => entry.programmaticName)).toEqual(['sg_lens']);
	});

	it('SET-20 a taken name takes the next free copy name, never a refusal', async () => {
		const store = await open();
		await importSetFile(store, file('Lens'));
		const second = await importSetFile(store, file('Lens'));
		const third = await importSetFile(store, file('lens'));
		expect(second).toMatchObject({ ok: true, name: 'Lens copy', askedName: 'Lens' });
		expect(third).toMatchObject({ ok: true, name: 'lens copy 2', askedName: 'lens' });
		expect((await store.listSets()).total).toBe(3);
	});

	it('IMP-48 counts the repeated entries the file dropped', async () => {
		const store = await open();
		const result = await importSetFile(store, file('Lens', [ENTRY, ENTRY, { ...ENTRY, programmaticName: 'sg_slate' }]));
		expect(result).toMatchObject({ ok: true, entryCount: 2, duplicatesDropped: 1 });
	});

	it('a file that is not a set file is refused in plain words and nothing is stored', async () => {
		const store = await open();
		expect(await importSetFile(store, 'nope')).toEqual({ ok: false, message: 'This file is not valid JSON.' });
		expect(await importSetFile(store, '{"a":1}')).toEqual({ ok: false, message: 'This file is not a set file.' });
		expect((await store.listSets()).total).toBe(0);
	});

	it('what was exported comes back the same', async () => {
		const store = await open();
		const first = await importSetFile(store, file('Lens', [ENTRY], 'import'));
		if (!first.ok) throw new Error('refused');
		const stored = (await store.getSet(first.id))!;
		const { text } = encodeSetFile(stored.set, stored.entries);
		const again = await importSetFile(store, text);
		expect(again).toMatchObject({ ok: true, name: 'Lens copy', entryCount: 1 });
		if (!again.ok) return;
		expect(encodeSetFile({ ...(await store.getSet(again.id))!.set, name: 'Lens' }, (await store.getSet(again.id))!.entries).text).toBe(text);
	});

	it('every hand-built fixture imports', async () => {
		const store = await open();
		const dir = 'fixtures/field-sets';
		const files = readdirSync(dir).filter((name) => name.endsWith('.json') && name !== 'review-notes.json');
		expect(files).toHaveLength(4);
		for (const name of files) {
			const result = await importSetFile(store, readFileSync(`${dir}/${name}`, 'utf8'));
			expect(result, name).toMatchObject({ ok: true, duplicatesDropped: 0 });
		}
		expect((await store.listSets()).total).toBe(4);
	});
});

describe('importSetFileFrom (B6 of the security audit)', () => {
	const source = (name: string, text: string, size = text.length) => {
		const calls = { text: 0 };
		return { calls, file: { name, size, text: async () => ((calls.text += 1), text) } };
	};

	it('reads a file under the cap and stores its set', async () => {
		const store = await open();
		const { file: lens, calls } = source('lens.fieldset.json', file('Lens'));
		const result = await importSetFileFrom(store, lens);
		expect(result).toMatchObject({ ok: true, name: 'Lens', entryCount: 1 });
		expect(calls.text).toBe(1);
	});

	it('refuses a file over the cap before reading it, naming it and the cap', async () => {
		const store = await open();
		const { file: big, calls } = source('big.fieldset.json', file('Big'), SET_FILE_SIZE_CAP_BYTES + 1);
		expect(await importSetFileFrom(store, big)).toEqual({ ok: false, message: '"big.fieldset.json" is over 20 MB.' });
		expect(calls.text).toBe(0);
		expect((await store.listSets()).total).toBe(0);
	});

	it('refuses a snapshot nested too deep and stores nothing', async () => {
		const store = await open();
		const deep = `${'{"a":'.repeat(5000)}1${'}'.repeat(5000)}`;
		const text = file('Deep').replace('"snapshot":null', `"snapshot":${deep}`);
		const result = await importSetFileFrom(store, source('deep.fieldset.json', text).file);
		expect(result.ok).toBe(false);
		expect((await store.listSets()).total).toBe(0);
	});
});
