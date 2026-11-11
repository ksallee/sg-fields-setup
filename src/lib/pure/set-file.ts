/**
 * A set as one JSON file, for sharing and backup (D1): encode, decode and validate.
 *
 * The format, version 1:
 *
 *     {
 *     	"format": "sg-fields-setup/set",
 *     	"version": 1,
 *     	"name": "Lens",
 *     	"description": null,
 *     	"origin": "import",
 *     	"originDetails": { "sourceFiles": "report.xlsx", "importedAt": "2026-11-10T09:00:00.000Z" },
 *     	"entries": [
 *     		{
 *     			"targetEntityType": "Shot",
 *     			"programmaticName": "sg_lens",
 *     			"displayName": "Lens",
 *     			"dataType": "text",
 *     			"validTypes": [],
 *     			"validValues": [],
 *     			"defaultValue": null,
 *     			"description": null,
 *     			"uniquePerProject": false,
 *     			"snapshot": null,
 *     			"snapshotSite": null,
 *     			"snapshotTime": null
 *     		}
 *     	]
 *     }
 *
 * - `format` marks the file as a set file. `version` is a positive integer. A later version that
 *   changes the meaning of a key gets a new number; this app refuses a number above its own.
 *   Adding a key does not need a new number: unknown keys are ignored on reading.
 * - Keys are the model's own names, in camelCase (`model.ts`). Values follow the model: none is
 *   `null` or `[]`, a time is an ISO 8601 UTC string as `toISOString` writes it.
 * - An entry is its definition plus its snapshot fields (`EntryDraft`).
 * - No ids: an imported set and its entries get new ones. No created or changed times, on the set
 *   or on an entry: they say when this browser stored its copy, which means nothing in another
 *   browser, and they would make two exports of an unchanged set differ. The importing store
 *   stamps its own. The snapshot time travels: it says when the snapshot was read from the site.
 * - Written with stable key order, tab indentation and a final newline, so a file diffs well.
 *   Entries keep their order. A snapshot's keys are sorted, at every depth.
 * - The suggested file name ends in `.fieldset.json`: still JSON to every tool, and plain to see
 *   among other JSON files.
 *
 * Reading is strict about kinds (a number where text belongs is refused, naming the entry and the
 * key) and lenient about absence: an entry needs only its four required keys, each text (blank
 * is allowed, the editor marks it incomplete, MOD-6); a missing setting, snapshot key, description
 * or origin details is none.
 */
import { cleanEntry } from './clean';
import { ORIGINS, type EntryDraft, type FieldSet, type Origin, type OriginDetails } from './model';

/** The `format` marker of a set file. */
export const SET_FILE_FORMAT = 'sg-fields-setup/set';

/** The newest file version this app writes and reads. */
export const SET_FILE_VERSION = 1;

/** The largest set file that is read. A set of a thousand fields with their snapshots is a few megabytes. */
export const SET_FILE_SIZE_CAP_BYTES = 20 * 1024 * 1024;

/** Whether a file of this size is refused unread. */
export function exceedsSetFileCap(size: number, capBytes: number = SET_FILE_SIZE_CAP_BYTES): boolean {
	return size > capBytes;
}

/** The sentence for a file over the cap, naming it. */
export function setFileTooLargeText(fileName: string, capBytes: number = SET_FILE_SIZE_CAP_BYTES): string {
	return `"${fileName}" is over ${Math.round(capBytes / (1024 * 1024))} MB.`;
}

/**
 * How deep a snapshot may nest: objects and lists inside one another. A field's schema record
 * nests three deep. Deeper than this is no schema record, and far deeper overflows the stack of
 * whatever copies it later, the store first.
 */
export const SNAPSHOT_MAX_DEPTH = 32;

/** The suffix of a suggested set file name. */
export const SET_FILE_SUFFIX = '.fieldset.json';

/** The set's part of a file: what a set carries apart from its id and its times. */
export type SetFileHeader = Pick<FieldSet, 'name' | 'description' | 'origin' | 'originDetails'>;

