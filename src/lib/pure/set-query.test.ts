import { describe, expect, it } from 'vitest';
import type { FieldSet, Origin } from './model';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, querySets, type SetSummary } from './set-query';

function summary(
	id: string,
	name: string,
	overrides: Partial<FieldSet> = {},
	entryCount = 0
): SetSummary {
	return {
		set: {
			id,
			name,
			description: null,
			origin: 'manual',
			originDetails: null,
			createdAt: '2026-11-01T09:00:00.000Z',
			changedAt: '2026-11-01T09:00:00.000Z',
			...overrides
		},
		entryCount
	};
}

const names = (items: readonly SetSummary[]) => items.map((item) => item.set.name);

/** `count` sets named "Set 001" up, each changed one minute after the one before. */
function many(count: number): SetSummary[] {
	return Array.from({ length: count }, (_, i) => {
		const n = String(i + 1).padStart(3, '0');
		const minute = String(i % 60).padStart(2, '0');
		const hour = String(Math.floor(i / 60)).padStart(2, '0');
		return summary(`s${n}`, `Set ${n}`, { changedAt: `2026-11-02T${hour}:${minute}:00.000Z` });
	});
}

describe('querySets: search', () => {
	const sets = [
		summary('a', 'Camera Report', { description: 'Lens and slate fields' }),
		summary('b', 'Weekly status', { description: null }),
		summary('c', 'Editorial', { description: 'For the CAMERA team' })
	];

	it('SET-5: matches the name or the description, ignoring case', () => {
		expect(names(querySets(sets, { search: 'camera', sort: 'name' }).items)).toEqual([
			'Camera Report',
			'Editorial'
		]);
	});

	it('SET-5: matches a substring anywhere', () => {
		expect(names(querySets(sets, { search: 'tatu' }).items)).toEqual(['Weekly status']);
	});

	it('SET-5: a set with no description is matched on its name only', () => {
		expect(querySets(sets, { search: 'none' }).total).toBe(0);
		expect(querySets(sets, { search: 'null' }).total).toBe(0);
	});

	it('SET-5: wildcard and query characters are plain text', () => {
		const odd = [
			summary('a', '100% done'),
			summary('b', 'Lens_v2'),
			summary('c', 'Lens v2'),
			summary('d', 'a.c (final) [x]'),
			summary('e', 'abc')
		];
		expect(names(querySets(odd, { search: '%' }).items)).toEqual(['100% done']);
		expect(names(querySets(odd, { search: '_' }).items)).toEqual(['Lens_v2']);
		expect(names(querySets(odd, { search: 'a.c' }).items)).toEqual(['a.c (final) [x]']);
		expect(names(querySets(odd, { search: '(final) [' }).items)).toEqual(['a.c (final) [x]']);
		expect(querySets(odd, { search: '*' }).total).toBe(0);
		expect(querySets(odd, { search: '.*' }).total).toBe(0);
	});

	it('SET-5: ignores how an accent is encoded', () => {
		const accented = [summary('a', 'Caméra')];
		expect(querySets(accented, { search: 'caméra' }).total).toBe(1);
	});

	it('SET-9: an empty or blank search is no constraint', () => {
		expect(querySets(sets, { search: '' }).total).toBe(3);
		expect(querySets(sets, { search: '   ' }).total).toBe(3);
		expect(querySets(sets, {}).total).toBe(3);
		expect(querySets(sets).total).toBe(3);
	});

	it('SET-5: spaces around the typed text are ignored, spaces inside count', () => {
		expect(querySets(sets, { search: ' camera report ' }).total).toBe(1);
		expect(querySets(sets, { search: 'camera  report' }).total).toBe(0);
	});
});

describe('querySets: origin filter', () => {
	const sets = [
		summary('a', 'A', { origin: 'import' }),
		summary('b', 'B', { origin: 'manual' }),
		summary('c', 'C', { origin: 'manual' })
	];

	it('SET-2: keeps the sets of the chosen origin', () => {
		expect(names(querySets(sets, { origin: 'manual', sort: 'name' }).items)).toEqual(['B', 'C']);
		expect(names(querySets(sets, { origin: 'import' }).items)).toEqual(['A']);
		expect(querySets(sets, { origin: 'site_capture' }).total).toBe(0);
	});

	it('SET-9: an unset filter is no constraint', () => {
		expect(querySets(sets, { origin: null }).total).toBe(3);
		expect(querySets(sets, {}).total).toBe(3);
	});

	it('SET-2, SET-5: search and filter combine', () => {
		const mixed = [
			summary('a', 'Lens', { origin: 'import' }),
			summary('b', 'Lens two', { origin: 'manual' }),
			summary('c', 'Slate', { origin: 'manual' })
		];
		const origin: Origin = 'manual';
		expect(names(querySets(mixed, { search: 'lens', origin }).items)).toEqual(['Lens two']);
	});
});

