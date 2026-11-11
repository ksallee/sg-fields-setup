import { describe, expect, it } from 'vitest';
import type { PlanItem } from './plan';
import type { PlanReason } from './plan-reason';
import { INITIAL_RUN_STATE, type RunRow, type RunState } from './run';
import {
	GROUPS,
	analysisRows,
	differenceLine,
	groupOf,
	groupRows,
	rowStatus,
	showValue,
	statusLabel,
	typeConflictText,
	viewRows
} from './install-view';

function reason(more: Partial<PlanReason> = {}): PlanReason {
	return {
		code: 'unique-cannot-change',
		entityType: 'Version',
		programmaticName: 'sg_lens',
		displayName: 'Lens',
		dataType: 'text',
		setting: 'unique',
		live: false,
		wanted: true,
		other: null,
		types: [],
		needsTrash: false,
		trashPageUrl: null,
		...more
	};
}

function item(entryId: string, planClass: PlanItem['class'], more: Partial<PlanItem> = {}): PlanItem {
	return {
		entryId,
		entityType: 'Version',
		programmaticName: `sg_${entryId}`,
		displayName: entryId,
		dataType: 'text',
		class: planClass,
		refusal: null,
		liveDataType: planClass === 'create' || planClass === 'refused' ? null : 'text',
		differences: [],
		blocked: [],
		reasons: [],
		create: null,
		update: null,
		reverseFieldTypes: [],
		...more
	};
}

function runRow(entryId: string, more: Partial<RunRow> = {}): RunRow {
	return {
		entryId,
		entityType: 'Version',
		programmaticName: `sg_${entryId}`,
		displayName: entryId,
		dataType: 'text',
		class: 'create',
		state: 'pending',
		note: null,
		effects: [],
		visibility: null,
		...more
	};
}

function run(status: RunState['status'], rows: RunRow[]): RunState {
	return { ...INITIAL_RUN_STATE, status, phase: status === 'running' ? 'applying' : null, rows };
}

describe('groups (RUN-2)', () => {
	it('come in the order of the spec, already matches collapsed at first', () => {
		expect(GROUPS.map((group) => [group.id, group.title, group.open])).toEqual([
			['conflicts', 'Type conflicts', true],
			['blocked', 'Blocked', true],
			['create', 'Create', true],
			['update', 'Update', true],
			['already-matches', 'Already matches', false]
		]);
	});

	it('puts the refusals with the conflicts', () => {
		expect(groupOf('type-conflict')).toBe('conflicts');
		expect(groupOf('refused')).toBe('conflicts');
		expect(groupOf('blocked')).toBe('blocked');
		expect(groupOf('create')).toBe('create');
		expect(groupOf('update')).toBe('update');
		expect(groupOf('already-matches')).toBe('already-matches');
	});

	it('groups the rows in plan order with a count each, and leaves out a group with no row', () => {
		const rows = viewRows(
			[item('a', 'create'), item('b', 'update'), item('c', 'refused'), item('d', 'create'), item('e', 'type-conflict')],
			INITIAL_RUN_STATE
		);
		expect(groupRows(rows).map((group) => [group.id, group.count, group.rows.map((row) => row.entryId)])).toEqual([
			['conflicts', 2, ['c', 'e']],
			['create', 2, ['a', 'd']],
			['update', 1, ['b']]
		]);
	});
});

describe('values and differences (RUN-3)', () => {
	it('shows an empty value as the empty-set sign and a list in brackets', () => {
		expect(showValue('description', null)).toBe('∅');
		expect(showValue('description', '')).toBe('∅');
		expect(showValue('validValues', [])).toBe('∅');
		expect(showValue('validValues', ['a', 'b'])).toBe('[a, b]');
		expect(showValue('description', 'none')).toBe('"none"');
		expect(showValue('defaultValue', false)).toBe('false');
	});

	it('shows unique as on or off', () => {
		expect(showValue('unique', true)).toBe('on');
		expect(showValue('unique', undefined)).toBe('off');
	});

	it('lists a difference as setting, live value, wanted value', () => {
		expect(differenceLine({ setting: 'description', live: '', wanted: 'The lens.' })).toEqual({
			setting: 'description',
			label: 'Description',
			live: '∅',
			wanted: '"The lens."',
			text: 'Description: ∅ → "The lens."'
		});
		expect(differenceLine({ setting: 'validTypes', live: ['Shot'], wanted: ['Shot', 'Asset'] }).text).toBe('Valid types: [Shot] → [Shot, Asset]');
	});

	it('names both data types of a conflict', () => {
		expect(typeConflictText('number', 'text')).toBe('Number on the site, Text in the set');
	});
});

