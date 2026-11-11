import { describe, expect, it } from 'vitest';
import { planSet, type CreatePayload, type PlanEntry, type PlanItem, type PropertyName } from './plan';
import type { PlanReason } from './plan-reason';
import { INITIAL_RUN_STATE, type RunRow, type RunState } from './run';
import type { VisibilityForecast } from './visibility-analysis';
import {
	CREATE_LIST_SHOWN,
	CREATE_TEXT_SHOWN,
	GROUPS,
	analysisRows,
	createLines,
	differenceLine,
	groupOf,
	groupRows,
	installCheckLabel,
	rowEnded,
	rowWarned,
	showMoreLabel,
	summaryRows,
	tickRowsOf,
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

describe('what a create writes (RUN-3, A5 of the security audit)', () => {
	const payload = (properties: CreatePayload['properties'], data_type = 'list'): CreatePayload => ({ data_type, properties });

	/** Whether a row shows this property of its create payload, somewhere a person reads it. */
	function shown(row: ReturnType<typeof viewRows>[number], name: PropertyName, value: unknown): boolean {
		if (name === 'name') return row.displayName === value || row.creates.some((line) => line.setting === 'displayName');
		const setting = { description: 'description', valid_values: 'validValues', default_value: 'defaultValue', valid_types: 'validTypes', unique: 'unique' }[name];
		return row.creates.some((line) => line.setting === setting && line.value === showValue(line.setting, value));
	}

	it('lists every property of the payload but the name the row already shows', () => {
		const create = payload([
			{ property_name: 'name', value: 'Lens' },
			{ property_name: 'description', value: 'The lens.' },
			{ property_name: 'valid_values', value: ['Wide', 'Long'] },
			{ property_name: 'default_value', value: 'Wide' },
			{ property_name: 'unique', value: true }
		]);
		const [row] = viewRows([item('a', 'create', { displayName: 'Lens', dataType: 'list', create })], INITIAL_RUN_STATE);
		expect(row.creates.map((line) => line.text)).toEqual(['Description: "The lens."', 'Valid values: [Wide, Long]', 'Default value: "Wide"', 'Unique: on']);
		for (const property of create.properties) expect(shown(row, property.property_name, property.value), property.property_name).toBe(true);
	});

	it('lists the valid types of a link', () => {
		const create = payload(
			[
				{ property_name: 'name', value: 'Shots' },
				{ property_name: 'valid_types', value: ['Shot', 'Asset'] }
			],
			'multi_entity'
		);
		expect(createLines({ displayName: 'Shots', create }).map((line) => line.text)).toEqual(['Valid types: [Shot, Asset]']);
	});

	it('shows a checkbox default as true or false', () => {
		const create = payload([{ property_name: 'default_value', value: false }], 'checkbox');
		expect(createLines({ displayName: 'x', create }).map((line) => line.text)).toEqual(['Default value: false']);
	});

	it('lists the name too, should the payload ever write another than the row shows', () => {
		const create = payload([{ property_name: 'name', value: 'Another' }]);
		expect(createLines({ displayName: 'Lens', create }).map((line) => line.text)).toEqual(['Display name: "Another"']);
	});

	it('has no line for a create that writes the name alone, and none for a row of another class', () => {
		expect(createLines({ displayName: 'Lens', create: payload([{ property_name: 'name', value: 'Lens' }]) })).toEqual([]);
		expect(createLines({ displayName: 'Lens', create: null })).toEqual([]);
		const create = payload([{ property_name: 'description', value: 'x' }]);
		const rows = viewRows([item('u', 'update', { create }), item('c', 'create', { create })], INITIAL_RUN_STATE);
		expect(rows[0]?.creates).toEqual([]);
		expect(rows[1]?.creates).toHaveLength(1);
	});

	it('drops the lines when a run moved the row to another class (RUN-19)', () => {
		const create = payload([{ property_name: 'description', value: 'x' }]);
		const run: RunState = { ...INITIAL_RUN_STATE, rows: [runRow('c', { class: 'update' })] };
		expect(viewRows([item('c', 'create', { create })], run)[0]?.creates).toEqual([]);
	});

	it('cuts a long list to its first values and a count, the whole value kept', () => {
		const values = Array.from({ length: 40 }, (_, i) => `v${i}`);
		const [line] = createLines({ displayName: 'x', create: payload([{ property_name: 'valid_values', value: values }]) });
		expect(line.value).toBe(`[${values.join(', ')}]`);
		expect(line.short).toBe(`[${values.slice(0, CREATE_LIST_SHOWN).join(', ')}, and ${40 - CREATE_LIST_SHOWN} more]`);
		expect(line.text).toBe(`Valid values: ${line.value}`);
	});

	it('does not cut a list of the limit, nor one more: a count of one saves nothing', () => {
		for (const length of [CREATE_LIST_SHOWN, CREATE_LIST_SHOWN + 1]) {
			const values = Array.from({ length }, (_, i) => `v${i}`);
			const [line] = createLines({ displayName: 'x', create: payload([{ property_name: 'valid_values', value: values }]) });
			expect(line.short).toBeNull();
		}
	});

	it('cuts a list of few but long values by its length', () => {
		const values = ['a'.repeat(200), 'b'.repeat(200)];
		const [line] = createLines({ displayName: 'x', create: payload([{ property_name: 'valid_values', value: values }]) });
		expect(line.short).not.toBeNull();
		expect(line.short!.length).toBeLessThanOrEqual(CREATE_TEXT_SHOWN + 1);
		expect(line.short!.endsWith('…')).toBe(true);
	});

	it('cuts a long text with an ellipsis, the whole value kept', () => {
		const text = 'word '.repeat(100).trim();
		const [line] = createLines({ displayName: 'x', create: payload([{ property_name: 'description', value: text }]) });
		expect(line.value).toBe(`"${text}"`);
		expect(line.short).toBe(`${line.value.slice(0, CREATE_TEXT_SHOWN)}…`);
		const brief = createLines({ displayName: 'x', create: payload([{ property_name: 'description', value: 'Short.' }]) })[0];
		expect(brief.short).toBeNull();
	});

	it('shows every property of every create the planner builds', () => {
		const entry = (id: string, displayName: string, more: Partial<PlanEntry> = {}): PlanEntry => ({
			id,
			targetEntityType: 'Shot',
			programmaticName: `sg_${displayName.toLowerCase().replaceAll(' ', '_')}`,
			displayName,
			dataType: 'text',
			validTypes: [],
			validValues: [],
			defaultValue: null,
			description: null,
			uniquePerProject: false,
			...more
		});
		const entries = [
			entry('plain', 'Plain'),
			entry('described', 'Described', { description: 'What it is.', uniquePerProject: true }),
			entry('list', 'Pick one', { dataType: 'list', validValues: ['a', 'b'], defaultValue: 'a' }),
			entry('check', 'Tick', { dataType: 'checkbox', defaultValue: true }),
			entry('link', 'One link', { dataType: 'entity', validTypes: ['Asset'] }),
			entry('links', 'Many links', { dataType: 'multi_entity', validTypes: ['Sequence'], description: 'Linked.' })
		];
		const absent = { kind: 'absent', reason: 'does-not-exist', message: 'No such field.' } as const;
		const types = ['Shot', 'Asset', 'Sequence'].map((name) => ({ name, displayName: name, custom: false }));
		const plan = planSet({
			siteUrl: 'https://studio.shotgrid.autodesk.com',
			trashPageUrl: null,
			entityTypes: types,
			fieldsByType: new Map([['Shot', []]]),
			entries,
			reads: new Map(entries.map((each) => [each.id, absent])),
			scope: { kind: 'all-eligible', projects: [] }
		});
		const creates = plan.items.filter((each) => each.class === 'create');
		expect(creates.map((each) => each.entryId)).toEqual(entries.map((each) => each.id));
		const rows = viewRows(plan.items, INITIAL_RUN_STATE);
		const names = new Set<string>();
		for (const each of creates) {
			const row = rows.find((candidate) => candidate.entryId === each.entryId)!;
			for (const property of each.create!.properties) {
				expect(shown(row, property.property_name, property.value), `${each.entryId}.${property.property_name}`).toBe(true);
				names.add(property.property_name);
			}
		}
		// Every property a create can carry was sent by one of them, so none goes unchecked.
		expect([...names].sort()).toEqual(['default_value', 'description', 'name', 'unique', 'valid_types', 'valid_values']);
	});
});

describe('what the session hands the ticks and the summary (audit finding 6)', () => {
	const P = { id: 70, name: 'Demo' };
	function visibility(entryId: string, more: Partial<VisibilityForecast> = {}): VisibilityForecast {
		return { entryId, class: 'already-matches', applies: true, visible: [], toAdd: [], analysing: [], locked: [], outside: [], toHide: [], ...more };
	}

	it('RUN-4: a row with nothing left to do is disabled; one with visibility to add, or still analysed, is not', () => {
		const rows = viewRows([item('done', 'already-matches'), item('add', 'already-matches'), item('wait', 'already-matches'), item('new', 'create')], INITIAL_RUN_STATE);
		const ticks = tickRowsOf(
			rows,
			new Map([
				['done', visibility('done', { visible: [P] })],
				['add', visibility('add', { toAdd: [P] })],
				['wait', visibility('wait', { analysing: [P] })],
				['new', visibility('new', { class: 'create', toAdd: [P] })]
			])
		);
		expect(ticks).toEqual([
			{ entryId: 'done', selectable: true, disabled: true },
			{ entryId: 'add', selectable: true, disabled: false },
			{ entryId: 'wait', selectable: true, disabled: false },
			{ entryId: 'new', selectable: true, disabled: false }
		]);
	});

	it('RUN-4: a row the analysis says nothing about is not disabled, and a conflict row stays unselectable', () => {
		const rows = viewRows([item('match', 'already-matches'), item('clash', 'type-conflict')], INITIAL_RUN_STATE);
		expect(tickRowsOf(rows, new Map())).toEqual([
			{ entryId: 'match', selectable: true, disabled: false },
			{ entryId: 'clash', selectable: false, disabled: false }
		]);
	});

	it('RUN-5: the summary\'s rows carry each row\'s class, its tick and the reverse field types of its plan item', () => {
		const items = [item('link', 'create', { reverseFieldTypes: ['Asset', 'Task'] }), item('plain', 'update'), item('clash', 'type-conflict')];
		const rows = viewRows(items, INITIAL_RUN_STATE);
		expect(summaryRows(rows, new Set(['link']), items)).toEqual([
			{ class: 'create', ticked: true, reverseFieldTypes: ['Asset', 'Task'] },
			{ class: 'update', ticked: false, reverseFieldTypes: [] },
			{ class: 'type-conflict', ticked: false, reverseFieldTypes: [] }
		]);
	});

	it('RUN-19: the summary reads the class a run\'s re-plan gave a row', () => {
		const items = [item('a', 'create')];
		const rows = viewRows(items, { rows: [runRow('a', { class: 'update', state: 'done' })] });
		expect(summaryRows(rows, new Set(['a']), items)).toEqual([{ class: 'update', ticked: true, reverseFieldTypes: [] }]);
	});
});

describe('what a plan row says of its run (audit finding 6)', () => {
	const applied = { origin: 'new' as const, status: 'applied' as const, done: 2, total: 2, written: 2, failures: [], error: null };

	it('RUN-21: a row has ended once its run row is done, skipped or failed', () => {
		expect(rowEnded({ run: null })).toBe(false);
		expect(rowEnded({ run: runRow('a', { state: 'pending' }) })).toBe(false);
		expect(rowEnded({ run: runRow('a', { state: 'in_progress' }) })).toBe(false);
		for (const state of ['done', 'skipped', 'failed'] as const) expect(rowEnded({ run: runRow('a', { state }) })).toBe(true);
	});

	it('VIS-7: an ended row is warned when its visibility needs another go, and only then', () => {
		const failed = { ...applied, failures: [{ projectId: 71, projectName: 'Demo', message: 'No.' }] };
		expect(rowWarned({ run: runRow('a', { state: 'done', visibility: failed }) })).toBe(true);
		expect(rowWarned({ run: runRow('a', { state: 'done', visibility: { ...applied, status: 'cancelled' } }) })).toBe(true);
		expect(rowWarned({ run: runRow('a', { state: 'done', visibility: applied }) })).toBe(false);
		expect(rowWarned({ run: runRow('a', { state: 'done' }) })).toBe(false);
		expect(rowWarned({ run: runRow('a', { state: 'in_progress', visibility: failed }) })).toBe(false);
		expect(rowWarned({ run: null })).toBe(false);
	});

	it('RUN-4, RUN-3: the checkbox and the "show all" button are named after their field and setting', () => {
		expect(installCheckLabel('Lens')).toBe('Install Lens');
		expect(showMoreLabel(false, 'Valid values')).toBe('Show all of valid values');
		expect(showMoreLabel(true, 'Valid values')).toBe('Show less of valid values');
	});
});