describe('querySets: sort', () => {
	const sets = [
		summary('a', 'beta', { createdAt: '2026-11-01T09:00:00.000Z', changedAt: '2026-11-05T09:00:00.000Z' }),
		summary('b', 'Alpha', { createdAt: '2026-11-03T09:00:00.000Z', changedAt: '2026-11-03T09:00:00.000Z' }),
		summary('c', 'gamma', { createdAt: '2026-11-02T09:00:00.000Z', changedAt: '2026-11-04T09:00:00.000Z' })
	];

	it('SET-4: recently changed, newest first, is the default', () => {
		expect(names(querySets(sets).items)).toEqual(['beta', 'gamma', 'Alpha']);
		expect(names(querySets(sets, { sort: 'changed' }).items)).toEqual(['beta', 'gamma', 'Alpha']);
	});

	it('SET-4: recently created, newest first', () => {
		expect(names(querySets(sets, { sort: 'created' }).items)).toEqual(['Alpha', 'gamma', 'beta']);
	});

	it('SET-4: name ascending, case ignored', () => {
		expect(names(querySets(sets, { sort: 'name' }).items)).toEqual(['Alpha', 'beta', 'gamma']);
	});

	it('SET-4, SET-20: numbered copies sort by their number', () => {
		const copies = [summary('a', 'Lens copy 10'), summary('b', 'Lens copy 2'), summary('c', 'Lens copy')];
		expect(names(querySets(copies, { sort: 'name' }).items)).toEqual([
			'Lens copy',
			'Lens copy 2',
			'Lens copy 10'
		]);
	});

	it('SET-4, SET-8: equal times keep one fixed order, whatever order the sets come in', () => {
		const tied = [summary('x', 'X'), summary('y', 'Y'), summary('z', 'Z')];
		const forward = names(querySets(tied, { sort: 'changed' }).items);
		const backward = names(querySets([...tied].reverse(), { sort: 'changed' }).items);
		expect(backward).toEqual(forward);
	});

	it('does not reorder the array it was given', () => {
		const before = names(sets);
		querySets(sets, { sort: 'name' });
		expect(names(sets)).toEqual(before);
	});
});

describe('querySets: paging', () => {
	it('MOD-22, SET-8: the default page is 20', () => {
		const page = querySets(many(45));
		expect(DEFAULT_PAGE_SIZE).toBe(20);
		expect(page.items).toHaveLength(20);
		expect(page.limit).toBe(20);
		expect(page.offset).toBe(0);
		expect(page.total).toBe(45);
		expect(page.hasMore).toBe(true);
	});

	it('SET-8: the next page starts where the last one ended', () => {
		const sets = many(45);
		const first = querySets(sets, { sort: 'name' });
		const second = querySets(sets, { sort: 'name', offset: first.offset + first.items.length });
		const third = querySets(sets, { sort: 'name', offset: 40 });
		expect(second.items[0].set.name).toBe('Set 021');
		expect(second.hasMore).toBe(true);
		expect(third.items).toHaveLength(5);
		expect(third.hasMore).toBe(false);
	});

	it('B8: an exact multiple of the page size says there is no more, with no empty request', () => {
		const sets = many(40);
		const first = querySets(sets, { sort: 'name' });
		const second = querySets(sets, { sort: 'name', offset: 20 });
		expect(first.hasMore).toBe(true);
		expect(second.items).toHaveLength(20);
		expect(second.total).toBe(40);
		expect(second.hasMore).toBe(false);
	});

	it('B8: one full page is all there is', () => {
		const page = querySets(many(20));
		expect(page.items).toHaveLength(20);
		expect(page.hasMore).toBe(false);
	});

	it('MOD-22: a page is never larger than 100', () => {
		const page = querySets(many(150), { limit: 500 });
		expect(MAX_PAGE_SIZE).toBe(100);
		expect(page.items).toHaveLength(100);
		expect(page.limit).toBe(100);
		expect(page.hasMore).toBe(true);
	});

	it('MOD-22: a page size that is not a positive whole number falls back to the default', () => {
		const sets = many(30);
		expect(querySets(sets, { limit: 0 }).limit).toBe(20);
		expect(querySets(sets, { limit: -5 }).limit).toBe(20);
		expect(querySets(sets, { limit: Number.NaN }).limit).toBe(20);
		expect(querySets(sets, { limit: 7.9 }).limit).toBe(7);
	});

	it('SET-8: an offset past the end is an empty page that still carries the total', () => {
		const page = querySets(many(5), { offset: 50 });
		expect(page.items).toEqual([]);
		expect(page.total).toBe(5);
		expect(page.hasMore).toBe(false);
	});

	it('SET-8: a negative or broken offset starts from the top', () => {
		expect(querySets(many(5), { offset: -3 }).offset).toBe(0);
		expect(querySets(many(5), { offset: Number.NaN }).offset).toBe(0);
	});

	it('SET-8, SET-12: the total counts the matches, not every set', () => {
		const sets = [...many(30), summary('z', 'Other')];
		const page = querySets(sets, { search: 'set 0', limit: 10 });
		expect(page.total).toBe(30);
		expect(page.items).toHaveLength(10);
		expect(querySets(sets, { search: 'nothing' }).total).toBe(0);
	});

	it('SET-3: a row keeps its entry count', () => {
		const page = querySets([summary('a', 'A', {}, 12)]);
		expect(page.items[0].entryCount).toBe(12);
	});
});
