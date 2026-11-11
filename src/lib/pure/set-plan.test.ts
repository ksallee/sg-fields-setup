import { describe, expect, it } from 'vitest';
import type { Entry, EntryDraft, FieldSet } from './model';
import {
	orderEntries,
	planCreate,
	planDuplicate,
	planSave,
	refusalMessage,
	type Mint,
	type StoredSet
} from './set-plan';
import type { SaveRequest } from './working-copy-save';

const T0 = '2026-11-10T09:00:00.000Z';
const T1 = '2026-11-10T10:30:00.000Z';

/** A clock stopped at T1 and ids n1, n2, n3 in the order they are asked for. */
function mint(): Mint {
	let n = 0;
	return { now: () => T1, newId: () => `n${(n += 1)}` };
}

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

function entry(id: string, overrides: Partial<Entry> = {}): Entry {
	return { ...draft(), id, setId: 's1', createdAt: T0, changedAt: T0, ...overrides };
}

function fieldSet(overrides: Partial<FieldSet> = {}): FieldSet {
	return {
		id: 's1',
		name: 'Camera report',
		description: 'Lens fields',
		origin: 'manual',
		originDetails: null,
		createdAt: T0,
		changedAt: T0,
		...overrides
	};
}

function stored(entries: Entry[] = [], set: Partial<FieldSet> = {}): StoredSet {
	return { set: fieldSet(set), entries };
}

/** A save that changes nothing, to build on. */
function request(overrides: Partial<SaveRequest> = {}): SaveRequest {
	return { details: null, removedIds: [], changed: [], added: [], ...overrides };
}

const OTHERS = [
	{ id: 's1', name: 'Camera report' },
	{ id: 's2', name: 'Weekly Status' }
];

describe('orderEntries', () => {
	it('EDT-1: orders by target entity type, then programmatic name', () => {
		const ordered = orderEntries([
			entry('a', { targetEntityType: 'Shot', programmaticName: 'sg_b' }),
			entry('b', { targetEntityType: 'Asset', programmaticName: 'sg_z' }),
			entry('c', { targetEntityType: 'Shot', programmaticName: 'sg_a' }),
			entry('d', { targetEntityType: 'Asset', programmaticName: 'sg_a' })
		]);
		expect(ordered.map((e) => e.id)).toEqual(['d', 'b', 'c', 'a']);
	});

	it('EDT-1: equal pairs fall back to the id, and the input is not reordered', () => {
		const given = [entry('b', { programmaticName: '' }), entry('a', { programmaticName: '' })];
		expect(orderEntries(given).map((e) => e.id)).toEqual(['a', 'b']);
		expect(given.map((e) => e.id)).toEqual(['b', 'a']);
	});
});