describe('rows (RUN-3, RUN-4)', () => {
	it('gives a checkbox to create, update and already-matches rows only', () => {
		const rows = viewRows(
			[item('a', 'create'), item('b', 'update'), item('c', 'already-matches'), item('d', 'type-conflict'), item('e', 'refused'), item('f', 'blocked')],
			INITIAL_RUN_STATE
		);
		expect(rows.map((row) => row.selectable)).toEqual([true, true, true, false, false, false]);
	});

	it('carries the differences of an update, the blocked ones of a blocked row, both types of a conflict', () => {
		const rows = viewRows(
			[
				item('u', 'update', { differences: [{ setting: 'displayName', live: 'Old', wanted: 'New' }] }),
				item('b', 'blocked', {
					differences: [{ setting: 'description', live: '', wanted: 'x' }],
					blocked: [{ setting: 'unique', live: false, wanted: true, why: 'unique-cannot-change' }],
					reasons: [reason()]
				}),
				item('t', 'type-conflict', { liveDataType: 'number', reasons: [reason({ code: 'type-conflict', setting: null, other: 'number' })] })
			],
			INITIAL_RUN_STATE
		);
		expect(rows[0]?.differences.map((line) => line.text)).toEqual(['Display name: "Old" → "New"']);
		expect(rows[1]?.differences).toEqual([]);
		expect(rows[1]?.blocked.map((line) => line.text)).toEqual(['Unique: off → on']);
		expect(rows[1]?.reasons).toHaveLength(1);
		expect(rows[2]?.conflict).toBe('Number on the site, Text in the set');
		expect(rows[0]?.conflict).toBeNull();
	});

	it('says which types gain a reverse field on a link create or update (finding 121)', () => {
		const [row] = viewRows([item('l', 'create', { dataType: 'entity', reverseFieldTypes: ['Shot', 'Asset'] })], INITIAL_RUN_STATE);
		expect(row?.reverseFields).toBe('Also makes a reverse field on Shot and Asset. Each takes a field name there for good.');
		expect(viewRows([item('a', 'create')], INITIAL_RUN_STATE)[0]?.reverseFields).toBeNull();
	});

	it('names a type by its display name on the site when that says more than the API name', () => {
		const types = [
			{ name: 'Version', displayName: 'Version' },
			{ name: 'CustomEntity19', displayName: 'Lenses' }
		];
		const rows = viewRows([item('a', 'create'), item('b', 'create', { entityType: 'CustomEntity19' }), item('c', 'refused', { entityType: 'CustomEntity30' })], INITIAL_RUN_STATE, types);
		expect(rows.map((row) => row.entityTypeLabel)).toEqual(['Version', 'Lenses (CustomEntity19)', 'CustomEntity30']);
		expect(viewRows([item('b', 'create', { entityType: 'CustomEntity19' })], INITIAL_RUN_STATE)[0]?.entityTypeLabel).toBe('CustomEntity19');
	});

	it('shows the data type as FPT words it', () => {
		expect(viewRows([item('a', 'create', { dataType: 'multi_entity' })], INITIAL_RUN_STATE)[0]?.dataTypeLabel).toBe('Multi-entity link');
	});
});

describe('rows of a run (RUN-19, RUN-22)', () => {
	it('carries the run row by entry id', () => {
		const rows = viewRows([item('a', 'create'), item('b', 'update')], run('running', [runRow('a', { state: 'in_progress' })]));
		expect(rows[0]?.run?.state).toBe('in_progress');
		expect(rows[1]?.run).toBeNull();
	});

	it('moves a row to the class the re-plan gave it and drops the details of the old plan', () => {
		const rows = viewRows(
			[item('a', 'update', { differences: [{ setting: 'displayName', live: 'Old', wanted: 'New' }], reverseFieldTypes: ['Shot'] })],
			run('finished', [runRow('a', { class: 'type-conflict', state: 'skipped' })])
		);
		expect(rows[0]?.class).toBe('type-conflict');
		expect(rows[0]?.group).toBe('conflicts');
		expect(rows[0]?.differences).toEqual([]);
		expect(rows[0]?.reverseFields).toBeNull();
		expect(rows[0]?.selectable).toBe(false);
	});

	it('names each state: skipped by the plan, not selected, and the five of a run', () => {
		const items = [item('a', 'create'), item('b', 'blocked'), item('c', 'update')];
		const idle = viewRows(items, INITIAL_RUN_STATE);
		expect(idle.map((row) => rowStatus(row, INITIAL_RUN_STATE))).toEqual([null, 'skipped', null]);
		const running = run('running', [runRow('a', { state: 'in_progress' })]);
		expect(viewRows(items, running).map((row) => rowStatus(row, running))).toEqual(['in_progress', 'skipped', 'not-selected']);
		for (const state of ['pending', 'in_progress', 'done', 'skipped', 'failed'] as const) {
			const one = run('finished', [runRow('a', { state })]);
			expect(rowStatus(viewRows(items, one)[0]!, one)).toBe(state);
		}
		expect(['pending', 'in_progress', 'done', 'skipped', 'failed', 'not-selected'].map((status) => statusLabel(status as never))).toEqual([
			'Pending',
			'In progress',
			'Done',
			'Skipped',
			'Failed',
			'Not selected'
		]);
	});
});

describe('the rows of the analysis after a run (RUN-26, VIS-8)', () => {
	it('are the plan rows before a run', () => {
		expect(analysisRows([item('a', 'create'), item('b', 'update')], INITIAL_RUN_STATE)).toEqual([
			{ entryId: 'a', class: 'create', entityType: 'Version', programmaticName: 'sg_a' },
			{ entryId: 'b', class: 'update', entityType: 'Version', programmaticName: 'sg_b' }
		]);
	});

	it('reads a field the run made or found as an existing one', () => {
		const items = [item('made', 'create'), item('found', 'create'), item('failed', 'create'), item('pending', 'create'), item('updated', 'update')];
		const state = run('finished', [
			runRow('made', { state: 'done' }),
			runRow('found', { state: 'skipped', note: { code: 'already-exists', differences: [] } }),
			runRow('failed', { state: 'failed', note: { code: 'error', message: 'x' } }),
			runRow('pending'),
			runRow('updated', { class: 'update', state: 'done' })
		]);
		expect(analysisRows(items, state).map((row) => row.class)).toEqual(['already-matches', 'already-matches', 'create', 'create', 'already-matches']);
	});
});
