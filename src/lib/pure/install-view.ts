/**
 * The install plan as the screen shows it (RUN-2 to RUN-4, RUN-19, RUN-22, RUN-26): the groups,
 * each row's lines, and what a run did to a row. Pure. The components render this and decide
 * nothing.
 *
 * Decisions where the spec leaves room:
 *
 * - A group with no row is not shown. The order of the others never changes (RUN-2).
 * - The refusals show with the type conflicts, under "Type conflicts" (RUN-2).
 * - A row whose class changed in a run's re-plan moves to the group of its new class (RUN-19).
 *   Its differences and its reverse-field note were worked out for the old class, so they are
 *   dropped: the run's own note says what happened.
 * - Conflict, refused and blocked rows read "Skipped" from the start (RUN-4). A row with a
 *   checkbox that was not ticked reads "Not selected" once a run has started.
 * - After a run, a field the run made, updated or found live is analysed as an existing field
 *   (RUN-26): the plan is stale until a refresh, and the counters must not be.
 */
import { dataTypeLabel } from './data-types';
import { entityTypeDisplayName, type LiveEntityType } from './live-entity-types';
import type { PlanClass, PlanItem } from './plan';
import type { DiffSetting, Difference } from './plan-diff';
import { formatValue, reasonParts, reverseFieldsText, settingLabel, type ReasonPart } from './plan-reason';
import type { RowState, RunRow, RunState } from './run';
import type { AnalysisRow } from './visibility-analysis';

export type GroupId = 'conflicts' | 'blocked' | 'create' | 'update' | 'already-matches';

export interface GroupSpec {
	id: GroupId;
	title: string;
	/** Whether the group starts open (RUN-2). */
	open: boolean;
	classes: readonly PlanClass[];
}

/** The groups, in the order they show (RUN-2). */
export const GROUPS: readonly GroupSpec[] = [
	{ id: 'conflicts', title: 'Type conflicts', open: true, classes: ['type-conflict', 'refused'] },
	{ id: 'blocked', title: 'Blocked', open: true, classes: ['blocked'] },
	{ id: 'create', title: 'Create', open: true, classes: ['create'] },
	{ id: 'update', title: 'Update', open: true, classes: ['update'] },
	{ id: 'already-matches', title: 'Already matches', open: false, classes: ['already-matches'] }
];

export function groupOf(planClass: PlanClass): GroupId {
	return GROUPS.find((group) => group.classes.includes(planClass))?.id ?? 'conflicts';
}

/** The classes whose rows have a checkbox (RUN-4). */
const SELECTABLE: readonly PlanClass[] = ['create', 'update', 'already-matches'];

/** The sign for a value that is empty (RUN-3). */
export const EMPTY_SIGN = '∅';

/** A setting's value as a row shows it: the empty-set sign for none, a list in brackets, unique as on or off (RUN-3). */
export function showValue(setting: DiffSetting, value: unknown): string {
	if (setting === 'unique') return value === true ? 'on' : 'off';
	const shown = formatValue(value);
	// `formatValue` words an empty value "none". Text is quoted there, so the bare word is only ever that.
	return shown === 'none' ? EMPTY_SIGN : shown;
}

export interface DifferenceLine {
	setting: DiffSetting;
	/** "Description". */
	label: string;
	live: string;
	wanted: string;
	/** "Description: ∅ → "The lens."" */
	text: string;
}

/** One difference as "setting: live value → wanted value" (RUN-3). */
export function differenceLine(difference: Pick<Difference, 'setting' | 'live' | 'wanted'>): DifferenceLine {
	const name = settingLabel(difference.setting);
	const label = `${name[0].toUpperCase()}${name.slice(1)}`;
	const live = showValue(difference.setting, difference.live);
	const wanted = showValue(difference.setting, difference.wanted);
	return { setting: difference.setting, label, live, wanted, text: `${label}: ${live} → ${wanted}` };
}

/** Both data types of a conflict row (RUN-3). */
export function typeConflictText(liveDataType: string, wantedDataType: string): string {
	return `${dataTypeLabel(liveDataType)} on the site, ${dataTypeLabel(wantedDataType)} in the set`;
}