describe('planCreate', () => {
	it('MOD-4, IMP-49: builds the set and its entries with new ids and one time', () => {
		const plan = planCreate(
			{
				name: 'Lens',
				description: 'From the camera report',
				origin: 'import',
				originDetails: { sourceFiles: 'report.csv', importedAt: T0 },
				entries: [draft({ programmaticName: 'sg_b' }), draft({ programmaticName: 'sg_a' })]
			},
			OTHERS,
			mint()
		);
		expect(plan.ok).toBe(true);
		if (!plan.ok) return;
		expect(plan.set).toEqual({
			id: 'n1',
			name: 'Lens',
			description: 'From the camera report',
			origin: 'import',
			originDetails: { sourceFiles: 'report.csv', importedAt: T0 },
			createdAt: T1,
			changedAt: T1
		});
		expect(plan.entries.map((e) => [e.id, e.setId, e.programmaticName, e.createdAt, e.changedAt])).toEqual([
			['n3', 'n1', 'sg_a', T1, T1],
			['n2', 'n1', 'sg_b', T1, T1]
		]);
	});

	it('SET-16: an empty manual set has no entries and no origin details', () => {
		const plan = planCreate({ name: 'By hand', origin: 'manual' }, [], mint());
		expect(plan).toMatchObject({
			ok: true,
			set: { name: 'By hand', description: null, origin: 'manual', originDetails: null },
			entries: []
		});
	});

	it('MOD-1: trims the name', () => {
		const plan = planCreate({ name: '  Lens  ', origin: 'manual' }, [], mint());
		expect(plan).toMatchObject({ ok: true, set: { name: 'Lens' } });
	});

	it('MOD-1: refuses a blank name', () => {
		expect(planCreate({ name: '   ', origin: 'manual' }, [], mint())).toEqual({ ok: false, reason: 'blank_name' });
	});

	it('MOD-2: refuses a taken name and names the clashing set', () => {
		expect(planCreate({ name: 'Weekly Status', origin: 'manual' }, OTHERS, mint())).toEqual({
			ok: false,
			reason: 'name_taken',
			clashing: { id: 's2', name: 'Weekly Status' }
		});
	});

	it('MOD-2: a name that differs only by case or padding clashes, and the stored spelling is named', () => {
		expect(planCreate({ name: ' weekly STATUS ', origin: 'manual' }, OTHERS, mint())).toEqual({
			ok: false,
			reason: 'name_taken',
			clashing: { id: 's2', name: 'Weekly Status' }
		});
	});

	it('MOD-7: a blank description is none', () => {
		const plan = planCreate({ name: 'Lens', description: '  ', origin: 'manual' }, [], mint());
		expect(plan).toMatchObject({ ok: true, set: { description: null } });
		const kept = planCreate({ name: 'Lens', description: ' Notes ', origin: 'manual' }, [], mint());
		expect(kept).toMatchObject({ ok: true, set: { description: 'Notes' } });
	});

	it('MOD-7, MOD-9: stores each entry cleaned', () => {
		const plan = planCreate(
			{
				name: 'Lens',
				origin: 'manual',
				entries: [draft({ displayName: ' Lens ', description: ' ', validValues: ['a'], uniquePerProject: true })]
			},
			[],
			mint()
		);
		expect(plan).toMatchObject({
			ok: true,
			entries: [{ displayName: 'Lens', description: null, validValues: [], uniquePerProject: true }]
		});
	});

	it('MOD-8: an entry with a snapshot and no snapshot time gets the time of storing', () => {
		const plan = planCreate(
			{
				name: 'Lens',
				origin: 'manual',
				entries: [
					draft({ programmaticName: 'sg_a', snapshot: { name: { value: 'Lens' } }, snapshotSite: 'https://x' }),
					draft({ programmaticName: 'sg_b', snapshot: { a: 1 }, snapshotTime: T0 }),
					draft({ programmaticName: 'sg_c' })
				]
			},
			[],
			mint()
		);
		expect(plan.ok && plan.entries.map((e) => e.snapshotTime)).toEqual([T1, T0, null]);
	});

	it('MOD-5: refuses two entries with the same pair, naming the pair once', () => {
		const plan = planCreate(
			{ name: 'Lens', origin: 'manual', entries: [draft(), draft({ displayName: 'Other' }), draft({ programmaticName: ' sg_lens ' })] },
			[],
			mint()
		);
		expect(plan).toEqual({
			ok: false,
			reason: 'duplicate_entries',
			pairs: [{ targetEntityType: 'Shot', programmaticName: 'sg_lens' }]
		});
	});

	it('MOD-5, MOD-6: incomplete entries are stored and never count as duplicates', () => {
		const plan = planCreate(
			{ name: 'Lens', origin: 'import', entries: [draft({ programmaticName: '', dataType: '' }), draft({ programmaticName: '' })] },
			[],
			mint()
		);
		expect(plan.ok && plan.entries).toHaveLength(2);
	});

	it('origin details are kept only for an import', () => {
		const plan = planCreate(
			{ name: 'Lens', origin: 'manual', originDetails: { sourceFiles: 'a.csv', importedAt: T0 } },
			[],
			mint()
		);
		expect(plan).toMatchObject({ ok: true, set: { originDetails: null } });
	});

	it('stores only model attributes: stray keys and old identities on a draft are dropped', () => {
		const stray = { ...entry('old', { setId: 'other' }), selected: true } as EntryDraft;
		const plan = planCreate({ name: 'Lens', origin: 'manual', entries: [stray] }, [], mint());
		expect(plan.ok && plan.entries[0]).toEqual({ ...draft(), id: 'n2', setId: 'n1', createdAt: T1, changedAt: T1 });
	});

	it('never alters what it is given', () => {
		const given = draft({ displayName: ' Lens ', snapshot: { a: 1 } });
		const before = structuredClone(given);
		planCreate({ name: 'Lens', origin: 'manual', entries: [given] }, [], mint());
		expect(given).toEqual(before);
	});
});