/** What a set file holds once read: ready for the store, which mints ids, times and a free name. */
export interface DecodedSet extends SetFileHeader {
	/** Cleaned (`cleanEntry`), first of each (target entity type, programmatic name) pair only. */
	entries: EntryDraft[];
	/** How many entries were dropped as repeats of an earlier pair (IMP-48). */
	duplicatesDropped: number;
}

/** The kind of JSON value found where another was expected. `missing` is an absent key. */
export type Found = 'text' | 'number' | 'boolean' | 'list' | 'object' | 'none' | 'missing';

/** The kind of value a key takes. */
export type Expected =
	| 'text'
	| 'textOrNone'
	| 'listOfText'
	| 'list'
	| 'boolean'
	| 'defaultValue'
	| 'objectOrNone'
	| 'originDetailsOrNone'
	| 'origin'
	| 'time'
	| 'timeOrNone';

/** The four keys an entry cannot do without (MOD-6). */
export type RequiredEntryKey = 'targetEntityType' | 'programmaticName' | 'displayName' | 'dataType';

/** Why a file was refused. `entry` is a position counted from 1, as a person counts. */
export type SetFileRefusal =
	| { kind: 'notJson' }
	| { kind: 'notSetFile' }
	| { kind: 'newerVersion'; version: number; known: number }
	| { kind: 'nameMissing' }
	| { kind: 'badSetValue'; key: string; expected: Expected; found: Found }
	| { kind: 'entryNotObject'; entry: number; found: Found }
	| { kind: 'entryKeyMissing'; entry: number; programmaticName: string | null; key: RequiredEntryKey }
	| { kind: 'snapshotTooDeep'; entry: number; programmaticName: string | null; max: number }
	| {
			kind: 'badEntryValue';
			entry: number;
			/** The entry's programmatic name, when it is non-blank text, to help find it. */
			programmaticName: string | null;
			key: string;
			expected: Expected;
			found: Found;
	  };

export type DecodeResult = { ok: true; set: DecodedSet } | { ok: false; refusal: SetFileRefusal };

// Encoding.

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;
const STEM_MAX = 80;

/**
 * A name as the stem of a file name: lowercased, every run of characters that are not letters or
 * digits made one hyphen, no hyphen at either end, at most 80 characters. Letters of any script
 * are kept. No separators and no reserved characters. Empty when nothing is left.
 */
export function fileSlug(name: string): string {
	const slug = name
		.normalize('NFC')
		.toLowerCase()
		.replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
		.replace(/^-+|-+$/g, '');
	return [...slug].slice(0, STEM_MAX).join('').replace(/-+$/, '');
}

/**
 * The file name to suggest for a set called `name`: its `fileSlug`, then `.fieldset.json`. Safe
 * on Windows, macOS and Linux: no separators, no reserved characters, no reserved device names.
 * A name with nothing left is `set`.
 */
export function setFileName(name: string): string {
	let stem = fileSlug(name);
	if (stem === '') stem = 'set';
	if (WINDOWS_RESERVED.test(stem)) stem = `${stem}-set`;
	return `${stem}${SET_FILE_SUFFIX}`;
}

function isContainer(value: unknown): value is object {
	return value !== null && typeof value === 'object';
}

/**
 * A copy of a JSON value with object keys sorted at every depth. It walks with a list of its
 * own, so no depth overflows the stack, and it defines each key, so one named `__proto__` is
 * kept as a key and never sets a prototype.
 */
export function sortKeys(value: unknown): unknown {
	if (!isContainer(value)) return value;
	const empty = (source: object): object => (Array.isArray(source) ? [] : {});
	const root = empty(value);
	const pending: [source: object, copy: object][] = [[value, root]];
	for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
		const [source, copy] = next;
		const keys = Array.isArray(source) ? source.map((_, index) => String(index)) : Object.keys(source).sort();
		for (const key of keys) {
			const item: unknown = (source as Record<string, unknown>)[key];
			const kept = isContainer(item) ? empty(item) : item;
			if (isContainer(item)) pending.push([item, kept as object]);
			Object.defineProperty(copy, key, { value: kept, enumerable: true, writable: true, configurable: true });
		}
	}
	return root;
}

