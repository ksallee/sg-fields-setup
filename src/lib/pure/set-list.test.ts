import { describe, expect, it } from 'vitest';
import type { SetPage, SetSummary } from './set-query';
import {
	DEFAULT_FILTERS,
	failLoad,
	initialSetList,
	isFiltered,
	listView,
	receivePage,
	removeRow,
	startLoad,
	startMore,
	type SetListState
} from './set-list';

function summary(id: string): SetSummary {
	return {
		set: {
			id,
			name: `Set ${id}`,
			description: null,
			origin: 'manual',
			originDetails: null,
			createdAt: '2026-11-01T09:00:00.000Z',
			changedAt: '2026-11-01T09:00:00.000Z'
		},
		entryCount: 0
	};
}

function page(ids: string[], total: number, offset = 0, limit = 20): SetPage {
	return { items: ids.map(summary), total, offset, limit, hasMore: offset + ids.length < total };
}

const ids = (state: SetListState) => state.rows.map((row) => row.set.id);

/** A list that has loaded `loaded` of `total` rows. */
function loaded(rowIds: string[], total: number): SetListState {
	const { state, request } = startLoad(initialSetList());
	return receivePage(state, request.id, page(rowIds, total));
}

describe('set list: first load', () => {
	it('SET-10 starts in the loading view', () => {
		expect(listView(initialSetList())).toBe('loading');
	});

	it('SET-4 SET-9 asks for the first page, recently changed first, with no constraint', () => {
		const { request } = startLoad(initialSetList());
		expect(request.query).toEqual({ search: '', origin: null, sort: 'changed', offset: 0, limit: 20 });
	});

	it('SET-3 shows the rows of the page that answers', () => {
		const state = loaded(['a', 'b'], 2);
		expect(ids(state)).toEqual(['a', 'b']);
		expect(state.total).toBe(2);
		expect(state.hasMore).toBe(false);
		expect(listView(state)).toBe('rows');
	});

	it('SET-11 is empty when nothing is stored and nothing is asked', () => {
		expect(listView(loaded([], 0))).toBe('empty');
	});

	it('SET-12 is no match when a search or a filter finds nothing', () => {
		const searched = startLoad(initialSetList(), { search: 'lens' });
		expect(listView(receivePage(searched.state, searched.request.id, page([], 0)))).toBe('noMatch');
		const filtered = startLoad(initialSetList(), { origin: 'import' });
		expect(listView(receivePage(filtered.state, filtered.request.id, page([], 0)))).toBe('noMatch');
	});

	it('SET-9 a blank search is not a filter', () => {
		expect(isFiltered({ ...DEFAULT_FILTERS, search: '   ' })).toBe(false);
		expect(isFiltered({ ...DEFAULT_FILTERS, sort: 'name' })).toBe(false);
		expect(isFiltered({ ...DEFAULT_FILTERS, search: 'a' })).toBe(true);
		expect(isFiltered({ ...DEFAULT_FILTERS, origin: 'manual' })).toBe(true);
	});
});

describe('set list: query changes', () => {
	it('SET-6 SET-7 a change of search, filter or sort reloads from the first page', () => {
		const state = loaded(['a', 'b'], 40);
		const next = startLoad(state, { search: 'cam', sort: 'name' });
		expect(next.request.query).toEqual({ search: 'cam', origin: null, sort: 'name', offset: 0, limit: 20 });
		expect(next.state.filters).toEqual({ search: 'cam', origin: null, sort: 'name' });
	});

	it('keeps the old rows on screen, marked busy, until the new page answers', () => {
		const state = loaded(['a', 'b'], 2);
		const next = startLoad(state, { search: 'cam' });
		expect(ids(next.state)).toEqual(['a', 'b']);
		expect(next.state.phase).toBe('loading');
		expect(listView(next.state)).toBe('rows');
		expect(ids(receivePage(next.state, next.request.id, page(['c'], 1)))).toEqual(['c']);
	});

	it('a late answer to an old query never overwrites a newer one', () => {
		const first = startLoad(initialSetList(), { search: 'a' });
		const second = startLoad(first.state, { search: 'ab' });
		// The newer answer lands first, then the older one.
		const fresh = receivePage(second.state, second.request.id, page(['new'], 1));
		const late = receivePage(fresh, first.request.id, page(['old'], 1));
		expect(late).toBe(fresh);
		// The older answer lands first: it is dropped and the list still waits.
		const early = receivePage(second.state, first.request.id, page(['old'], 1));
		expect(early).toBe(second.state);
		expect(early.phase).toBe('loading');
	});

	it('a late failure of an old query is dropped too', () => {
		const first = startLoad(initialSetList(), { search: 'a' });
		const second = startLoad(first.state, { search: 'ab' });
		expect(failLoad(second.state, first.request.id)).toBe(second.state);
	});
});

