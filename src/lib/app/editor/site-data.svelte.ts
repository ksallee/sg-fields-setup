/**
 * The connected site as the editor reads it for one session (CMP-1 to CMP-4, CMP-10, CMP-11):
 * whether there is one, its entity types, and the fields of the types in use, each read once in
 * the background through `liveSchema()`. Holds the reads and the state; what they mean is
 * `$lib/pure/compare`.
 */
import type { SgContext } from 'sg-widgets-core';
import { liveContext, liveSchema, prepareLive } from '$lib/live';
import type { SiteData } from '$lib/pure/compare';
import type { LiveEntityType } from '$lib/pure/live-entity-types';
import type { LiveField } from '$lib/pure/live-field';

export class EditorSite {
	/** A site is named and can be read. False until `connect` has answered. */
	connected = $state(false);
	siteUrl = $state('');
	/** The widgets' context, or null with no site: the pickers then give way to typed inputs. */
	context = $state.raw<SgContext | null>(null);
	/** The site's types; null until read, and when the read failed (CMP-1). */
	entityTypes = $state.raw<readonly LiveEntityType[] | null>(null);
	/** The re-check of CMP-10 is running. */
	rechecking = $state(false);

	/** The type list was read, or its read failed: field reads may start. */
	#typesSettled = $state(false);
	/** Moves when a field listing arrives, so the comparison runs again (CMP-11). */
	#arrivals = $state(0);
	#asked = new Set<string>();

	/** What `compareWithSite` takes: null with no site (CMP-3). A new object whenever a read lands. */
	readonly data: SiteData | null = $derived.by(() => {
		if (!this.connected) return null;
		void this.#arrivals;
		const schema = liveSchema();
		return { entityTypes: this.entityTypes, fieldsOf: (type: string) => schema.cachedFields(type) };
	});

	readonly #labels = $derived(new Map((this.entityTypes ?? []).map((type) => [type.name, type.displayName])));

	/** The site's display name for a type, or undefined when not known (EDT-17). */
	typeLabel = (name: string): string | undefined => this.#labels.get(name);

	/** Settles the connection and reads the type list once (CMP-1). Never throws. */
	async connect(): Promise<void> {
		try {
			const live = await prepareLive();
			if (live.siteUrl === '' || live.problem !== null) return;
			this.siteUrl = live.siteUrl;
			this.context = liveContext();
			this.connected = true;
			try {
				this.entityTypes = await liveSchema().entityTypes();
			} catch {
				// No list: fields are still compared, and no type is marked absent (compare.ts).
			}
			this.#typesSettled = true;
		} catch {
			/* No site: no comparison (CMP-3). */
		}
	}

	/**
	 * Reads, once each and in the background, the fields of the types not asked for yet (CMP-2).
	 * A type the loaded list lacks is not read (CMP-4, CMP-10). A read that fails counts as no
	 * fields and shows nothing.
	 */
	ensureFields(types: readonly string[]): void {
		if (!this.connected || !this.#typesSettled) return;
		const known = this.entityTypes ? new Set(this.entityTypes.map((type) => type.name)) : null;
		for (const type of types) {
			if (this.#asked.has(type) || (known && !known.has(type))) continue;
			this.#asked.add(type);
			void liveSchema()
				.fieldsOrEmpty(type)
				.then(() => (this.#arrivals += 1));
		}
	}

	/** The fields of each given type, read if not held: what re-sync matches against (EDT-42). */
	async fieldsByType(types: readonly string[]): Promise<Map<string, readonly LiveField[]>> {
		const schema = liveSchema();
		const lists = await Promise.all(types.map((type) => schema.fieldsOrEmpty(type)));
		for (const type of types) this.#asked.add(type);
		this.#arrivals += 1;
		return new Map(types.map((type, i) => [type, lists[i]]));
	}

	/** Reads the type list again (CMP-10). Rejects when the read fails; the list held stays. */
	async recheck(): Promise<void> {
		if (!this.connected || this.rechecking) return;
		this.rechecking = true;
		try {
			this.entityTypes = await liveSchema().refreshEntityTypes();
		} finally {
			this.rechecking = false;
		}
	}
}
