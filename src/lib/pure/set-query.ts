/**
 * The set list's query: search, origin filter, sort and paging over the set summaries
 * (specs/03-set-list.md). Pure: the store loads the summaries, this picks the page.
 */
import type { FieldSet, Origin } from './model';

/** What one list row shows (SET-3): the set and how many entries it holds. */
export interface SetSummary {
	set: FieldSet;
	entryCount: number;
}

/**
 * The three sorts, each with its one direction (SET-4), in the order the list offers them:
 * `changed` newest first, `created` newest first, `name` A to Z.
 */
export const SET_SORTS = ['changed', 'created', 'name'] as const;

export type SetSort = (typeof SET_SORTS)[number];

/** The page size a listing uses when none is asked for (MOD-22, SET-8). */
export const DEFAULT_PAGE_SIZE = 20;

/** The largest page any listing gives (MOD-22). A larger request is cut to this. */
export const MAX_PAGE_SIZE = 100;

/** Every part is optional. An empty query is the first page of everything, recently changed first. */
export interface SetQuery {
	/**
	 * Matched against the name or the description: case-insensitive substring, the text taken
	 * literally (SET-5). Trimmed first. Empty or blank is no constraint (SET-9).
	 */
	search?: string;
	/** Only sets of this origin. Null or absent is no constraint (SET-9). */
	origin?: Origin | null;
	/** Default `changed` (SET-4). */
	sort?: SetSort;
	/** How many matches to skip: the number of rows already loaded. Default 0. */
	offset?: number;
	/** Page size. Default 20, at most 100 (MOD-22). */
	limit?: number;
}

/** One page of the list, with what the screen needs to know whether to ask for more. */
export interface SetPage {
	items: SetSummary[];
	/** How many sets match the search and the filter, over all pages. */
	total: number;
	/** The offset this page starts at, as applied. */
	offset: number;
	/** The page size as applied, after the default and the maximum. */
	limit: number;
	/** Whether matches remain after this page. From the total, never from a full page (B8). */
	hasMore: boolean;
}

/** The form search compares: accents in one encoding, case folded. */
function fold(text: string): string {
	return text.normalize('NFC').toLowerCase();
}

/** One fixed locale, so the order is the same in every browser. Case ignored, digits by value. */
const byName = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

function byText(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** Ties fall to the name, then the id, so a page boundary never moves between two requests. */
function tieBreak(a: FieldSet, b: FieldSet): number {
	return byName.compare(a.name, b.name) || byText(a.name, b.name) || byText(a.id, b.id);
}

const COMPARE: Record<SetSort, (a: FieldSet, b: FieldSet) => number> = {
	changed: (a, b) => byText(b.changedAt, a.changedAt) || tieBreak(a, b),
	created: (a, b) => byText(b.createdAt, a.createdAt) || tieBreak(a, b),
	name: tieBreak
};

function pageSize(limit: number | undefined): number {
	if (limit === undefined || !Number.isFinite(limit) || limit < 1) return DEFAULT_PAGE_SIZE;
	return Math.min(Math.floor(limit), MAX_PAGE_SIZE);
}

function startAt(offset: number | undefined): number {
	if (offset === undefined || !Number.isFinite(offset) || offset < 0) return 0;
	return Math.floor(offset);
}

/**
 * The page of `summaries` that `query` asks for. Never alters the array it is given.
 *
 * Filter (search, origin), then sort, then cut the page. `total` is counted before the cut.
 */
export function querySets(summaries: readonly SetSummary[], query: SetQuery = {}): SetPage {
	const needle = fold(query.search?.trim() ?? '');
	const origin = query.origin ?? null;
	const compare = COMPARE[query.sort ?? 'changed'];

	const matches = summaries.filter(({ set }) => {
		if (origin !== null && set.origin !== origin) return false;
		if (needle === '') return true;
		return fold(set.name).includes(needle) || (set.description !== null && fold(set.description).includes(needle));
	});
	matches.sort((a, b) => compare(a.set, b.set));

	const offset = startAt(query.offset);
	const limit = pageSize(query.limit);
	const items = matches.slice(offset, offset + limit);
	return {
		items,
		total: matches.length,
		offset,
		limit,
		hasMore: offset + items.length < matches.length
	};
}