describe('planSave', () => {
	it('EDT-42, MOD-8: a changed entry that carries a re-synced snapshot stores it, with the time of storing', () => {
		const lens = entry('e1', { snapshot: { name: { value: 'Lens' } }, snapshotSite: 'https://old.example', snapshotTime: T0 });
		const change = { ...lens, displayName: 'Lens serial', snapshot: { name: { value: 'Lens serial' } }, snapshotSite: 'https://site.example', snapshotTime: null };
		const plan = planSave(stored([lens]), request({ changed: [change] }), OTHERS, mint());
		expect(plan.ok && plan.entries[0]).toMatchObject({
			id: 'e1',
			displayName: 'Lens serial',
			snapshot: { name: { value: 'Lens serial' } },
			snapshotSite: 'https://site.example',
			snapshotTime: T1,
			changedAt: T1
		});
	});

	const lens = entry('e1', { programmaticName: 'sg_lens' });
	const slate = entry('e2', { programmaticName: 'sg_slate', displayName: 'Slate' });

	it('EDT-45: a save with nothing changed writes nothing and moves no time', () => {
		const plan = planSave(stored([lens, slate]), request({ changed: [lens, slate] }), OTHERS, mint());
		expect(plan).toEqual({
			ok: true,
			set: fieldSet(),
			entries: [lens, slate],
			setChanged: false,
			puts: [],
			deletes: [],
			added: []
		});
	});

	it('EDT-44: renames and re-describes the set, and moves its changed time', () => {
		const plan = planSave(stored([lens]), request({ details: { name: ' Lens kit ', description: '' } }), OTHERS, mint());
		expect(plan).toMatchObject({
			ok: true,
			set: { id: 's1', name: 'Lens kit', description: null, createdAt: T0, changedAt: T1 },
			setChanged: true,
			puts: [],
			deletes: []
		});
	});

	it('MOD-1: refuses a blank name', () => {
		expect(planSave(stored([lens]), request({ details: { name: ' ', description: null } }), OTHERS, mint())).toEqual({
			ok: false,
			reason: 'blank_name'
		});
	});

	it('MOD-2: refuses the name of another set, whatever its case', () => {
		expect(planSave(stored([lens]), request({ details: { name: 'WEEKLY status', description: 'Lens fields' } }), OTHERS, mint())).toEqual({
			ok: false,
			reason: 'name_taken',
			clashing: { id: 's2', name: 'Weekly Status' }
		});
	});

	it('MOD-2: a set does not clash with itself, so its own name can change case', () => {
		const plan = planSave(stored([lens]), request({ details: { name: 'CAMERA REPORT', description: 'Lens fields' } }), OTHERS, mint());
		expect(plan).toMatchObject({ ok: true, set: { name: 'CAMERA REPORT', changedAt: T1 } });
	});

	it('EDT-44: removes entries, and the set moves', () => {
		const plan = planSave(stored([lens, slate]), request({ removedIds: ['e1'] }), OTHERS, mint());
		expect(plan).toMatchObject({ ok: true, entries: [slate], deletes: ['e1'], puts: [], set: { changedAt: T1 } });
	});

	it('EDT-44: removing an entry that is already gone is not an error and writes nothing', () => {
		const plan = planSave(stored([lens]), request({ removedIds: ['gone'] }), OTHERS, mint());
		expect(plan).toMatchObject({ ok: true, deletes: [], setChanged: false });
	});

	it('EDT-44, EDT-45: writes only the entries whose cleaned form changed', () => {
		const plan = planSave(
			stored([lens, slate]),
			request({ changed: [{ ...lens, displayName: '  Lens  ' }, { ...slate, displayName: 'Slate number' }] }),
			OTHERS,
			mint()
		);
		expect(plan.ok).toBe(true);
		if (!plan.ok) return;
		expect(plan.puts).toEqual([{ ...slate, displayName: 'Slate number', changedAt: T1 }]);
		expect(plan.entries).toEqual([lens, { ...slate, displayName: 'Slate number', changedAt: T1 }]);
		expect(plan.set.changedAt).toBe(T1);
	});

	it('MOD-9: a changed entry is cleaned for its new type', () => {
		const list = entry('e3', { programmaticName: 'sg_kind', dataType: 'list', validValues: ['a', 'b'], defaultValue: 'a' });
		const plan = planSave(stored([list]), request({ changed: [{ ...list, dataType: 'date' }] }), OTHERS, mint());
		expect(plan.ok && plan.puts).toEqual([
			{ ...list, dataType: 'date', validValues: [], defaultValue: null, changedAt: T1 }
		]);
	});

	it('a change keeps the identity, the set and the created time of the stored entry', () => {
		const forged = { ...lens, displayName: 'New', setId: 'other', createdAt: T1 };
		const plan = planSave(stored([lens]), request({ changed: [forged] }), OTHERS, mint());
		expect(plan.ok && plan.puts).toEqual([{ ...lens, displayName: 'New', changedAt: T1 }]);
	});

	it('MOD-8: a change that brings a snapshot without a time gets the time of storing', () => {
		const plan = planSave(
			stored([lens]),
			request({ changed: [{ ...lens, snapshot: { a: 1 }, snapshotSite: 'https://x' }] }),
			OTHERS,
			mint()
		);
		expect(plan.ok && plan.puts).toEqual([
			{ ...lens, snapshot: { a: 1 }, snapshotSite: 'https://x', snapshotTime: T1, changedAt: T1 }
		]);
	});

	it('EDT-45: a snapshot with the same content in another key order is not a change', () => {
		const snapped = entry('e1', { snapshot: { a: 1, b: { c: [1, 2] } }, snapshotTime: T0 });
		const plan = planSave(
			stored([snapped]),
			request({ changed: [{ ...snapped, snapshot: { b: { c: [1, 2] }, a: 1 } }] }),
			OTHERS,
			mint()
		);
		expect(plan).toMatchObject({ ok: true, puts: [], setChanged: false });
	});

	it('EDT-44: adds entries with new ids, cleaned, in the set', () => {
		const plan = planSave(
			stored([lens]),
			request({ added: [draft({ programmaticName: 'sg_zoom', displayName: ' Zoom ' })] }),
			OTHERS,
			mint()
		);
		const zoom = { ...draft({ programmaticName: 'sg_zoom', displayName: 'Zoom' }), id: 'n1', setId: 's1', createdAt: T1, changedAt: T1 };
		expect(plan).toMatchObject({ ok: true, puts: [zoom], added: [zoom], entries: [lens, zoom], set: { changedAt: T1 } });
	});

	it('EDT-47: gives the entries made for the additions in the order they were asked, whatever the set order', () => {
		const plan = planSave(
			stored([lens]),
			request({
				added: [draft({ programmaticName: 'sg_zoom' }), draft({ targetEntityType: 'Asset' }), draft({ programmaticName: 'sg_a' })]
			}),
			OTHERS,
			mint()
		);
		expect(plan.ok && plan.added.map((e) => [e.id, e.targetEntityType, e.programmaticName])).toEqual([
			['n1', 'Shot', 'sg_zoom'],
			['n2', 'Asset', 'sg_lens'],
			['n3', 'Shot', 'sg_a']
		]);
		expect(plan.ok && plan.entries.map((e) => e.id)).toEqual(['n2', 'n3', 'e1', 'n1']);
	});

	it('EDT-44: null details keep the name and description, and are never refused for the name', () => {
		const clashing = [...OTHERS, { id: 's9', name: 'camera REPORT' }];
		const plan = planSave(stored([lens]), request({ removedIds: ['e1'] }), clashing, mint());
		expect(plan).toMatchObject({ ok: true, set: { name: 'Camera report', description: 'Lens fields', changedAt: T1 } });
	});

	it('EDT-44, MOD-5: deleting an entry and adding one with the same pair in one save is allowed', () => {
		const plan = planSave(
			stored([lens, slate]),
			request({ removedIds: ['e1'], added: [draft({ programmaticName: 'sg_lens', dataType: 'number' })] }),
			OTHERS,
			mint()
		);
		expect(plan.ok).toBe(true);
		if (!plan.ok) return;
		expect(plan.deletes).toEqual(['e1']);
		expect(plan.entries.map((e) => [e.id, e.programmaticName, e.dataType])).toEqual([
			['n1', 'sg_lens', 'number'],
			['e2', 'sg_slate', 'text']
		]);
	});

	it('EDT-44, MOD-5: two entries may swap their names in one save', () => {
		const plan = planSave(
			stored([lens, slate]),
			request({ changed: [{ ...lens, programmaticName: 'sg_slate' }, { ...slate, programmaticName: 'sg_lens' }] }),
			OTHERS,
			mint()
		);
		expect(plan.ok && plan.entries.map((e) => [e.id, e.programmaticName])).toEqual([
			['e2', 'sg_lens'],
			['e1', 'sg_slate']
		]);
	});

	it('MOD-5: refuses an addition that repeats a kept pair', () => {
		const plan = planSave(stored([lens, slate]), request({ added: [draft({ programmaticName: 'sg_slate' })] }), OTHERS, mint());
		expect(plan).toEqual({
			ok: false,
			reason: 'duplicate_entries',
			pairs: [{ targetEntityType: 'Shot', programmaticName: 'sg_slate' }]
		});
	});

	it('MOD-5, EDT-43: refuses a change that lands on another entry, and two additions alike', () => {
		const moved = planSave(stored([lens, slate]), request({ changed: [{ ...slate, programmaticName: 'sg_lens' }] }), OTHERS, mint());
		expect(moved).toMatchObject({ ok: false, reason: 'duplicate_entries' });
		const twice = planSave(
			stored([lens]),
			request({ added: [draft({ targetEntityType: 'Asset' }), draft({ targetEntityType: 'Asset' })] }),
			OTHERS,
			mint()
		);
		expect(twice).toEqual({
			ok: false,
			reason: 'duplicate_entries',
			pairs: [{ targetEntityType: 'Asset', programmaticName: 'sg_lens' }]
		});
	});

	it('refuses a change to an entry the stored set does not hold, naming it', () => {
		const plan = planSave(stored([lens]), request({ changed: [entry('ghost', { programmaticName: 'sg_g' })] }), OTHERS, mint());
		expect(plan).toEqual({ ok: false, reason: 'entry_missing', entryIds: ['ghost'] });
	});

	it('EDT-44: an entry both removed and changed is removed', () => {
		const plan = planSave(
			stored([lens, slate]),
			request({ removedIds: ['e1'], changed: [{ ...lens, displayName: 'New' }] }),
			OTHERS,
			mint()
		);
		expect(plan).toMatchObject({ ok: true, entries: [slate], deletes: ['e1'], puts: [] });
	});

	it('never alters what it is given', () => {
		const before = stored([lens, slate]);
		const given = structuredClone(before);
		const req = request({ removedIds: ['e1'], changed: [{ ...slate, displayName: ' S ' }], added: [draft({ displayName: ' Z ' })] });
		const reqBefore = structuredClone(req);
		planSave(given, req, OTHERS, mint());
		expect(given).toEqual(before);
		expect(req).toEqual(reqBefore);
	});
});

