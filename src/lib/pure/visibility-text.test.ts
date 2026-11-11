import { describe, expect, it } from 'vitest';
import type { RowVisibility } from './visibility-analysis';
import type { ScopeProject } from './visibility-scope';
import { NEVER_REMOVED, nothingLeftToDo, projectNames, rowCounters, visibilityCount } from './visibility-text';

const projects = (count: number, from = 1): ScopeProject[] => Array.from({ length: count }, (_, index) => ({ id: from + index, name: `P${from + index}` }));

const state = (over: Partial<RowVisibility> = {}): RowVisibility => ({
	entryId: 'e1',
	class: 'update',
	applies: true,
	visible: [],
	toAdd: [],
	analysing: [],
	locked: [],
	outside: [],
	toHide: [],
	...over
});

describe('projectNames', () => {
	it('VIS-9: lists the names', () => {
		expect(projectNames(projects(1))).toBe('P1');
		expect(projectNames(projects(3))).toBe('P1, P2, P3');
	});

	it('VIS-9: up to 20, then "and N more"', () => {
		expect(projectNames(projects(20)).split(', ')).toHaveLength(20);
		expect(projectNames(projects(21))).toBe(`${projects(20).map((project) => project.name).join(', ')} and 1 more`);
		expect(projectNames(projects(45)).endsWith('P20 and 25 more')).toBe(true);
	});
});

describe('rowCounters', () => {
	it('VIS-9: one small counter per kind that has projects, in a fixed order', () => {
		const counters = rowCounters(
			state({ visible: projects(2), toAdd: projects(1, 3), analysing: projects(1, 4), locked: projects(1, 5), outside: projects(3, 6) })
		);
		expect(counters.map((counter) => [counter.kind, counter.count, counter.label])).toEqual([
			['visible', 2, '2 visible'],
			['toAdd', 1, '1 to add'],
			['analysing', 1, '1 analysing'],
			['locked', 1, '1 locked'],
			['outside', 3, '3 outside']
		]);
		expect(counters.map((counter) => counter.tooltip)).toEqual([
			'Visible on P1, P2.',
			'To be made visible on P3.',
			'Still reading P4.',
			'Hidden on P5. Flow PT does not let this field be shown or hidden.',
			`Also visible on P6, P7, P8. ${NEVER_REMOVED}`
		]);
	});

	it('VIS-6: the reminder is the rule in plain words', () => {
		expect(NEVER_REMOVED).toBe('The tool never removes visibility from a field that existed before the run.');
	});

	it('VIS-4: a create row counts what it adds and what it hides', () => {
		const counters = rowCounters(state({ class: 'create', toAdd: projects(2), toHide: projects(25, 3) }));
		expect(counters.map((counter) => counter.label)).toEqual(['2 to add', '25 to hide']);
		expect(counters[1]!.tooltip).toBe(`A new field. To be hidden on ${projectNames(projects(25, 3))}.`);
	});

	it('gives no counter for a row with nothing to say', () => {
		expect(rowCounters(state())).toEqual([]);
		expect(rowCounters(state({ applies: false, class: 'blocked' }))).toEqual([]);
	});
});

describe('nothingLeftToDo', () => {
	it('RUN-4: an already-matches row with no visibility to add is unticked and disabled', () => {
		expect(nothingLeftToDo(state({ class: 'already-matches', visible: projects(3) }))).toBe(true);
		expect(nothingLeftToDo(state({ class: 'already-matches', visible: projects(2), locked: projects(1, 3) }))).toBe(true);
		expect(nothingLeftToDo(state({ class: 'already-matches' }))).toBe(true);
	});

	it('RUN-4: it stays ticked while there is something to add or still to learn', () => {
		expect(nothingLeftToDo(state({ class: 'already-matches', toAdd: projects(1) }))).toBe(false);
		expect(nothingLeftToDo(state({ class: 'already-matches', analysing: projects(1) }))).toBe(false);
	});

	it('RUN-4: only already-matches rows are ever disabled this way', () => {
		expect(nothingLeftToDo(state({ class: 'update', visible: projects(3) }))).toBe(false);
		expect(nothingLeftToDo(state({ class: 'create' }))).toBe(false);
	});
});

describe('visibilityCount', () => {
	const scope = { kind: 'all-eligible' as const, projects: projects(4) };

	it('VIS-10: the sum of to add over the selected rows once the analysis is loaded', () => {
		const count = visibilityCount([state({ toAdd: projects(2), visible: projects(2, 3) }), state({ class: 'create', toAdd: projects(4) })], scope);
		expect(count).toEqual({ count: 6, upperBound: false, hides: 0, text: '6 visibility changes' });
	});

	it('VIS-10: before that, an upper bound, marked as such', () => {
		const rows = [state({ toAdd: projects(1), analysing: projects(3, 2) }), state({ class: 'create', toAdd: projects(4) }), state({ visible: projects(4) })];
		expect(visibilityCount(rows, scope)).toEqual({ count: 12, upperBound: true, hides: 0, text: 'Up to 12 visibility changes' });
	});

	it('leaves out rows the run skips', () => {
		expect(visibilityCount([state({ applies: false, class: 'blocked' }), state({ analysing: projects(4) })], scope).count).toBe(4);
	});

	it('counts where new fields will be hidden beside it (VIS-4)', () => {
		const chosen = { kind: 'chosen' as const, projects: projects(1) };
		const count = visibilityCount([state({ class: 'create', toAdd: projects(1), toHide: projects(3, 2) })], chosen);
		expect(count).toEqual({ count: 1, upperBound: false, hides: 3, text: '1 visibility change, 3 to hide' });
	});

	it('says none plainly', () => {
		expect(visibilityCount([], scope).text).toBe('No visibility changes');
		expect(visibilityCount([state({ visible: projects(4) })], scope).text).toBe('No visibility changes');
	});
});
