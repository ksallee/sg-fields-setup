/**
 * The set list screen's state (specs/03-set-list.md): the filters, the rows loaded so far, and
 * which answer the screen is waiting for. Pure: the page sends the requests these functions hand
 * back and feeds the answers in. Every function returns a new state and leaves its input alone.
 *
 * How a load runs: `startLoad` or `startMore` gives a request with an id; the page calls the
 * store with `request.query`, then `receivePage` or `failLoad` with that id. Only the answer to
 * the latest request is taken. Any other is dropped, so a slow answer to an old search never
 * overwrites a newer one.
 *
 * Decisions where the spec leaves room:
 * - While a new first page loads, the rows on screen stay (the page dims them). The loading line
 *   of SET-10 shows only when there is no row to keep: the store is local and answers in a few
 *   milliseconds, so blanking the list on every keystroke would only flicker.
 * - A reload with no filter change (after a duplicate, SET-21) asks for as many rows as were
 *   loaded, up to the largest page (MOD-22), so the list does not jump back to 20.
 * - A failed first load is its own view with a way to retry, beside the notification (SET-13).
 *   "No sets yet" would be a lie there.
 */
import type { Origin } from './model';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type SetPage, type SetQuery, type SetSort, type SetSummary } from './set-query';

/** What the toolbar holds (SET-2). `search` is kept as typed; the store trims it. */
export interface SetListFilters {
	search: string;
	/** Null is every origin. */
	origin: Origin | null;
	sort: SetSort;
}

/** No search, every origin, recently changed first (SET-4). */
export const DEFAULT_FILTERS: SetListFilters = Object.freeze({ search: '', origin: null, sort: 'changed' });

export interface SetListState {
	filters: SetListFilters;
	rows: SetSummary[];
	/** How many sets match the filters, over all pages. */
	total: number;
	hasMore: boolean;
	/** `loading`: a first page is awaited. `loadingMore`: a next page is. */
	phase: 'loading' | 'loadingMore' | 'ready';
	/** The last answer was a failure and nothing has answered since. */
	failed: boolean;
	/** The id of the request whose answer is awaited, or null. */
	pending: number | null;
	/** The last id given out. */
	sequence: number;
}

/** A request for the page to send: `store.listSets(request.query)`, then answer with `request.id`. */
export interface SetListRequest {
	id: number;
	query: Required<SetQuery>;
}

/** What the screen shows in place of the list, or `rows` for the list itself. */
export type SetListView = 'loading' | 'empty' | 'noMatch' | 'failed' | 'rows';

/** The screen before anything is asked: the loading view (SET-10). Follow with `startLoad`. */
export function initialSetList(): SetListState {
	return {
		filters: { ...DEFAULT_FILTERS },
		rows: [],
		total: 0,
		hasMore: false,
		phase: 'loading',
		failed: false,
		pending: null,
		sequence: 0
	};
}

/** Whether a search or an origin narrows the list (SET-9, SET-11, SET-12). The sort does not. */
export function isFiltered(filters: SetListFilters): boolean {
	return filters.search.trim() !== '' || filters.origin !== null;
}

function request(state: SetListState, offset: number, limit: number): { state: SetListState; request: SetListRequest } {
	const id = state.sequence + 1;
	return {
		state: { ...state, pending: id, sequence: id },
		request: { id, query: { ...state.filters, offset, limit } }
	};
}

/**
 * Starts a load from the first page (SET-6, SET-7). With `change`, the filters take it and the
 * page is the default size. Without, it is a reload of what is on screen (SET-21).
 */
export function startLoad(
	state: SetListState,
	change?: Partial<SetListFilters>
): { state: SetListState; request: SetListRequest } {
	const limit = change ? DEFAULT_PAGE_SIZE : Math.min(Math.max(state.rows.length, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
	const filters = change ? { ...state.filters, ...change } : state.filters;
	return request({ ...state, filters, phase: 'loading', failed: false }, 0, limit);
}

/** Starts the next page (SET-8), or null when there is none or a load is already in flight (B8). */
export function startMore(state: SetListState): { state: SetListState; request: SetListRequest } | null {
	if (state.phase !== 'ready' || !state.hasMore) return null;
	return request({ ...state, phase: 'loadingMore' }, state.rows.length, DEFAULT_PAGE_SIZE);
}

/** Takes the answer to request `id`. An answer to any other request is dropped. */
export function receivePage(state: SetListState, id: number, page: SetPage): SetListState {
	if (state.pending !== id) return state;
	let rows = page.items;
	if (state.phase === 'loadingMore') {
		const shown = new Set(state.rows.map((row) => row.set.id));
		rows = [...state.rows, ...page.items.filter((row) => !shown.has(row.set.id))];
	}
	return { ...state, rows, total: page.total, hasMore: page.hasMore, phase: 'ready', failed: false, pending: null };
}

/** Request `id` failed (SET-13): the rows stay and the screen is usable. A stale failure is dropped. */
export function failLoad(state: SetListState, id: number): SetListState {
	if (state.pending !== id) return state;
	return { ...state, phase: 'ready', failed: true, pending: null };
}

/**
 * The set `id` was deleted (SET-23): its row leaves, the total drops, nothing reloads. An answer
 * still on its way was counted before the delete, so it is dropped.
 */
export function removeRow(state: SetListState, id: string): SetListState {
	const rows = state.rows.filter((row) => row.set.id !== id);
	if (rows.length === state.rows.length) return state;
	const total = Math.max(state.total - 1, 0);
	return { ...state, rows, total, hasMore: rows.length < total, phase: 'ready', pending: null };
}

/** What the screen shows (SET-10 to SET-13). */
export function listView(state: SetListState): SetListView {
	if (state.rows.length > 0) return 'rows';
	if (state.phase === 'loading') return 'loading';
	if (state.failed) return 'failed';
	// Rows remain past the ones removed: the list shows its "loading more" line and asks for them.
	if (state.hasMore) return 'rows';
	return isFiltered(state.filters) ? 'noMatch' : 'empty';
}
