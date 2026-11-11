import { describe, expect, it } from 'vitest';
import type { EntryCategory } from './category';
import {
	UNASSIGNED_LABEL,
	buildEditorView,
	groupCountText,
	matchesSearch,
	type EditorViewInput,
	type ViewRow
} from './editor-view';

function row(key: string, targetEntityType = 'Shot', displayName = key, programmaticName = `sg_${key}`): ViewRow {
	return { key, targetEntityType, programmaticName, displayName };
}

const SITE_NAMES: Record<string, string> = { Shot: 'Shot', CustomEntity01: 'Vendor', Asset: 'Asset' };

function input(rows: ViewRow[], over: Partial<EditorViewInput> = {}, categories: Record<string, EntryCategory> = {}): EditorViewInput {
	return {
		rows,
		categoryOf: (key) => categories[key] ?? 'new',
		typeDisplayName: (apiName) => SITE_NAMES[apiName],
		addedGroups: [],
		search: '',
		filter: 'all',
		onSiteFirst: false,
		...over
	};
}

function shape(view: ReturnType<typeof buildEditorView>) {
	return view.groups.map((group) => [group.type, group.keys]);
}

describe('grouping', () => {
	it('EDT-16: rows are grouped by target entity type, groups sorted by stored name', () => {
		const view = buildEditorView(input([row('a', 'Shot'), row('b', 'Asset'), row('c', 'Shot'), row('d', 'CustomEntity01')]));
		expect(shape(view)).toEqual([
			['Asset', ['b']],
			['CustomEntity01', ['d']],
			['Shot', ['a', 'c']]
		]);
	});

	it('EDT-16: the type is trimmed before grouping', () => {
		const view = buildEditorView(input([row('a', 'Shot'), row('b', ' Shot ')]));
		expect(shape(view)).toEqual([['Shot', ['a', 'b']]]);
	});

	it('EDT-16: sorting ignores case and reads numbers as numbers', () => {
		const view = buildEditorView(
			input([row('a', 'shot'), row('b', 'CustomEntity10'), row('c', 'CustomEntity2'), row('d', 'Asset')])
		);
		expect(view.groups.map((group) => group.type)).toEqual(['Asset', 'CustomEntity2', 'CustomEntity10', 'shot']);
	});

	it('EDT-16: blank types form one unassigned group, placed last', () => {
		const view = buildEditorView(input([row('a', ''), row('b', 'Shot'), row('c', '  '), row('d', 'Asset')]));
		expect(shape(view)).toEqual([
			['Asset', ['d']],
			['Shot', ['b']],
			['', ['a', 'c']]
		]);
		const unassigned = view.groups[2];
		expect(unassigned.unassigned).toBe(true);
		expect(unassigned.label).toBe(UNASSIGNED_LABEL);
	});

	it('EDT-17: the label is the site display name when known, else the stored name', () => {
		const view = buildEditorView(input([row('a', 'CustomEntity01'), row('b', 'CustomEntity99')]));
		expect(view.groups.map((group) => group.label)).toEqual(['Vendor', 'CustomEntity99']);
	});

	it('EDT-17: a blank site display name falls back to the stored name', () => {
		const view = buildEditorView(input([row('a', 'Shot')], { typeDisplayName: () => '  ' }));
		expect(view.groups[0].label).toBe('Shot');
	});

	it('EDT-1: within a group rows keep the working copy order', () => {
		const view = buildEditorView(input([row('z'), row('a'), row('m')]));
		expect(view.groups[0].keys).toEqual(['z', 'a', 'm']);
	});

	it('EDT-19: added groups appear with no rows, sorted with the others', () => {
		const view = buildEditorView(input([row('a', 'Shot')], { addedGroups: ['Asset', 'CustomEntity01'] }));
		expect(shape(view)).toEqual([
			['Asset', []],
			['CustomEntity01', []],
			['Shot', ['a']]
		]);
		expect(view.groups[1]).toMatchObject({ label: 'Vendor', added: true, emptyHint: true, total: 0 });
		expect(view.groups[2]).toMatchObject({ added: false, emptyHint: false });
	});

	it('EDT-19: an added group that already has rows is the same group, once', () => {
		const view = buildEditorView(input([row('a', 'Shot')], { addedGroups: [' Shot', 'Shot'] }));
		expect(shape(view)).toEqual([['Shot', ['a']]]);
		expect(view.groups[0]).toMatchObject({ added: false, emptyHint: false });
	});

	it('EDT-19: a blank added group name is ignored', () => {
		const view = buildEditorView(input([], { addedGroups: ['', '  '] }));
		expect(view.groups).toEqual([]);
	});
});

