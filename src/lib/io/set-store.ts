/**
 * Sets and entries in the browser's IndexedDB (D1): no server, no accounts. The ownership scope
 * of a set name is this database (D7).
 *
 * The rules live in the pure modules. `set-plan.ts` works out what a create, a save or a
 * duplicate stores, or refuses; `set-query.ts` picks a list page. This module reads what they
 * need, writes what they plan, and does each in ONE transaction, so every write is all or
 * nothing (MOD-3, MOD-4, EDT-48).
 *
 * Database `sg-fields-setup`, version 1:
 *
 * | object store  | key   | value                                   | indexes                 |
 * |---------------|-------|-----------------------------------------|-------------------------|
 * | `sets`        | `id`  | a `FieldSet` plus `nameKey`             | `nameKey`, unique       |
 * | `entries`     | `id`  | an `Entry`                              | `setId`                 |
 * | `preferences` | `key` | `{ key, value }`, one row per preference| none                    |
 *
 * - `nameKey` is `setNameKey(name)`: the form MOD-2 compares. It is written with every set row
 *   and never leaves this module. The clash is found by the plan, inside the transaction, and
 *   comes back as a typed refusal naming the set. The unique index only backs that up.
 * - `entries.setId` gives a set's entries, and counts them for the list without reading a body.
 * - There is no unique index on an entry's (target entity type, programmatic name): incomplete
 *   entries may share a blank half, and two entries may swap names in one save. The plan checks
 *   MOD-5 on the result.
 * - Rows are plain JSON. Timestamps are ISO text, so they sort as text.
 *
 * To change the schema: raise `DB_VERSION` and add a step to `upgrade`. Never edit an old step.
 *
 * Results. A refusal the user can fix is a value: `{ ok: false, reason, ... }` (see `SetRefusal`
 * and `refusalMessage` in `set-plan.ts`). A storage fault is thrown, always as a `SetStoreError`
 * with a plain message: the UI never shows a raw DOMException (MOD-2).
 */
import { setNameKey } from '$lib/pure/copy-name';
import type { Entry, FieldSet, Timestamp } from '$lib/pure/model';
import {
	orderEntries,
	planCreate,
	planDuplicateOf,
	planSave,
	type BlankName,
	type CreateRequest,
	type DuplicateEntries,
	type DuplicateSource,
	type EntryMissing,
	type Mint,
	type NameTaken,
	type SetMissing,
	type Stale,
	type StoredSet
} from '$lib/pure/set-plan';
import type { SaveRequest } from '$lib/pure/working-copy-save';
import { querySets, type SetPage, type SetQuery, type SetSummary } from '$lib/pure/set-query';

export const DB_NAME = 'sg-fields-setup';
export const DB_VERSION = 1;

const SETS = 'sets';
const ENTRIES = 'entries';
const PREFERENCES = 'preferences';
const BY_NAME_KEY = 'nameKey';
const BY_SET = 'setId';

// --- storage faults -----------------------------------------------------------------------------

/**
 * What went wrong with the storage itself:
 * - `unavailable`: the browser has no IndexedDB here, or refuses to open it (some private windows).
 * - `blocked`: another tab holds an older version of the database open.
 * - `outdated`: another tab upgraded the database; this tab's code is older.
 * - `quota`: the browser's storage is full.
 * - `failed`: any other read or write failure.
 */
export type SetStoreErrorKind = 'unavailable' | 'blocked' | 'outdated' | 'quota' | 'failed';

const MESSAGES: Record<SetStoreErrorKind, string> = {
	unavailable: 'This browser cannot store sets. A private window can cause this.',
	blocked: 'Another tab has an older version of this app open. Close it, then reload.',
	outdated: 'This tab is out of date. Reload the page.',
	quota: 'The browser storage is full. Free some space, then try again.',
	failed: 'The browser could not read or write the sets. Try again.'
};

/**
 * The only error this module throws. `message` is plain and ready to show; `kind` lets a screen
 * react; `cause` keeps the browser's own error for the console.
 */
export class SetStoreError extends Error {
	readonly kind: SetStoreErrorKind;

	constructor(kind: SetStoreErrorKind, cause?: unknown) {
		super(MESSAGES[kind], { cause });
		this.name = 'SetStoreError';
		this.kind = kind;
	}
}

function errorName(error: unknown): string {
	return typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
}

function storeError(error: unknown, fallback: SetStoreErrorKind = 'failed'): SetStoreError {
	if (error instanceof SetStoreError) return error;
	const name = errorName(error);
	if (name === 'QuotaExceededError') return new SetStoreError('quota', error);
	if (name === 'VersionError') return new SetStoreError('outdated', error);
	return new SetStoreError(fallback, error);
}