/** Whether a JSON value nests deeper than `max` containers. Walks with a list of its own. */
function deeperThan(value: unknown, max: number): boolean {
	const pending: [value: unknown, depth: number][] = [[value, 1]];
	for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
		const [item, depth] = next;
		if (!isContainer(item)) continue;
		if (depth > max) return true;
		for (const child of Object.values(item)) if (isContainer(child)) pending.push([child, depth + 1]);
	}
	return false;
}

/** The entry as a file writes it: cleaned, the file's keys only, in the model's order. */
function fileEntry(entry: EntryDraft): EntryDraft {
	const e = cleanEntry(entry);
	return {
		targetEntityType: e.targetEntityType,
		programmaticName: e.programmaticName,
		displayName: e.displayName,
		dataType: e.dataType,
		validTypes: e.validTypes,
		validValues: e.validValues,
		defaultValue: e.defaultValue,
		description: e.description,
		uniquePerProject: e.uniquePerProject,
		snapshot: e.snapshot === null ? null : (sortKeys(e.snapshot) as EntryDraft['snapshot']),
		snapshotSite: e.snapshotSite,
		snapshotTime: e.snapshotTime
	};
}

/**
 * The set file for a set and its entries: its JSON text and a suggested file name. Takes stored
 * entries or drafts; ids and times are left out. Entries are written cleaned, in the order given.
 * The same set always gives the same text.
 */
export function encodeSetFile(
	set: SetFileHeader,
	entries: readonly EntryDraft[]
): { text: string; fileName: string } {
	const name = set.name.trim();
	const body = {
		format: SET_FILE_FORMAT,
		version: SET_FILE_VERSION,
		name,
		description: set.description,
		origin: set.origin,
		originDetails:
			set.originDetails === null
				? null
				: { sourceFiles: set.originDetails.sourceFiles, importedAt: set.originDetails.importedAt },
		entries: entries.map(fileEntry)
	};
	return { text: `${JSON.stringify(body, null, '\t')}\n`, fileName: setFileName(name) };
}

// Decoding.