export interface ViewRow {
	entryId: string;
	entityType: string;
	/** "Lenses (CustomEntity19)" when the site names the type otherwise, else the API name. */
	entityTypeLabel: string;
	displayName: string;
	programmaticName: string;
	dataType: string;
	dataTypeLabel: string;
	/** The class it shows under: the plan's, or the one a run's re-plan gave it (RUN-19). */
	class: PlanClass;
	group: GroupId;
	/** Whether the row has a checkbox (RUN-4). */
	selectable: boolean;
	/** An update's differences. */
	differences: DifferenceLine[];
	/** A blocked row's blocked differences. */
	blocked: DifferenceLine[];
	/** A conflict row's two data types, else null. */
	conflict: string | null;
	/** Why nothing is applied, one run of parts per reason: conflict, refused and blocked rows. */
	reasons: ReasonPart[][];
	/** Which types gain a reverse field, else null. */
	reverseFields: string | null;
	/** The row of the run, once a run has one for it. */
	run: RunRow | null;
}

function typeLabel(entityType: string, entityTypes: readonly Pick<LiveEntityType, 'name' | 'displayName'>[]): string {
	const shown = entityTypeDisplayName(entityTypes as readonly LiveEntityType[], entityType)?.trim() ?? '';
	return shown === '' || shown === entityType ? entityType : `${shown} (${entityType})`;
}

/** The rows of the plan, in plan order, each with what a run did to it. */
export function viewRows(
	items: readonly PlanItem[],
	run: Pick<RunState, 'rows'>,
	entityTypes: readonly Pick<LiveEntityType, 'name' | 'displayName'>[] = []
): ViewRow[] {
	const runRows = new Map(run.rows.map((row) => [row.entryId, row]));
	return items.map((item) => {
		const runRow = runRows.get(item.entryId) ?? null;
		const planClass = runRow?.class ?? item.class;
		// The plan's details belong to the plan's class.
		const current = planClass === item.class;
		return {
			entryId: item.entryId,
			entityType: item.entityType,
			entityTypeLabel: typeLabel(item.entityType, entityTypes),
			displayName: item.displayName,
			programmaticName: item.programmaticName,
			dataType: item.dataType,
			dataTypeLabel: dataTypeLabel(item.dataType),
			class: planClass,
			group: groupOf(planClass),
			selectable: SELECTABLE.includes(planClass),
			differences: current && item.class === 'update' ? item.differences.map(differenceLine) : [],
			blocked: current ? item.blocked.map(differenceLine) : [],
			conflict: current && item.class === 'type-conflict' && item.liveDataType !== null ? typeConflictText(item.liveDataType, item.dataType) : null,
			reasons: current ? item.reasons.map((reason) => reasonParts(reason)) : [],
			reverseFields: current ? reverseFieldsText(item.reverseFieldTypes) : null,
			run: runRow
		};
	});
}

export interface ViewGroup extends GroupSpec {
	/** The header's count (RUN-2). */
	count: number;
	rows: ViewRow[];
}

/** The groups that have rows, in order, each with its rows in plan order (RUN-2). */
export function groupRows(rows: readonly ViewRow[]): ViewGroup[] {
	return GROUPS.map((group) => {
		const own = rows.filter((row) => row.group === group.id);
		return { ...group, count: own.length, rows: own };
	}).filter((group) => group.count > 0);
}

/** What a row's badge says: a run's state, `skipped` for a row the plan skips, `not-selected`, or nothing yet. */
export type RowStatus = RowState | 'not-selected';

export function rowStatus(row: Pick<ViewRow, 'selectable' | 'run'>, run: Pick<RunState, 'status'>): RowStatus | null {
	if (row.run) return row.run.state;
	if (!row.selectable) return 'skipped';
	return run.status === 'idle' ? null : 'not-selected';
}

const STATUS_LABELS: Readonly<Record<RowStatus, string>> = {
	pending: 'Pending',
	in_progress: 'In progress',
	done: 'Done',
	skipped: 'Skipped',
	failed: 'Failed',
	'not-selected': 'Not selected'
};

export function statusLabel(status: RowStatus): string {
	return STATUS_LABELS[status];
}

/**
 * The rows the visibility analysis reads (VIS-8). Before a run: the plan's. After one (RUN-26):
 * a field the run made, updated or found live exists now, so it is analysed as an existing field.
 */
export function analysisRows(items: readonly PlanItem[], run: Pick<RunState, 'rows'>): AnalysisRow[] {
	const runRows = new Map(run.rows.map((row) => [row.entryId, row]));
	return items.map((item) => {
		const runRow = runRows.get(item.entryId);
		const live = runRow !== undefined && (runRow.state === 'done' || (runRow.state === 'skipped' && runRow.note?.code === 'already-exists'));
		return { entryId: item.entryId, class: live ? 'already-matches' : item.class, entityType: item.entityType, programmaticName: item.programmaticName };
	});
}