// --- results ------------------------------------------------------------------------------------

/** A set as stored, on success. */
export type Stored = { ok: true } & StoredSet;

export type CreateSetResult = Stored | BlankName | NameTaken | DuplicateEntries;
/** A saved set as reloaded, and the entries stored for the request's `added`, in the same order. */
export type Saved = Stored & { added: Entry[] };

export type SaveSetResult = Saved | BlankName | NameTaken | DuplicateEntries | SetMissing | EntryMissing | Stale;
export type DuplicateSetResult = Stored | SetMissing | DuplicateEntries;

export type { DuplicateSource };

/** What the app remembers for the user of this browser. */
export interface Preferences {
	/** "Do not ask again" on deleting a set (SET-22, EDT-8). False: ask. */
	skipDeleteSetConfirm: boolean;
}

const DEFAULT_PREFERENCES: Preferences = { skipDeleteSetConfirm: false };

export interface SetStore {
	/**
	 * Stores a new set with its first entries, all or nothing (MOD-4, IMP-49, SET-14 to SET-17).
	 * The caller gives origin and origin details. Entries are cleaned as they are stored.
	 * Refuses `blank_name`, `name_taken` (with the clashing set) and `duplicate_entries`.
	 */
	createSet(request: CreateRequest): Promise<CreateSetResult>;

	/** The set and its entries, ordered by target entity type then programmatic name (EDT-1). Null if gone. */
	getSet(id: string): Promise<StoredSet | null>;

	/**
	 * One page of the list with the total count (SET-3 to SET-9, MOD-22, B8). An empty query is
	 * the first 20, recently changed first. Use `offset: rowsAlreadyLoaded` for the next page and
	 * stop when `hasMore` is false.
	 */
	listSets(query?: SetQuery): Promise<SetPage>;

	/**
	 * Saves the editor's request (`saveRequest` in `working-copy-save.ts`) in one transaction
	 * (EDT-44 to EDT-48): name and description, removals, changes, additions. On success the
	 * result is the set as reloaded from storage (EDT-46), and `added`: the stored entries made
	 * for `request.added`, in the same order, which `keysAfterSave` pairs with the rows. Refuses `blank_name`,
	 * `name_taken`, `duplicate_entries`, `set_missing`, `entry_missing` and `stale`: the set was
	 * saved in another tab since the request's working copy was loaded, and this save would write
	 * over that one. The read, the check and the write are one transaction, so no save slips
	 * between them.
	 *
	 * A refusal or a thrown `SetStoreError` means nothing was written, so the same request can be
	 * sent again as it is and an addition is never stored twice (EDT-47). The reload happens
	 * inside the transaction: a save cannot succeed with its reload failed. Applying a request
	 * again is safe: a removal already done is skipped, and a change to an entry that is gone is
	 * refused as `entry_missing`, never created.
	 */
	saveSet(id: string, request: SaveRequest): Promise<SaveSetResult>;

	/**
	 * Copies a set under a free "copy" name (SET-18 to SET-20, Q9): the stored set from the list,
	 * or the editor's working copy or selection when `source` is given (EDT-9; `draftsOf` builds its entries). Never refused
	 * for its name. Refuses `set_missing` and `duplicate_entries`.
	 *
	 * A set deleted in another tab is still copied when `source` gives all of it: name, description
	 * and entries, with the origin the caller loaded (`planDuplicateOf`). The open edits are kept.
	 */
	duplicateSet(id: string, source?: DuplicateSource): Promise<DuplicateSetResult>;

	/** Deletes the set and all its entries (MOD-3). A set that is already gone is not an error. */
	deleteSet(id: string): Promise<void>;

	/** Every preference, with its default where none was stored. */
	getPreferences(): Promise<Preferences>;

	/** Remembers one preference (SET-22). */
	setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): Promise<void>;

	/** Lets go of the database. The next call opens it again. */
	close(): void;
}

export interface SetStoreOptions {
	/** Default: the browser's `indexedDB`. */
	idb?: IDBFactory;
	/** Default: the system clock, as an ISO 8601 UTC text. */
	now?: () => Timestamp;
	/** Default: `crypto.randomUUID()`. */
	newId?: () => string;
	/** The schema version to open. Only tests of the upgrade path pass it. */
	version?: number;
}

// --- IndexedDB, minimal -------------------------------------------------------------------------

function done<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function committed(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onabort = () => reject(tx.error);
	});
}