/** Thrown inside decoding, caught at the top: the first problem found ends the reading. */
class Refused {
	constructor(readonly refusal: SetFileRefusal) {}
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function foundOf(value: unknown): Found {
	if (value === undefined) return 'missing';
	if (value === null) return 'none';
	if (typeof value === 'string') return 'text';
	if (typeof value === 'number') return 'number';
	if (typeof value === 'boolean') return 'boolean';
	if (Array.isArray(value)) return 'list';
	return 'object';
}

/** Whether the text is a time exactly as `toISOString` writes it. */
function isTime(value: string): boolean {
	const time = new Date(value);
	return !Number.isNaN(time.getTime()) && time.toISOString() === value;
}

/** Reads one key's value, or reports it with `refuse`. Absent optional keys read as none. */
interface Reader {
	text(key: string): string;
	textOrNone(key: string): string | null;
	listOfText(key: string): string[];
	boolean(key: string): boolean;
	time(key: string): string;
	timeOrNone(key: string): string | null;
}

function reader(source: Json, refuse: (key: string, expected: Expected, value: unknown) => never): Reader {
	return {
		text(key) {
			const value = source[key];
			return typeof value === 'string' ? value : refuse(key, 'text', value);
		},
		textOrNone(key) {
			const value = source[key];
			if (value === undefined || value === null) return null;
			return typeof value === 'string' ? value : refuse(key, 'textOrNone', value);
		},
		listOfText(key) {
			const value = source[key];
			if (value === undefined) return [];
			if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return [...value];
			return refuse(key, 'listOfText', value);
		},
		boolean(key) {
			const value = source[key];
			if (value === undefined) return false;
			return typeof value === 'boolean' ? value : refuse(key, 'boolean', value);
		},
		time(key) {
			const value = source[key];
			return typeof value === 'string' && isTime(value) ? value : refuse(key, 'time', value);
		},
		timeOrNone(key) {
			const value = source[key];
			if (value === undefined || value === null) return null;
			return typeof value === 'string' && isTime(value) ? value : refuse(key, 'timeOrNone', value);
		}
	};
}

function setRefuser(prefix = '') {
	return (key: string, expected: Expected, value: unknown): never => {
		throw new Refused({ kind: 'badSetValue', key: `${prefix}${key}`, expected, found: foundOf(value) });
	};
}

function readOriginDetails(value: unknown): OriginDetails | null {
	if (value === undefined || value === null) return null;
	if (!isObject(value)) return setRefuser()('originDetails', 'originDetailsOrNone', value);
	const read = reader(value, setRefuser('originDetails.'));
	return { sourceFiles: read.text('sourceFiles'), importedAt: read.time('importedAt') };
}

const REQUIRED_ENTRY_KEYS: readonly RequiredEntryKey[] = [
	'targetEntityType',
	'programmaticName',
	'displayName',
	'dataType'
];

function readEntry(value: unknown, position: number): EntryDraft {
	if (!isObject(value)) throw new Refused({ kind: 'entryNotObject', entry: position, found: foundOf(value) });
	const name = value.programmaticName;
	const programmaticName = typeof name === 'string' && name.trim() !== '' ? name.trim() : null;
	for (const key of REQUIRED_ENTRY_KEYS) {
		if (!(key in value)) throw new Refused({ kind: 'entryKeyMissing', entry: position, programmaticName, key });
	}
	const refuse = (key: string, expected: Expected, found: unknown): never => {
		throw new Refused({
			kind: 'badEntryValue',
			entry: position,
			programmaticName,
			key,
			expected,
			found: foundOf(found)
		});
	};
	const read = reader(value, refuse);

	const defaultValue = value.defaultValue;
	const defaultKind = foundOf(defaultValue);
	if (defaultKind === 'number' || defaultKind === 'list' || defaultKind === 'object') {
		refuse('defaultValue', 'defaultValue', defaultValue);
	}
	const snapshot = value.snapshot;
	if (!(snapshot === undefined || snapshot === null || isObject(snapshot))) {
		refuse('snapshot', 'objectOrNone', snapshot);
	}
	if (deeperThan(snapshot, SNAPSHOT_MAX_DEPTH)) {
		throw new Refused({ kind: 'snapshotTooDeep', entry: position, programmaticName, max: SNAPSHOT_MAX_DEPTH });
	}

	return cleanEntry({
		targetEntityType: read.text('targetEntityType'),
		programmaticName: read.text('programmaticName'),
		displayName: read.text('displayName'),
		dataType: read.text('dataType'),
		validTypes: read.listOfText('validTypes'),
		validValues: read.listOfText('validValues'),
		defaultValue: (defaultValue ?? null) as string | boolean | null,
		description: read.textOrNone('description'),
		uniquePerProject: read.boolean('uniquePerProject'),
		snapshot: isObject(snapshot) ? snapshot : null,
		snapshotSite: read.textOrNone('snapshotSite'),
		snapshotTime: read.timeOrNone('snapshotTime')
	});
}

/**
 * The first entry of each (target entity type, programmatic name) pair, and how many repeats were
 * dropped (IMP-48). Compared as `duplicatedIds` compares (MOD-5): on cleaned, case-sensitive
 * names; an entry missing either half is always kept.
 */
function dropDuplicates(entries: EntryDraft[]): { kept: EntryDraft[]; dropped: number } {
	const seen = new Set<string>();
	const kept: EntryDraft[] = [];
	for (const entry of entries) {
		if (entry.targetEntityType !== '' && entry.programmaticName !== '') {
			const pair = JSON.stringify([entry.targetEntityType, entry.programmaticName]);
			if (seen.has(pair)) continue;
			seen.add(pair);
		}
		kept.push(entry);
	}
	return { kept, dropped: entries.length - kept.length };
}

function decode(text: string): DecodedSet {
	let body: unknown;
	try {
		body = JSON.parse(text.replace(/^﻿/, ''));
	} catch {
		throw new Refused({ kind: 'notJson' });
	}
	if (!isObject(body) || body.format !== SET_FILE_FORMAT) throw new Refused({ kind: 'notSetFile' });
	const version = body.version;
	if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
		throw new Refused({ kind: 'notSetFile' });
	}
	if (version > SET_FILE_VERSION) {
		throw new Refused({ kind: 'newerVersion', version, known: SET_FILE_VERSION });
	}