describe('matchesSearch', () => {
	const shot = row('a', 'CustomEntity01', 'Lens Serial', 'sg_lens_serial');

	it('EDT-34: a blank search matches everything', () => {
		expect(matchesSearch(shot, '', undefined)).toBe(true);
		expect(matchesSearch(shot, '   ', undefined)).toBe(true);
	});

	it.each([
		['display name', 'serial'],
		['programmatic name', 'SG_LENS'],
		['target entity type', 'customentity'],
		['the type display name shown on the header', 'vend']
	])('EDT-34: matches on %s, case-insensitive substring', (_what, query) => {
		expect(matchesSearch(shot, query, 'Vendor')).toBe(true);
	});

	it('EDT-34: the query is trimmed', () => {
		expect(matchesSearch(shot, '  lens ', undefined)).toBe(true);
	});

	it('EDT-34: no field containing the query is no match', () => {
		expect(matchesSearch(shot, 'focus', 'Vendor')).toBe(false);
	});
});

describe('search', () => {
	it('EDT-34, EDT-17: search hides rows and the count reads shown of total', () => {
		const view = buildEditorView(input([row('lens'), row('focus'), row('lens_b', 'Asset')], { search: 'LENS' }));
		expect(shape(view)).toEqual([
			['Asset', ['lens_b']],
			['Shot', ['lens']]
		]);
		expect(view.groups[1]).toMatchObject({ shown: 1, total: 2, partial: true });
		expect(view.groups[0]).toMatchObject({ shown: 1, total: 1, partial: false });
		expect(view.visibleKeys).toEqual(['lens_b', 'lens']);
	});

	it('EDT-34: searching the type display name finds its rows', () => {
		const view = buildEditorView(input([row('a', 'CustomEntity01'), row('b', 'Shot')], { search: 'vendor' }));
		expect(view.visibleKeys).toEqual(['a']);
	});
});

describe('status filter', () => {
	const categories: Record<string, EntryCategory> = { a: 'on_site', b: 'new', c: 'needs_attention', d: 'on_site' };
	const rows = [row('a'), row('b'), row('c'), row('d', 'Asset', 'lens')];

	it('EDT-35: the filter keeps only rows of its category', () => {
		const view = buildEditorView(input(rows, { filter: 'on_site' }, categories));
		expect(view.visibleKeys).toEqual(['d', 'a']);
		expect(view.groups.find((group) => group.type === 'Shot')).toMatchObject({ shown: 1, total: 3, partial: true });
	});

	it('EDT-35: counts for each filter over the set', () => {
		const view = buildEditorView(input(rows, {}, categories));
		expect(view.counts).toEqual({ all: 4, on_site: 2, new: 1, needs_attention: 1 });
		expect(view.highlightNeedsAttention).toBe(true);
	});

	it('EDT-35: counts follow the search, not the filter', () => {
		const view = buildEditorView(input(rows, { search: 'lens', filter: 'new' }, categories));
		expect(view.counts).toEqual({ all: 1, on_site: 1, new: 0, needs_attention: 0 });
		expect(view.highlightNeedsAttention).toBe(false);
	});

	it('EDT-35: no needs attention, no highlight', () => {
		const view = buildEditorView(input([row('a')], {}, { a: 'on_site' }));
		expect(view.highlightNeedsAttention).toBe(false);
	});

	it('CMP-8: the category lookup is asked once per row', () => {
		let calls = 0;
		buildEditorView(
			input(rows, {
				onSiteFirst: true,
				filter: 'new',
				categoryOf: () => {
					calls += 1;
					return 'new';
				}
			})
		);
		expect(calls).toBe(rows.length);
	});
});

describe('on-site-first toggle', () => {
	const categories: Record<string, EntryCategory> = {
		a: 'needs_attention',
		b: 'new',
		c: 'on_site',
		d: 'needs_attention',
		e: 'on_site',
		f: 'new'
	};
	const rows = ['a', 'b', 'c', 'd', 'e', 'f'].map((key) => row(key));

	it('EDT-36: on site, then new, then needs attention, order within a category unchanged', () => {
		const view = buildEditorView(input(rows, { onSiteFirst: true }, categories));
		expect(view.groups[0].keys).toEqual(['c', 'e', 'b', 'f', 'a', 'd']);
		expect(view.visibleKeys).toEqual(['c', 'e', 'b', 'f', 'a', 'd']);
	});

	it('EDT-36: off, the working copy order stands', () => {
		const view = buildEditorView(input(rows, {}, categories));
		expect(view.groups[0].keys).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
	});

	it('EDT-36: the sort stays within each group', () => {
		const view = buildEditorView(
			input([row('a', 'Shot'), row('b', 'Asset'), row('c', 'Shot')], { onSiteFirst: true }, { a: 'new', b: 'new', c: 'on_site' })
		);
		expect(shape(view)).toEqual([
			['Asset', ['b']],
			['Shot', ['c', 'a']]
		]);
	});
});