/** Each step is guarded, so a database left half-made by anything else still ends up whole. */
function upgrade(db: IDBDatabase, oldVersion: number): void {
	if (oldVersion < 1) {
		if (!db.objectStoreNames.contains(SETS)) {
			db.createObjectStore(SETS, { keyPath: 'id' }).createIndex(BY_NAME_KEY, 'nameKey', { unique: true });
		}
		if (!db.objectStoreNames.contains(ENTRIES)) {
			db.createObjectStore(ENTRIES, { keyPath: 'id' }).createIndex(BY_SET, 'setId');
		}
		if (!db.objectStoreNames.contains(PREFERENCES)) {
			db.createObjectStore(PREFERENCES, { keyPath: 'key' });
		}
	}
}

function openDb(idb: IDBFactory | undefined, version: number): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		if (!idb) {
			reject(new SetStoreError('unavailable'));
			return;
		}
		let req: IDBOpenDBRequest;
		try {
			req = idb.open(DB_NAME, version);
		} catch (error) {
			reject(storeError(error, 'unavailable'));
			return;
		}
		let blocked = false;
		req.onupgradeneeded = (event) => upgrade(req.result, event.oldVersion);
		req.onblocked = () => {
			blocked = true;
			reject(new SetStoreError('blocked'));
		};
		req.onerror = () => reject(storeError(req.error, 'unavailable'));
		req.onsuccess = () => {
			// The other tab let go after we gave up: do not hold the database in its place.
			if (blocked) req.result.close();
			else resolve(req.result);
		};
	});
}

/**
 * Plain JSON for storing. Structured clone refuses Svelte's state proxies, and a snapshot is
 * JSON as the site sent it.
 */
function plain<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

type SetRow = FieldSet & { nameKey: string };

function toRow(set: FieldSet): SetRow {
	return { ...plain(set), nameKey: setNameKey(set.name) };
}

function fromRow({ nameKey: _nameKey, ...set }: SetRow): FieldSet {
	return set;
}

// --- the store ----------------------------------------------------------------------------------

class IdbSetStore implements SetStore {
	private db: IDBDatabase | null = null;
	private opening: Promise<IDBDatabase> | null = null;
	private readonly mint: Mint;

	constructor(private readonly options: SetStoreOptions) {
		this.mint = {
			now: options.now ?? (() => new Date().toISOString()),
			newId: options.newId ?? (() => crypto.randomUUID())
		};
	}

	/** The open database, opened on first need and again after `close` or a version change. */
	async connection(): Promise<IDBDatabase> {
		if (this.db) return this.db;
		this.opening ??= openDb(this.options.idb ?? globalThis.indexedDB, this.options.version ?? DB_VERSION).then(
			(db) => {
				// A newer tab wants to upgrade: let it, so it is never blocked by this one.
				db.onversionchange = () => this.close();
				this.db = db;
				this.opening = null;
				return db;
			},
			(error) => {
				this.opening = null;
				throw error;
			}
		);
		return this.opening;
	}

	close(): void {
		this.db?.close();
		this.db = null;
	}

	/**
	 * Runs `body` in one transaction and waits for the commit. If `body` throws, or any request
	 * fails, the transaction is aborted and nothing it wrote stays. `body` must only wait on
	 * requests of this transaction.
	 */
	private async transact<T>(
		stores: string[],
		mode: IDBTransactionMode,
		body: (tx: IDBTransaction) => Promise<T>
	): Promise<T> {
		try {
			const db = await this.connection();
			const tx = db.transaction(stores, mode);
			const commit = committed(tx);
			let result: T;
			try {
				result = await body(tx);
			} catch (error) {
				try {
					tx.abort();
				} catch {
					// Already aborted by the failed request.
				}
				await commit.catch(() => undefined);
				throw error;
			}
			await commit;
			return result;
		} catch (error) {
			throw storeError(error);
		}
	}

	private async readSets(tx: IDBTransaction): Promise<FieldSet[]> {
		const rows = (await done(tx.objectStore(SETS).getAll())) as SetRow[];
		return rows.map(fromRow);
	}

	private async readSet(tx: IDBTransaction, id: string): Promise<StoredSet | null> {
		const row = (await done(tx.objectStore(SETS).get(id))) as SetRow | undefined;
		if (!row) return null;
		const entries = (await done(tx.objectStore(ENTRIES).index(BY_SET).getAll(id))) as Entry[];
		return { set: fromRow(row), entries: orderEntries(entries) };
	}

	/** Queues the writes of one plan and waits for each to be accepted. */
	private async write(
		tx: IDBTransaction,
		changes: { set?: FieldSet; puts?: readonly Entry[]; deletes?: readonly string[] }
	): Promise<void> {
		const entries = tx.objectStore(ENTRIES);
		const requests: IDBRequest[] = [];
		if (changes.set) requests.push(tx.objectStore(SETS).put(toRow(changes.set)));
		for (const id of changes.deletes ?? []) requests.push(entries.delete(id));
		for (const entry of changes.puts ?? []) requests.push(entries.put(plain(entry)));
		await Promise.all(requests.map(done));
	}

