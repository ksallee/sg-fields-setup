/**
 * The counters and lines the install screen shows for visibility (VIS-9, VIS-10, RUN-4, RUN-5).
 * Pure: everything is computed from `rowVisibility`, so a change of the picker recomputes it
 * without a read (VIS-11).
 */
import type { PlanScope } from './plan';
import type { RowVisibility } from './visibility-analysis';
import type { ScopeProject } from './visibility-scope';
import { NOT_EDITABLE_MESSAGE } from './visibility-run';

/** How many names a tooltip lists before "and N more" (VIS-9). */
export const TOOLTIP_NAMES = 20;

/** VIS-6, as the tooltip for outside projects says it. */
export const NEVER_REMOVED = 'The tool never removes visibility from a field that existed before the run.';

/** The names, up to `limit`, then "and N more" (VIS-9). */
export function projectNames(projects: readonly ScopeProject[], limit: number = TOOLTIP_NAMES): string {
	const names = projects.slice(0, limit).map((project) => project.name).join(', ');
	const more = projects.length - limit;
	return more > 0 ? `${names} and ${more} more` : names;
}

export type CounterKind = 'visible' | 'toAdd' | 'analysing' | 'locked' | 'outside' | 'toHide';

export interface VisibilityCounter {
	kind: CounterKind;
	count: number;
	/** The small text of the counter: "2 to add". */
	label: string;
	/** The project names, and for outside projects the reminder of VIS-6. */
	tooltip: string;
}

const COUNTERS: readonly { kind: CounterKind; word: string; tooltip: (names: string) => string }[] = [
	{ kind: 'visible', word: 'visible', tooltip: (names) => `Visible on ${names}.` },
	{ kind: 'toAdd', word: 'to add', tooltip: (names) => `To be made visible on ${names}.` },
	{ kind: 'analysing', word: 'analysing', tooltip: (names) => `Still reading ${names}.` },
	{ kind: 'locked', word: 'locked', tooltip: (names) => `Hidden on ${names}. ${NOT_EDITABLE_MESSAGE}` },
	{ kind: 'outside', word: 'outside', tooltip: (names) => `Also visible on ${names}. ${NEVER_REMOVED}` },
	{ kind: 'toHide', word: 'to hide', tooltip: (names) => `A new field. To be hidden on ${names}.` }
];

/** A row's counters, in a fixed order, only those that count something (VIS-9). */
export function rowCounters(row: RowVisibility): VisibilityCounter[] {
	if (!row.applies) return [];
	const counters: VisibilityCounter[] = [];
	for (const { kind, word, tooltip } of COUNTERS) {
		const projects = row[kind];
		if (projects.length === 0) continue;
		counters.push({ kind, count: projects.length, label: `${projects.length} ${word}`, tooltip: tooltip(projectNames(projects)) });
	}
	return counters;
}

/**
 * Whether an already-matches row has nothing left to do: no visibility to add and nothing still
 * being analysed. Such a row is unticked and disabled (RUN-4). While the analysis is out, or
 * after it failed (VIS-12), the row stays ticked: the run reads each project anyway (VIS-7).
 */
export function nothingLeftToDo(row: RowVisibility): boolean {
	return row.class === 'already-matches' && row.toAdd.length === 0 && row.analysing.length === 0;
}

export interface VisibilityCount {
	/** The number of projects to add over the selected rows, or its upper bound. */
	count: number;
	/** True while a selected row is still being analysed: `count` is rows times projects in scope. */
	upperBound: boolean;
	/** Where new fields will be hidden: chosen scope, create rows (VIS-4). Not part of `count`. */
	hides: number;
	/** The summary's line (RUN-5). */
	text: string;
}

/**
 * The summary's visibility count over the selected rows (VIS-10): the sum of "to add" once no
 * selected row is still being analysed; before that an upper bound, the selected rows that take
 * visibility times the projects in scope, marked as such.
 */
export function visibilityCount(selected: readonly RowVisibility[], scope: PlanScope): VisibilityCount {
	const rows = selected.filter((row) => row.applies);
	const upperBound = rows.some((row) => row.analysing.length > 0);
	const count = upperBound ? rows.length * scope.projects.length : rows.reduce((sum, row) => sum + row.toAdd.length, 0);
	const hides = rows.reduce((sum, row) => sum + row.toHide.length, 0);
	let text = count === 0 ? 'No visibility changes' : `${upperBound ? 'Up to ' : ''}${count} visibility ${count === 1 ? 'change' : 'changes'}`;
	if (hides > 0) text += `, ${hides} to hide`;
	return { count, upperBound, hides, text };
}