describe('set list: paging', () => {
	it('SET-8 asks for the next page from the number of rows loaded', () => {
		const state = loaded(['a', 'b'], 5);
		const more = startMore(state);
		expect(more?.request.query).toMatchObject({ offset: 2, limit: 20 });
		expect(more?.state.phase).toBe('loadingMore');
	});

	it('SET-8 appends the page that answers', () => {
		const more = startMore(loaded(['a', 'b'], 3))!;
		const state = receivePage(more.state, more.request.id, page(['c'], 3, 2));
		expect(ids(state)).toEqual(['a', 'b', 'c']);
		expect(state.hasMore).toBe(false);
		expect(state.phase).toBe('ready');
	});

	it('B8 asks for nothing when the total says there is no more', () => {
		expect(startMore(loaded(['a', 'b'], 2))).toBeNull();
	});

	it('asks for nothing while a load is in flight', () => {
		const more = startMore(loaded(['a'], 3))!;
		expect(startMore(more.state)).toBeNull();
		expect(startMore(initialSetList())).toBeNull();
	});

	it('a row already on screen is not appended twice', () => {
		const more = startMore(loaded(['a', 'b'], 4))!;
		const state = receivePage(more.state, more.request.id, page(['b', 'c'], 4, 2));
		expect(ids(state)).toEqual(['a', 'b', 'c']);
	});

	it('a next page that answers after the query changed is dropped', () => {
		const more = startMore(loaded(['a'], 3))!;
		const changed = startLoad(more.state, { sort: 'name' });
		expect(receivePage(changed.state, more.request.id, page(['b'], 3, 1))).toBe(changed.state);
	});
});

describe('set list: reload', () => {
	it('SET-21 a reload with no change keeps the filters and covers the rows already loaded', () => {
		const first = startLoad(initialSetList(), { origin: 'manual' });
		let state = receivePage(first.state, first.request.id, page(Array.from({ length: 20 }, (_, i) => `a${i}`), 45));
		const more = startMore(state)!;
		state = receivePage(more.state, more.request.id, page(Array.from({ length: 20 }, (_, i) => `b${i}`), 45, 20));
		const reload = startLoad(state);
		expect(reload.request.query).toEqual({ search: '', origin: 'manual', sort: 'changed', offset: 0, limit: 40 });
	});

	it('MOD-22 a reload never asks for more than the largest page', () => {
		const state: SetListState = { ...loaded([], 0), rows: Array.from({ length: 130 }, (_, i) => summary(`r${i}`)) };
		expect(startLoad(state).request.query.limit).toBe(100);
	});
});

describe('set list: failure', () => {
	it('SET-13 a failed first load leaves a retry view, not an empty list', () => {
		const { state, request } = startLoad(initialSetList());
		const failed = failLoad(state, request.id);
		expect(failed.phase).toBe('ready');
		expect(listView(failed)).toBe('failed');
	});

	it('SET-13 a failed reload or next page keeps the rows and stays usable', () => {
		const more = startMore(loaded(['a'], 3))!;
		const failed = failLoad(more.state, more.request.id);
		expect(ids(failed)).toEqual(['a']);
		expect(failed.hasMore).toBe(true);
		expect(listView(failed)).toBe('rows');
		expect(startMore(failed)).not.toBeNull();
	});

	it('a load that answers after a failure clears it', () => {
		const first = startLoad(initialSetList());
		const retry = startLoad(failLoad(first.state, first.request.id));
		expect(listView(retry.state)).toBe('loading');
		expect(listView(receivePage(retry.state, retry.request.id, page([], 0)))).toBe('empty');
	});
});

describe('set list: delete', () => {
	it('SET-23 the row leaves the list and the total drops, with no reload', () => {
		const state = removeRow(loaded(['a', 'b', 'c'], 5), 'b');
		expect(ids(state)).toEqual(['a', 'c']);
		expect(state.total).toBe(4);
		expect(state.hasMore).toBe(true);
		expect(startMore(state)?.request.query.offset).toBe(2);
	});

	it('SET-23 removing the last row gives the empty view', () => {
		expect(listView(removeRow(loaded(['a'], 1), 'a'))).toBe('empty');
	});

	it('removing a row that is not listed changes nothing', () => {
		const state = loaded(['a'], 1);
		expect(removeRow(state, 'zz')).toBe(state);
	});

	it('an answer already on its way when a row was removed is dropped', () => {
		const more = startMore(loaded(['a', 'b'], 4))!;
		const removed = removeRow(more.state, 'a');
		expect(removed.phase).toBe('ready');
		expect(receivePage(removed, more.request.id, page(['c', 'd'], 4, 2))).toBe(removed);
	});
});
