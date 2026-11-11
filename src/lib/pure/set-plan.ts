/**
 * What storing does to a set, worked out before anything is written: creating a set with its first
 * entries (MOD-4, IMP-49), saving an edited set (EDT-44 to EDT-48) and duplicating one (SET-18 to
 * SET-20, EDT-9). Each plan is the full next state, or a refusal with a typed reason.
 *
 * Pure. The store (`src/lib/io/set-store.ts`) reads what a plan needs, asks for the plan and
 * writes it in one transaction. Time and new ids come in through a `Mint`, never from globals.
 *
 * Refusals are values, `{ ok: false, reason, ... }`, never thrown. `refusalMessage` words each.
 */
import { cleanEntry, withSnapshotTime } from './clean';
import { copyName, setNameKey } from './copy-name';
import type { Entry, EntryDraft, FieldSet, Origin, OriginDetails, Timestamp } from './model';
import { isValidSetName } from './validity';
import type { SaveRequest } from './working-copy-save';

/** A set as it is stored and read: the set and its entries, ordered as EDT-1 asks. */
export interface StoredSet {
	set: FieldSet;
	entries: Entry[];
}

/** Where a plan gets "now" and new identities. `now` is read once per plan. */
export interface Mint {
	now: () => Timestamp;
	/** A new opaque id, different on every call. */
	newId: () => string;
}

/** The least a plan needs to know of the other sets: enough to find and name a clash (MOD-2). */
export type SetRef = Pick<FieldSet, 'id' | 'name'>;

/** What makes an entry unique in its set (MOD-5), cleaned. */
export interface EntryPair {
	targetEntityType: string;
	programmaticName: string;
}

// --- refusals -----------------------------------------------------------------------------------

/** The name is blank after trimming (MOD-1). */
export interface BlankName {
	ok: false;
	reason: 'blank_name';
}

/** Another set has this name, by `setNameKey` (MOD-2). `clashing` is that set, as it is spelled. */
export interface NameTaken {
	ok: false;
	reason: 'name_taken';
	clashing: SetRef;
}

/** The set would hold a (target entity type, programmatic name) pair more than once (MOD-5). */
export interface DuplicateEntries {
	ok: false;
	reason: 'duplicate_entries';
	/** Each repeated pair once, in the order first met. */
	pairs: EntryPair[];
}

/** The set is not in storage: deleted since it was read, in this tab or another. */
export interface SetMissing {
	ok: false;
	reason: 'set_missing';
}

/** A changed entry is not in the stored set: removed since the set was read. */
export interface EntryMissing {
	ok: false;
	reason: 'entry_missing';
	entryIds: string[];
}

/**
 * The set was saved somewhere else, another tab, after this save's working copy was loaded, and
 * this save would write over what that one stored. Nothing is written. The working copy is the
 * caller's to keep: a duplicate of it saves the work, a reload takes the other state.
 */
export interface Stale {
	ok: false;
	reason: 'stale';
	/** The set's name or description was changed there, and this save changes them too. */
	details: boolean;
	/**
	 * The display names of the fields changed there that this save would change or remove. A changed
	 * one by the name this save gives it, which is what its screen shows; a removed one as stored.
	 */
	fields: string[];
}

export type SetRefusal = BlankName | NameTaken | DuplicateEntries | SetMissing | EntryMissing | Stale;

/** How many fields a stale message names before it counts the rest. */
const STALE_NAMED = 5;