describe('planSave: a save made elsewhere since the set was loaded (two tabs, audit H1)', () => {
	const T_OTHER = '2026-11-10T10:00:00.000Z';
	const lens = entry('e1');
	const slate = entry('e2', { programmaticName: 'sg_slate', displayName: 'Slate' });
	/** What this tab loaded: the set and both entries at T0. */
	const loaded = (more: Partial<NonNullable<SaveRequest['loaded']>> = {}): NonNullable<SaveRequest['loaded']> => ({
		setChangedAt: T0,
		name: 'Camera report',
		description: 'Lens fields',
		entryChangedAt: { e1: T0, e2: T0 },
		...more
	});
	/** What the other tab stored since: the lens renamed. */
	const renamedElsewhere = stored([{ ...lens, displayName: 'Lens B', changedAt: T_OTHER }, slate], { changedAt: T_OTHER });

	it('the scenario: the other tab renamed a field; this one, on the old state, changes its description: refused, the rename stays', () => {
		const stale = request({ changed: [{ ...lens, description: 'Which lens.' }], loaded: loaded() });
		const plan = planSave(renamedElsewhere, stale, OTHERS, mint());
		expect(plan).toEqual({ ok: false, reason: 'stale', details: false, fields: ['Lens'] });
	});

	it('names every field changed elsewhere that this save would write or remove, as this tab shows them', () => {
		const both = stored(
			[
				{ ...lens, displayName: 'Lens B', changedAt: T_OTHER },
				{ ...slate, description: 'Theirs.', changedAt: T_OTHER }
			],
			{ changedAt: T_OTHER }
		);
		const plan = planSave(both, request({ changed: [{ ...lens, displayName: 'My lens' }], removedIds: ['e2'], loaded: loaded() }), OTHERS, mint());
		// The changed one by the name this tab gave it. The removed one by its stored name: this tab no longer shows it.
		expect(plan).toEqual({ ok: false, reason: 'stale', details: false, fields: ['My lens', 'Slate'] });
	});

	it('a field changed elsewhere that this save leaves alone is no conflict: both changes are kept', () => {
		const plan = planSave(renamedElsewhere, request({ changed: [{ ...slate, description: 'Board.' }], loaded: loaded() }), OTHERS, mint());
		expect(plan).toMatchObject({ ok: true });
		if (!plan.ok) return;
		expect(plan.entries.map((e) => [e.displayName, e.description])).toEqual([
			['Lens B', null],
			['Slate', 'Board.']
		]);
		expect(plan.puts.map((e) => e.id)).toEqual(['e2']);
	});

	it('a change that asks for what is already stored is no conflict, so a request can be applied again', () => {
		const wanted = request({ changed: [{ ...lens, displayName: 'Lens B' }], details: { name: 'Kit', description: null }, loaded: loaded() });
		const first = planSave(stored([lens, slate]), wanted, OTHERS, mint());
		expect(first).toMatchObject({ ok: true });
		if (!first.ok) return;
		const again = planSave({ set: first.set, entries: first.entries }, wanted, OTHERS, mint());
		expect(again).toMatchObject({ ok: true, setChanged: false, puts: [], deletes: [] });
	});

	it('the name or description changed elsewhere, and this save changes them too: refused', () => {
		const renamedSet = stored([lens, slate], { name: 'Camera kit', changedAt: T_OTHER });
		const plan = planSave(renamedSet, request({ details: { name: 'Camera report', description: 'Mine.' }, loaded: loaded() }), OTHERS, mint());
		expect(plan).toEqual({ ok: false, reason: 'stale', details: true, fields: [] });
	});

	it('the name or description changed elsewhere, and this save does not touch them: no conflict', () => {
		const renamedSet = stored([lens, slate], { name: 'Camera kit', changedAt: T_OTHER });
		const plan = planSave(renamedSet, request({ changed: [{ ...lens, description: 'Which lens.' }], loaded: loaded() }), OTHERS, mint());
		expect(plan).toMatchObject({ ok: true, set: { name: 'Camera kit' } });
	});

	it('a field changed elsewhere does not make a rename of the set stale', () => {
		const plan = planSave(renamedElsewhere, request({ details: { name: 'Kit', description: null }, loaded: loaded() }), OTHERS, mint());
		expect(plan).toMatchObject({ ok: true, set: { name: 'Kit' } });
	});

	it('both at once are named together', () => {
		const everything = stored([{ ...lens, displayName: 'Lens B', changedAt: T_OTHER }, slate], { description: 'Theirs.', changedAt: T_OTHER });
		const plan = planSave(
			everything,
			request({ details: { name: 'Camera report', description: 'Mine.' }, changed: [{ ...lens, description: 'Which lens.' }], loaded: loaded() }),
			OTHERS,
			mint()
		);
		expect(plan).toEqual({ ok: false, reason: 'stale', details: true, fields: ['Lens'] });
	});

	it('a removal of a field already removed elsewhere is no conflict', () => {
		const plan = planSave(stored([slate], { changedAt: T_OTHER }), request({ removedIds: ['e1'], loaded: loaded() }), OTHERS, mint());
		expect(plan).toMatchObject({ ok: true, deletes: [] });
	});

	it('nothing changed elsewhere: the set reads as loaded and the save goes through', () => {
		const plan = planSave(stored([lens, slate]), request({ changed: [{ ...lens, description: 'Which lens.' }], loaded: loaded() }), OTHERS, mint());
		expect(plan).toMatchObject({ ok: true, puts: [{ id: 'e1', description: 'Which lens.' }] });
	});

	it('a stale save plans no write and alters nothing it is given', () => {
		const stale = request({ changed: [{ ...lens, description: 'Which lens.' }], loaded: loaded() });
		const before = structuredClone({ renamedElsewhere, stale });
		planSave(renamedElsewhere, stale, OTHERS, mint());
		expect({ renamedElsewhere, stale }).toEqual(before);
	});
});

