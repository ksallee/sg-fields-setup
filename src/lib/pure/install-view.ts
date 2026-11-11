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
import type { PlanClass, PlanItem, PropertyName } from './plan';
import type { DiffSetting, Difference } from './plan-diff';
import { formatValue, reasonParts, reverseFieldsText, settingLabel, type ReasonPart } from './plan-reason';
import type { SummaryRow } from './install-text';
import type { TickRow } from './plan-selection';
import { needsVisibilityRetry, type RowState, type RunRow, type RunState } from './run';
import type { AnalysisRow, VisibilityForecast } from './visibility-analysis';
import { nothingLeftToDo } from './visibility-text';

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

/** The setting each property of a schema write is shown as. Every property has one, so none can go unshown. */
const PROPERTY_SETTINGS: Readonly<Record<PropertyName, DiffSetting>> = {
	name: 'displayName',
	description: 'description',
	valid_values: 'validValues',
	default_value: 'defaultValue',
	valid_types: 'validTypes',
	unique: 'unique'
};

/** How many values of a list a create line shows before it is cut. */
export const CREATE_LIST_SHOWN = 8;
/** How many characters a create line's value shows before it is cut. */
export const CREATE_TEXT_SHOWN = 160;

export interface CreateLine {
	setting: DiffSetting;
	/** "Valid values". */
	label: string;
	/** The whole value, as `showValue` words it. */
	value: string;
	/** The value cut for the row when it is long, else null. The row offers the whole one. */
	short: string | null;
	/** "Valid values: [Wide, Long]", whole. */
	text: string;
}

function cut(value: unknown, whole: string): string | null {
	// One value more than the limit is shown: "and 1 more" is no shorter than the value.
	if (Array.isArray(value) && value.length > CREATE_LIST_SHOWN + 1) {
		const head = value.slice(0, CREATE_LIST_SHOWN).map((each) => String(each)).join(', ');
		const listed = `[${head}, and ${value.length - CREATE_LIST_SHOWN} more]`;
		if (listed.length <= CREATE_TEXT_SHOWN) return listed;
	}
	return whole.length > CREATE_TEXT_SHOWN ? `${whole.slice(0, CREATE_TEXT_SHOWN)}…` : null;
}

/**
 * What a create writes beside the names the row already shows, one line per property of its
 * payload (RUN-3: nothing is written that the plan has not shown). Read from the payload itself,
 * the request that is sent, so the two cannot drift. The display name has a line only if the
 * payload's is not the one the row shows.
 */
export function createLines(item: Pick<PlanItem, 'create' | 'displayName'>): CreateLine[] {
	if (item.create === null) return [];
	const lines: CreateLine[] = [];
	for (const property of item.create.properties) {
		if (property.property_name === 'name' && property.value === item.displayName) continue;
		const setting = PROPERTY_SETTINGS[property.property_name];
		const name = settingLabel(setting);
		const label = `${name[0].toUpperCase()}${name.slice(1)}`;
		const value = showValue(setting, property.value);
		lines.push({ setting, label, value, short: cut(property.value, value), text: `${label}: ${value}` });
	}
	return lines;
}

/** Both data types of a conflict row (RUN-3). */
export function typeConflictText(liveDataType: string, wantedDataType: string): string {
	return `${dataTypeLabel(liveDataType)} on the site, ${dataTypeLabel(wantedDataType)} in the set`;
}

export interface InstallRow {
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
	/** What a create writes beside the names above: one line per property of its payload. */
	creates: CreateLine[];
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
): InstallRow[] {
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
			creates: current && item.class === 'create' ? createLines(item) : [],
			blocked: current ? item.blocked.map(differenceLine) : [],
			conflict: current && item.class === 'type-conflict' && item.liveDataType !== null ? typeConflictText(item.liveDataType, item.dataType) : null,
			reasons: current ? item.reasons.map((reason) => reasonParts(reason)) : [],
			reverseFields: current ? reverseFieldsText(item.reverseFieldTypes) : null,
			run: runRow
		};
	});
}

export interface InstallGroup extends GroupSpec {
	/** The header's count (RUN-2). */
	count: number;
	rows: InstallRow[];
}

/** The groups that have rows, in order, each with its rows in plan order (RUN-2). */
export function groupRows(rows: readonly InstallRow[]): InstallGroup[] {
	return GROUPS.map((group) => {
		const own = rows.filter((row) => row.group === group.id);
		return { ...group, count: own.length, rows: own };
	}).filter((group) => group.count > 0);
}

/** What a row's badge says: a run's state, `skipped` for a row the plan skips, `not-selected`, or nothing yet. */
export type RowStatus = RowState | 'not-selected';

export function rowStatus(row: Pick<InstallRow, 'selectable' | 'run'>, run: Pick<RunState, 'status'>): RowStatus | null {
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

/**
 * The rows as the ticks take them (RUN-4): a row whose visibility has nothing left to do is
 * disabled. A row the analysis says nothing about yet is not.
 */
export function tickRowsOf(rows: readonly Pick<InstallRow, 'entryId' | 'selectable'>[], visibility: ReadonlyMap<string, VisibilityForecast>): TickRow[] {
	return rows.map((row) => {
		const own = visibility.get(row.entryId);
		return { entryId: row.entryId, selectable: row.selectable, disabled: own !== undefined && nothingLeftToDo(own) };
	});
}

/**
 * The rows as the summary counts them (RUN-5): each row's class as it shows, whether it is
 * ticked, and the entity types its plan item makes reverse fields on (corpus finding 121).
 */
export function summaryRows(
	rows: readonly Pick<InstallRow, 'entryId' | 'class'>[],
	ticked: ReadonlySet<string>,
	items: readonly Pick<PlanItem, 'entryId' | 'reverseFieldTypes'>[]
): SummaryRow[] {
	const byId = new Map(items.map((item) => [item.entryId, item]));
	return rows.map((row) => ({ class: row.class, ticked: ticked.has(row.entryId), reverseFieldTypes: byId.get(row.entryId)?.reverseFieldTypes ?? [] }));
}

/** The run has finished with this row: done, skipped or failed. From then on the row shows what the run says (RUN-21). */
export function rowEnded(row: Pick<InstallRow, 'run'>): boolean {
	return row.run !== null && row.run.state !== 'pending' && row.run.state !== 'in_progress';
}

/** An ended row whose visibility needs another go: it carries the warning and its retry (VIS-7). */
export function rowWarned(row: Pick<InstallRow, 'run'>): boolean {
	return row.run !== null && rowEnded(row) && needsVisibilityRetry(row.run);
}

/** The name of a row's checkbox (RUN-4). */
export function installCheckLabel(displayName: string): string {
	return `Install ${displayName}`;
}

/** The name of the button that shows the whole of a long value, or cuts it again (RUN-3). */
export function showMoreLabel(open: boolean, settingLabel: string): string {
	return `${open ? 'Show less' : 'Show all'} of ${settingLabel.toLowerCase()}`;
}