describe('group visibility', () => {
	const rows = [row('lens', 'Shot'), row('focus', 'Asset')];

	it('EDT-37: no search and no filter, every group shows', () => {
		const view = buildEditorView(input(rows, { addedGroups: ['CustomEntity01'] }));
		expect(view.groups.map((group) => group.type)).toEqual(['Asset', 'CustomEntity01', 'Shot']);
	});

	it('EDT-37: with a search, groups with no visible rows hide, added empty groups too', () => {
		const view = buildEditorView(input(rows, { search: 'lens', addedGroups: ['CustomEntity01'] }));
		expect(view.groups.map((group) => group.type)).toEqual(['Shot']);
	});

	it('EDT-37: with a filter and no search, an added empty group still shows', () => {
		const view = buildEditorView(
			input(rows, { filter: 'on_site', addedGroups: ['CustomEntity01'] }, { lens: 'on_site', focus: 'new' })
		);
		expect(view.groups.map((group) => group.type)).toEqual(['CustomEntity01', 'Shot']);
	});

	it('EDT-37: a filter hides a group whose rows are all filtered out', () => {
		const view = buildEditorView(input(rows, { filter: 'needs_attention' }));
		expect(view.groups).toEqual([]);
		expect(view.emptyState).toBe('no_matches');
	});

	it('EDT-17: no search and no filter, nothing is partial', () => {
		const view = buildEditorView(input(rows));
		expect(view.groups.every((group) => !group.partial && group.shown === group.total)).toBe(true);
	});
});

describe('groupCountText', () => {
	it('EDT-17: the total alone when nothing is hidden', () => {
		expect(groupCountText({ shown: 3, total: 3, partial: false })).toBe('3');
	});

	it('EDT-17: shown of total when a search or filter hides some', () => {
		expect(groupCountText({ shown: 1, total: 3, partial: true })).toBe('1 of 3');
	});
});

describe('toolbar and empty state', () => {
	it('EDT-38: the toolbar shows only when the set has entries', () => {
		expect(buildEditorView(input([])).showToolbar).toBe(false);
		expect(buildEditorView(input([], { addedGroups: ['Shot'] })).showToolbar).toBe(false);
		expect(buildEditorView(input([row('a')], { search: 'zzz' })).showToolbar).toBe(true);
	});

	it('EDT-22: no entries and no added groups, the empty message', () => {
		expect(buildEditorView(input([])).emptyState).toBe('no_entries');
	});

	it('EDT-22: an add in progress holds the empty message back', () => {
		expect(buildEditorView(input([], { addInProgress: true })).emptyState).toBe(null);
	});

	it('EDT-22: an added group shows its own hint instead of the empty message', () => {
		const view = buildEditorView(input([], { addedGroups: ['Shot'] }));
		expect(view.emptyState).toBe(null);
		expect(view.groups[0].emptyHint).toBe(true);
	});

	it('EDT-34: entries but nothing matches, the no-match state', () => {
		expect(buildEditorView(input([row('a')], { search: 'zzz' })).emptyState).toBe('no_matches');
		expect(buildEditorView(input([row('a')])).emptyState).toBe(null);
	});
});

describe('purity and speed', () => {
	it('does not mutate its input', () => {
		const rows = [row('b', 'Shot'), row('a', 'Asset')];
		const added = ['CustomEntity01'];
		const frozen = input(Object.freeze(rows.map((r) => Object.freeze(r))) as ViewRow[], {
			addedGroups: Object.freeze(added) as string[],
			onSiteFirst: true
		});
		expect(() => buildEditorView(frozen)).not.toThrow();
		expect(rows.map((r) => r.key)).toEqual(['b', 'a']);
	});

	it('MOD-21: 500 rows in 12 groups compute well under a frame', () => {
		const cats: EntryCategory[] = ['on_site', 'new', 'needs_attention'];
		const rows = Array.from({ length: 500 }, (_, i) => row(`k${i}`, `CustomEntity${i % 12}`, `Field ${i}`));
		const base = input(rows, { onSiteFirst: true, search: 'field 1', filter: 'all', categoryOf: (key) => cats[Number(key.slice(1)) % 3] });
		buildEditorView(base);
		const runs = 20;
		const start = performance.now();
		let view = buildEditorView(base);
		for (let i = 1; i < runs; i++) view = buildEditorView(base);
		const perRun = (performance.now() - start) / runs;
		expect(view.groups.length).toBe(12);
		expect(perRun).toBeLessThan(4);
	});
});
