/**
 * The data model: a set and its entries (specs/02-data-model.md).
 *
 * Representations, the same everywhere:
 * - Identities are opaque strings. Whoever creates a set or an entry mints the id; nothing reads
 *   meaning into it.
 * - A timestamp is an ISO 8601 UTC string, as `Date.prototype.toISOString()` writes it. It sorts
 *   as text and survives a file export unchanged. Pure code never reads the clock: "now" is an
 *   argument.
 * - "None" is `null` for a single value and `[]` for a list. A stored text is never blank: blank
 *   is none (MOD-7). There is no `undefined` in a stored set or entry.
 * - No "who": sets live in the browser, with no accounts (D1).
 * - No aliases (Q7).
 */

/** An ISO 8601 UTC time, for example `2026-11-10T09:00:00.000Z`. */
export type Timestamp = string;

/** How a set came to be, in the order the list's filter offers them. `site_capture` is reserved (Q6). */
export const ORIGINS = ['import', 'manual', 'site_capture'] as const;

/** Set at creation, never edited. */
export type Origin = (typeof ORIGINS)[number];

/** Where an imported set came from. Only a set of origin `import` has one. */
export interface OriginDetails {
	/** The distinct source file names, joined into one text. */
	sourceFiles: string;
	importedAt: Timestamp;
}

/** A named list of entries. The entries are not held here: each entry names its set. */
export interface FieldSet {
	/** Stable, opaque, assigned at creation. */
	id: string;
	/** Trimmed, never blank (MOD-1). Unique among the stored sets by `setNameKey` (MOD-2). */
	name: string;
	/** Free text, or null for none. */
	description: string | null;
	origin: Origin;
	/** Null unless the origin is `import`. */
	originDetails: OriginDetails | null;
	createdAt: Timestamp;
	/** Moves when the set or any of its entries is stored. */
	changedAt: Timestamp;
}

/**
 * The default value of a field: a boolean for a checkbox, text for a list or a status list, null
 * for none (MOD-10). No other data type carries one (MOD-9).
 */
export type DefaultValue = boolean | string | null;

/**
 * The field an entry defines: the part a person edits and an install reads.
 *
 * Each of the four required texts may be `''` in a working copy; the entry is then incomplete
 * (MOD-6). A setting the data type does not carry is `[]`, `null` or `false` once cleaned (MOD-9).
 */
export interface EntryDefinition {
	/** The entity type's API name: `Shot`, or the slot name `CustomEntity19`, never a display name. */
	targetEntityType: string;
	/** The field's API name on the target type, for example `sg_lens_serial_number`. */
	programmaticName: string;
	/** The label people see. */
	displayName: string;
	/**
	 * The FPT data type, spelled as the API spells it. Any text: a type read from a site is kept
	 * exactly as read, known or not (MOD-14, MOD-16). Only `''` is "no type".
	 */
	dataType: string;
	/** Entity type API names a link may point to, in order (MOD-12). Link types only. */
	validTypes: string[];
	/** The values of a list, in drop-down order, or the short codes of a status list. */
	validValues: string[];
	/** List, status list and checkbox only. */
	defaultValue: DefaultValue;
	/** Free text, or null for none. */
	description: string | null;
	/** Text and number only. Off by default. */
	uniquePerProject: boolean;
}

/**
 * One field's schema record exactly as the site returned it, values still wrapped
 * (`{ value, editable }`, corpus `endpoints/get_schema_type_fields.md`). Never edited, never read
 * for meaning by the model.
 */
export type FieldSnapshot = Readonly<Record<string, unknown>>;

/** Where an entry's definition was captured from. All three are null on an entry made by hand. */
export interface EntrySnapshot {
	snapshot: FieldSnapshot | null;
	/** The site the snapshot came from, as its URL. */
	snapshotSite: string | null;
	/** When it was captured. Storing fills it in when a snapshot comes without one (MOD-8). */
	snapshotTime: Timestamp | null;
}

/** An entry before it is stored: what an import builds, and what a new set takes as its entries. */
export type EntryDraft = EntryDefinition & EntrySnapshot;

/** One field definition in a set. */
export interface Entry extends EntryDefinition, EntrySnapshot {
	/** Stable, opaque. */
	id: string;
	/** The `id` of the set it belongs to. */
	setId: string;
	createdAt: Timestamp;
	changedAt: Timestamp;
}