	/** The set as it now reads in storage, from inside the transaction that wrote it. */
	private async stored(tx: IDBTransaction, id: string): Promise<Stored> {
		const reloaded = await this.readSet(tx, id);
		if (!reloaded) throw new Error(`set ${id} not found after writing it`);
		return { ok: true, ...reloaded };
	}

	createSet(request: CreateRequest): Promise<CreateSetResult> {
		return this.transact([SETS, ENTRIES], 'readwrite', async (tx) => {
			const plan = planCreate(request, await this.readSets(tx), this.mint);
			if (!plan.ok) return plan;
			await this.write(tx, { set: plan.set, puts: plan.entries });
			return this.stored(tx, plan.set.id);
		});
	}

	getSet(id: string): Promise<StoredSet | null> {
		return this.transact([SETS, ENTRIES], 'readonly', (tx) => this.readSet(tx, id));
	}

	async listSets(query: SetQuery = {}): Promise<SetPage> {
		const summaries = await this.transact([SETS, ENTRIES], 'readonly', async (tx) => {
			const sets = await this.readSets(tx);
			const bySet = tx.objectStore(ENTRIES).index(BY_SET);
			const counts = await Promise.all(sets.map((set) => done(bySet.count(set.id))));
			return sets.map((set, i): SetSummary => ({ set, entryCount: counts[i] }));
		});
		return querySets(summaries, query);
	}

	saveSet(id: string, request: SaveRequest): Promise<SaveSetResult> {
		return this.transact([SETS, ENTRIES], 'readwrite', async (tx): Promise<SaveSetResult> => {
			const current = await this.readSet(tx, id);
			if (!current) return { ok: false, reason: 'set_missing' };
			const plan = planSave(current, request, await this.readSets(tx), this.mint);
			if (!plan.ok) return plan;
			await this.write(tx, {
				set: plan.setChanged ? plan.set : undefined,
				deletes: plan.deletes,
				puts: plan.puts
			});
			const reloaded = await this.stored(tx, id);
			const byId = new Map(reloaded.entries.map((entry) => [entry.id, entry]));
			const added = plan.added.map((entry) => byId.get(entry.id));
			if (added.some((entry) => entry === undefined)) throw new Error('an added entry was not found after writing it');
			return { ...reloaded, added: added as Entry[] };
		});
	}

	duplicateSet(id: string, copied: DuplicateSource = {}): Promise<DuplicateSetResult> {
		return this.transact([SETS, ENTRIES], 'readwrite', async (tx): Promise<DuplicateSetResult> => {
			const plan = planDuplicateOf(await this.readSet(tx, id), copied, await this.readSets(tx), this.mint);
			if (!plan.ok) return plan;
			await this.write(tx, { set: plan.set, puts: plan.entries });
			return this.stored(tx, plan.set.id);
		});
	}

	deleteSet(id: string): Promise<void> {
		return this.transact([SETS, ENTRIES], 'readwrite', async (tx) => {
			const entries = tx.objectStore(ENTRIES);
			const keys = await done(entries.index(BY_SET).getAllKeys(id));
			await Promise.all([tx.objectStore(SETS).delete(id), ...keys.map((key) => entries.delete(key))].map(done));
		});
	}

	getPreferences(): Promise<Preferences> {
		return this.transact([PREFERENCES], 'readonly', async (tx) => {
			const rows = (await done(tx.objectStore(PREFERENCES).getAll())) as { key: string; value: unknown }[];
			const preferences = { ...DEFAULT_PREFERENCES };
			for (const { key, value } of rows) {
				if (key === 'skipDeleteSetConfirm' && typeof value === 'boolean') preferences[key] = value;
			}
			return preferences;
		});
	}

	setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): Promise<void> {
		return this.transact([PREFERENCES], 'readwrite', async (tx) => {
			await done(tx.objectStore(PREFERENCES).put({ key, value }));
		});
	}
}

/**
 * Opens the store, creating or upgrading the database. Throws a `SetStoreError` when the browser
 * has no storage to give (`unavailable`), another tab blocks the upgrade (`blocked`) or this tab
 * is older than the database (`outdated`).
 */
export async function openSetStore(options: SetStoreOptions = {}): Promise<SetStore> {
	const store = new IdbSetStore(options);
	await store.connection();
	return store;
}

let shared: Promise<SetStore> | null = null;

/**
 * The app's one store, on the browser's database, opened on first call. Browser only. A failed
 * open is not remembered: the next call tries again.
 */
export function sharedSetStore(): Promise<SetStore> {
	shared ??= openSetStore().catch((error) => {
		shared = null;
		throw error;
	});
	return shared;
}