	const read = reader(body, setRefuser());
	if (body.name === undefined || body.name === null) throw new Refused({ kind: 'nameMissing' });
	const name = read.text('name').trim();
	if (name === '') throw new Refused({ kind: 'nameMissing' });
	const description = read.textOrNone('description')?.trim() || null;
	if (!(ORIGINS as readonly unknown[]).includes(body.origin)) setRefuser()('origin', 'origin', body.origin);
	const origin = body.origin as Origin;
	const originDetails = readOriginDetails(body.originDetails);
	if (!Array.isArray(body.entries)) setRefuser()('entries', 'list', body.entries);

	const entries = (body.entries as unknown[]).map((entry, i) => readEntry(entry, i + 1));
	const { kept, dropped } = dropDuplicates(entries);
	return {
		name,
		description,
		origin,
		originDetails: origin === 'import' ? originDetails : null,
		entries: kept,
		duplicatesDropped: dropped
	};
}

/**
 * Reads a set file's text. Either the set, ready to store under new ids, or the first reason it
 * cannot be read. A file of a newer version is refused before anything else in it is read.
 */
export function decodeSetFile(text: string): DecodeResult {
	try {
		return { ok: true, set: decode(text) };
	} catch (error) {
		if (error instanceof Refused) return { ok: false, refusal: error.refusal };
		throw error;
	}
}

// Messages.

const EXPECTED: Readonly<Record<Expected, string>> = {
	text: 'text',
	textOrNone: 'text or null',
	listOfText: 'a list of text',
	list: 'a list',
	boolean: 'true or false',
	defaultValue: 'true, false, text or null',
	objectOrNone: 'an object or null',
	originDetailsOrNone: 'an object with sourceFiles and importedAt, or null',
	origin: ORIGINS.join(', ').replace(/, ([^,]*)$/, ' or $1'),
	time: 'a time like 2026-11-10T09:00:00.000Z',
	timeOrNone: 'a time like 2026-11-10T09:00:00.000Z, or null'
};

const FOUND: Readonly<Record<Found, string>> = {
	text: 'text',
	number: 'a number',
	boolean: 'true or false',
	list: 'a list',
	object: 'an object',
	none: 'null',
	missing: 'missing'
};

/** Kinds where wrong text is still text: saying "is text" would not help. */
const TEXT_KINDS: ReadonlySet<Expected> = new Set(['origin', 'time', 'timeOrNone']);

function wrongValue(key: string, expected: Expected, found: Found): string {
	if (found === 'text' && TEXT_KINDS.has(expected)) return `"${key}" should be ${EXPECTED[expected]}.`;
	return `"${key}" is ${FOUND[found]}. It should be ${EXPECTED[expected]}.`;
}

function entryLabel(entry: number, programmaticName: string | null): string {
	return programmaticName === null ? `Entry ${entry}` : `Entry ${entry} (${programmaticName})`;
}

/** The sentence a person reads for a refusal. */
export function refusalMessage(refusal: SetFileRefusal): string {
	switch (refusal.kind) {
		case 'notJson':
			return 'This file is not valid JSON.';
		case 'notSetFile':
			return 'This file is not a set file.';
		case 'newerVersion':
			return `This set file is version ${refusal.version}. This app reads up to version ${refusal.known}. Reload the app to update it.`;
		case 'nameMissing':
			return 'The set has no name.';
		case 'badSetValue':
			if (refusal.found === 'missing') return `The file has no "${refusal.key}".`;
			return wrongValue(refusal.key, refusal.expected, refusal.found);
		case 'entryNotObject':
			return `Entry ${refusal.entry} is ${FOUND[refusal.found]}. It should be an object.`;
		case 'entryKeyMissing':
			return `${entryLabel(refusal.entry, refusal.programmaticName)} has no "${refusal.key}".`;
		case 'snapshotTooDeep':
			return `${entryLabel(refusal.entry, refusal.programmaticName)}: "snapshot" is nested more than ${refusal.max} deep.`;
		case 'badEntryValue':
			return `${entryLabel(refusal.entry, refusal.programmaticName)}: ${wrongValue(refusal.key, refusal.expected, refusal.found)}`;
	}
}