describe('planDuplicate', () => {
	const source = fieldSet({
		name: 'Lens',
		origin: 'import',
		originDetails: { sourceFiles: 'report.csv', importedAt: T0 }
	});
	const taken = [
		{ id: 's1', name: 'Lens' },
		{ id: 's2', name: 'lens COPY' }
	];

	it('SET-18, SET-19: same description, origin and origin details, new identities and times', () => {
		const snapped = entry('e1', { snapshot: { a: 1 }, snapshotSite: 'https://x', snapshotTime: T0 });
		const plan = planDuplicate(source, [snapped, entry('e2', { programmaticName: 'sg_zoom' })], [{ id: 's1', name: 'Lens' }], mint());
		expect(plan.ok).toBe(true);
		if (!plan.ok) return;
		expect(plan.set).toEqual({ ...source, id: 'n1', name: 'Lens copy', createdAt: T1, changedAt: T1 });
		expect(plan.entries).toEqual([
			{ ...snapped, id: 'n2', setId: 'n1', createdAt: T1, changedAt: T1 },
			{ ...entry('e2', { programmaticName: 'sg_zoom' }), id: 'n3', setId: 'n1', createdAt: T1, changedAt: T1 }
		]);
	});

	it('SET-20, Q9: a taken copy name takes the next free number', () => {
		const plan = planDuplicate(source, [], taken, mint());
		expect(plan).toMatchObject({ ok: true, set: { name: 'Lens copy 2' } });
	});

	it('EDT-9: the working copy can bring its own unsaved name and description', () => {
		const plan = planDuplicate(source, [], taken, mint(), { name: ' Lens kit ', description: 'Edited' });
		expect(plan).toMatchObject({ ok: true, set: { name: 'Lens kit copy', description: 'Edited', origin: 'import' } });
	});

	it('EDT-9: a blank working name falls back to the stored name', () => {
		const plan = planDuplicate(source, [], [], mint(), { name: '  ' });
		expect(plan).toMatchObject({ ok: true, set: { name: 'Lens copy' } });
	});

	it('MOD-5: refuses entries that repeat a pair', () => {
		const plan = planDuplicate(source, [draft(), draft()], [], mint());
		expect(plan).toMatchObject({ ok: false, reason: 'duplicate_entries' });
	});
});