function andJoined(items: readonly string[]): string {
	return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function staleMessage(refusal: Stale): string {
	const named = refusal.fields.filter((name) => name.trim() !== '').map((name) => `"${name}"`);
	const unnamed = refusal.fields.length - named.length;
	const shown = named.slice(0, STALE_NAMED);
	const more = named.length - shown.length + unnamed;
	const what: string[] = [];
	if (refusal.details) what.push('The name or description of this set');
	if (refusal.fields.length > 0) {
		const lead = refusal.details ? 'the' : 'The';
		if (shown.length === 0) what.push(refusal.fields.length === 1 ? (refusal.details ? 'a field' : 'A field') : `${refusal.fields.length} fields`);
		else what.push(`${lead} ${refusal.fields.length === 1 ? 'field' : 'fields'} ${andJoined(more > 0 ? [...shown, `${more} more`] : shown)}`);
	}
	const plural = refusal.fields.length > 1 || (refusal.details && refusal.fields.length > 0);
	return `${what.join(' and ')} ${plural ? 'were' : 'was'} changed in another tab. Nothing was saved. Reload to see it, or duplicate this set to keep your changes.`;
}

/** The plain sentence for a refusal, ready for a dialog or a notification (MOD-2, SET-17, IMP-51). */
export function refusalMessage(refusal: SetRefusal): string {
	switch (refusal.reason) {
		case 'blank_name':
			return 'Give the set a name.';
		case 'name_taken':
			return `A set named "${refusal.clashing.name}" already exists. Choose another name.`;
		case 'duplicate_entries': {
			const fields = refusal.pairs.map((pair) => `${pair.targetEntityType}.${pair.programmaticName}`);
			return `A set holds each field once. Repeated: ${fields.join(', ')}.`;
		}
		case 'set_missing':
			return 'This set no longer exists.';
		case 'entry_missing':
			return 'A field of this set no longer exists. Reload the set.';
		case 'stale':
			return staleMessage(refusal);
	}
}

// --- shared steps -------------------------------------------------------------------------------

function byText(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The entries in the order a set is read: target entity type, then programmatic name (EDT-1),
 * then id so the order is fixed. Plain text order, as the API spells the names. A new array.
 */
export function orderEntries<T extends Pick<Entry, 'id' | 'targetEntityType' | 'programmaticName'>>(
	entries: readonly T[]
): T[] {
	return [...entries].sort(
		(a, b) =>
			byText(a.targetEntityType, b.targetEntityType) ||
			byText(a.programmaticName, b.programmaticName) ||
			byText(a.id, b.id)
	);
}

/** Trimmed, or null when nothing is left (MOD-7, the set table of file 02). */
function cleanDescription(description: string | null | undefined): string | null {
	const text = description?.trim() ?? '';
	return text === '' ? null : text;
}

/** The set among `sets`, other than `ownId`, whose name is `name` by `setNameKey` (MOD-2). */
function clashingSet(name: string, sets: readonly SetRef[], ownId: string | null): SetRef | null {
	const key = setNameKey(name);
	const clash = sets.find((set) => set.id !== ownId && setNameKey(set.name) === key);
	return clash ? { id: clash.id, name: clash.name } : null;
}

function refuseName(name: string, sets: readonly SetRef[], ownId: string | null): BlankName | NameTaken | null {
	if (!isValidSetName(name)) return { ok: false, reason: 'blank_name' };
	const clashing = clashingSet(name, sets, ownId);
	return clashing ? { ok: false, reason: 'name_taken', clashing } : null;
}

/**
 * The storable part of a draft, cleaned (MOD-7, MOD-9), with its snapshot time filled (MOD-8).
 * Only the model's attributes are taken: an id, a set id or a screen's own key on the object
 * given never reaches storage.
 */
function storable(draft: EntryDraft, now: Timestamp): EntryDraft {
	return withSnapshotTime(
		cleanEntry<EntryDraft>({
			targetEntityType: draft.targetEntityType,
			programmaticName: draft.programmaticName,
			displayName: draft.displayName,
			dataType: draft.dataType,
			validTypes: draft.validTypes,
			validValues: draft.validValues,
			defaultValue: draft.defaultValue,
			description: draft.description,
			uniquePerProject: draft.uniquePerProject,
			snapshot: draft.snapshot,
			snapshotSite: draft.snapshotSite,
			snapshotTime: draft.snapshotTime
		}),
		now
	);
}

/** The pairs held more than once, each once (MOD-5). An entry missing either half never counts. */
function repeatedPairs(entries: readonly EntryPair[]): EntryPair[] {
	const seen = new Map<string, number>();
	const repeated: EntryPair[] = [];
	for (const { targetEntityType, programmaticName } of entries) {
		if (targetEntityType === '' || programmaticName === '') continue;
		const key = JSON.stringify([targetEntityType, programmaticName]);
		const count = (seen.get(key) ?? 0) + 1;
		seen.set(key, count);
		if (count === 2) repeated.push({ targetEntityType, programmaticName });
	}
	return repeated;
}

/** Same content, whatever the key order of the objects inside (a snapshot read twice). */
function sameValue(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
	}
	const keysA = Object.keys(a);
	const keysB = Object.keys(b);
	return (
		keysA.length === keysB.length &&
		keysA.every(
			(key) =>
				Object.hasOwn(b, key) &&
				sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
		)
	);
}

// --- create -------------------------------------------------------------------------------------

/** A new set and its first entries (SET-14, IMP-49). */
export interface CreateRequest {
	name: string;
	/** Blank or absent is none. */
	description?: string | null;
	origin: Origin;
	/** Kept only when the origin is `import`. */
	originDetails?: OriginDetails | null;
	/** Absent is an empty set. */
	entries?: readonly EntryDraft[];
}

/** What to write for a new set: one set row and its entry rows, all or nothing (MOD-4). */
export interface CreatePlan extends StoredSet {
	ok: true;
}

/**
 * The set to store for `request`, given every set already stored.
 *
 * The name is trimmed (MOD-1); entries are cleaned (MOD-7, MOD-9) and get their snapshot time
 * (MOD-8). Refuses a blank name, a taken name, and entries that repeat a pair (MOD-5). Incomplete
 * entries are stored as they are: an import may leave a type for the user to fill (IMP-50).
 */
export function planCreate(
	request: CreateRequest,
	existing: readonly SetRef[],
	mint: Mint
): CreatePlan | BlankName | NameTaken | DuplicateEntries {
	const refused = refuseName(request.name, existing, null);
	if (refused) return refused;

	const now = mint.now();
	const setId = mint.newId();
	const entries: Entry[] = (request.entries ?? []).map((draft) => ({
		...storable(draft, now),
		id: mint.newId(),
		setId,
		createdAt: now,
		changedAt: now
	}));
	const pairs = repeatedPairs(entries);
	if (pairs.length > 0) return { ok: false, reason: 'duplicate_entries', pairs };

	return {
		ok: true,
		set: {
			id: setId,
			name: request.name.trim(),
			description: cleanDescription(request.description),
			origin: request.origin,
			originDetails: request.origin === 'import' ? (request.originDetails ?? null) : null,
			createdAt: now,
			changedAt: now
		},
		entries: orderEntries(entries)
	};
}

// --- save ---------------------------------------------------------------------------------------

/** The next stored state of a saved set, and the rows that differ from what is stored. */
export interface SavePlan extends StoredSet {
	ok: true;
	/** Whether the set row itself is to be written: its name, description or changed time moved. */
	setChanged: boolean;
	/** Entry rows to write: the changed ones, then the added ones. */
	puts: Entry[];
	/** Ids of entry rows to delete. */
	deletes: string[];
	/** The entries made for `request.added`, one each, in the same order (EDT-47). */
	added: Entry[];
}

/**
 * The next state of `stored` after `request` (the editor's `SaveRequest`, `working-copy-save.ts`),
 * given every set in storage (the saved one included or not, it is skipped by id).
 *
 * Applied in the order of EDT-44: name and description, removals, changes, additions. MOD-5 is
 * checked on the result, so removing an entry and adding its pair again, or two entries swapping
 * names, is one valid save. An entry both removed and changed is removed.
 *
 * - `details` null keeps the name and description, and the name is not checked again.
 * - A removed id that is already gone is skipped, so a request can be applied again.
 * - A changed entry keeps the stored id, set and created time; its attributes are cleaned again.
 *   One whose id the stored set does not hold is refused, never created.
 *
 * `changedAt` moves, on the set and on each written entry, only when something differs (EDT-45):
 * a save that changes nothing plans no write.
 *
 * Refuses a blank name (MOD-1), a name another set has (MOD-2), a repeated pair (MOD-5), and a
 * change to an entry the stored set does not hold.
 *
 * Two tabs. When the request says what it was built on (`request.loaded`) and the stored set has
 * moved since, the save is refused as `stale` where it would write over the other save, and only
 * there:
 *
 * - an entry it changes or removes whose stored `changedAt` is not the loaded one;
 * - the name or description, when the request changes them and the stored ones are not the
 *   loaded ones.
 *
 * What the other save changed and this one leaves alone is no conflict: both are kept. Asking for
 * exactly what is stored is no conflict either, so a request can still be applied again.
 */
export function planSave(
	stored: StoredSet,
	request: SaveRequest,
	existing: readonly SetRef[],
	mint: Mint
): SavePlan | BlankName | NameTaken | DuplicateEntries | EntryMissing | Stale {
	const refused = request.details ? refuseName(request.details.name, existing, stored.set.id) : null;
	if (refused) return refused;

	const now = mint.now();
	const name = request.details ? request.details.name.trim() : stored.set.name;
	const description = request.details ? cleanDescription(request.details.description) : stored.set.description;

	// Saved elsewhere since this request's working copy was loaded: the set's changed time moved.
	const loaded = request.loaded && request.loaded.setChangedAt !== stored.set.changedAt ? request.loaded : null;
	const movedElsewhere = (entry: Entry) => loaded !== null && loaded.entryChangedAt[entry.id] !== entry.changedAt;
	const staleDetails =
		loaded !== null &&
		request.details !== null &&
		(stored.set.name !== loaded.name || stored.set.description !== loaded.description) &&
		(name !== stored.set.name || description !== stored.set.description);
	const staleFields: string[] = [];

	const removed = new Set(request.removedIds);
	const removedEntries = stored.entries.filter((entry) => removed.has(entry.id));
	const deletes = removedEntries.map((entry) => entry.id);
	const next = new Map(stored.entries.filter((entry) => !removed.has(entry.id)).map((entry) => [entry.id, entry]));

	const written = new Map<string, Entry>();
	const missing: string[] = [];
	for (const change of request.changed) {
		if (removed.has(change.id)) continue;
		const current = next.get(change.id);
		if (!current) {
			missing.push(change.id);
			continue;
		}
		const attributes = storable(change, now);
		const candidate: Entry = { ...current, ...attributes };
		if (sameValue(candidate, current)) continue;
		if (movedElsewhere(current)) staleFields.push(attributes.displayName);
		const entry = { ...candidate, changedAt: now };
		next.set(entry.id, entry);
		written.set(entry.id, entry);
	}
	if (missing.length > 0) return { ok: false, reason: 'entry_missing', entryIds: missing };
	for (const entry of removedEntries) if (movedElsewhere(entry)) staleFields.push(entry.displayName);
	if (staleDetails || staleFields.length > 0) return { ok: false, reason: 'stale', details: staleDetails, fields: staleFields };

	const added: Entry[] = request.added.map((draft) => ({
		...storable(draft, now),
		id: mint.newId(),
		setId: stored.set.id,
		createdAt: now,
		changedAt: now
	}));

	const entries = [...next.values(), ...added];
	const pairs = repeatedPairs(entries);
	if (pairs.length > 0) return { ok: false, reason: 'duplicate_entries', pairs };

	const puts = [...written.values(), ...added];
	const setChanged =
		name !== stored.set.name ||
		description !== stored.set.description ||
		puts.length > 0 ||
		deletes.length > 0;

	return {
		ok: true,
		set: setChanged ? { ...stored.set, name, description, changedAt: now } : stored.set,
		entries: orderEntries(entries),
		setChanged,
		puts,
		deletes,
		added
	};
}

// --- duplicate ----------------------------------------------------------------------------------

/** What a duplicate takes from the editor's working copy instead of the stored set (EDT-9). */
export interface DuplicateOverrides {
	/** The working copy's name. Blank or absent: the stored name. The copy suffix is added to it. */
	name?: string;
	/** The working copy's description. Absent: the stored one. */
	description?: string | null;
}

/**
 * A copy of `source` holding `drafts`: same description, origin and origin details, every
 * attribute of every entry, snapshots and their times included, new identities and times
 * (SET-19). The name is `copyName` over the names in `existing`, so it is always free (SET-20,
 * Q9). Refuses only entries that repeat a pair (MOD-5).
 *
 * `drafts` may be stored entries: their ids, set and times are not copied.
 */
export function planDuplicate(
	source: FieldSet,
	drafts: readonly EntryDraft[],
	existing: readonly SetRef[],
	mint: Mint,
	overrides: DuplicateOverrides = {}
): CreatePlan | DuplicateEntries {
	const base = overrides.name !== undefined && isValidSetName(overrides.name) ? overrides.name : source.name;
	const plan = planCreate(
		{
			name: copyName(
				base,
				existing.map((set) => set.name)
			),
			description: overrides.description === undefined ? source.description : overrides.description,
			origin: source.origin,
			originDetails: source.originDetails,
			entries: drafts
		},
		existing,
		mint
	);
	if (!plan.ok && plan.reason !== 'duplicate_entries') {
		// `copyName` gives a name that is neither blank nor taken.
		throw new Error(`copyName gave an unusable name: ${plan.reason}`);
	}
	return plan;
}