describe('refusalMessage', () => {
	it('MOD-1: asks for a name', () => {
		expect(refusalMessage({ ok: false, reason: 'blank_name' })).toBe('Give the set a name.');
	});

	it('MOD-2: names the clashing set and asks for another name', () => {
		expect(refusalMessage({ ok: false, reason: 'name_taken', clashing: { id: 's2', name: 'Weekly Status' } })).toBe(
			'A set named "Weekly Status" already exists. Choose another name.'
		);
	});

	it('MOD-5: names the repeated fields', () => {
		expect(
			refusalMessage({
				ok: false,
				reason: 'duplicate_entries',
				pairs: [
					{ targetEntityType: 'Shot', programmaticName: 'sg_lens' },
					{ targetEntityType: 'Asset', programmaticName: 'sg_kind' }
				]
			})
		).toBe('A set holds each field once. Repeated: Shot.sg_lens, Asset.sg_kind.');
	});

	it('H1: says what another tab changed, that nothing was saved, and what to do', () => {
		const next = 'Nothing was saved. Reload to see it, or duplicate this set to keep your changes.';
		expect(refusalMessage({ ok: false, reason: 'stale', details: false, fields: ['Lens'] })).toBe(`The field "Lens" was changed in another tab. ${next}`);
		expect(refusalMessage({ ok: false, reason: 'stale', details: false, fields: ['Lens', 'Slate'] })).toBe(
			`The fields "Lens" and "Slate" were changed in another tab. ${next}`
		);
		expect(refusalMessage({ ok: false, reason: 'stale', details: true, fields: [] })).toBe(
			`The name or description of this set was changed in another tab. ${next}`
		);
		expect(refusalMessage({ ok: false, reason: 'stale', details: true, fields: ['Lens'] })).toBe(
			`The name or description of this set and the field "Lens" were changed in another tab. ${next}`
		);
		expect(refusalMessage({ ok: false, reason: 'stale', details: false, fields: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] })).toBe(
			`The fields "A", "B", "C", "D", "E" and 2 more were changed in another tab. ${next}`
		);
		expect(refusalMessage({ ok: false, reason: 'stale', details: false, fields: [''] })).toBe(`A field was changed in another tab. ${next}`);
	});

	it('names what went missing', () => {
		expect(refusalMessage({ ok: false, reason: 'set_missing' })).toBe('This set no longer exists.');
		expect(refusalMessage({ ok: false, reason: 'entry_missing', entryIds: ['e1'] })).toBe(
			'A field of this set no longer exists. Reload the set.'
		);
	});
});
