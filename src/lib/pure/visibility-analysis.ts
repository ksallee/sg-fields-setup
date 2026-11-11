/**
 * The analysis before the run (VIS-8 to VIS-12): where each field of the plan is visible now.
 *
 * Pure, in three parts. The reads themselves are run by `$lib/io/visibility`.
 *
 * 1. `planVisibilityReads`: which reads are needed. One per (entity type, project), which covers
 *    every field of that type (corpus `findings/115`). Only update and already-matching rows are
 *    analysed (VIS-8): a create row's field does not exist yet, and the other rows are skipped.
 * 2. `startAnalysis` and `foldRead`: the reducer. Each read that lands is folded in, in any
 *    order. Only the fields that belong to the plan are kept (VIS-8).
 * 3. `rowVisibility`: one row against the current picker (VIS-9). It reads the analysis and never
 *    the site, so a change of the picker costs nothing (VIS-11).
 *
 * The projects read are every eligible project (`analysisProjects`), whatever the picker holds.
 * That is what makes VIS-11 hold, and what "outside the picker" is measured against: projects
 * that are not eligible are never read and never listed.
 *
 * A read that failed leaves its projects in "analysing" (VIS-12). Nothing here blocks a run.
 */
import type { PlanClass } from './plan';
import type { ScopeProject, VisibilityScope } from './visibility-scope';
import type { FieldVisibility } from './visibility-value';

/** A plan row as the analysis needs it. A `PlanItem` fits. */
export interface AnalysisRow {
	entryId: string;
	class: PlanClass;
	entityType: string;
	programmaticName: string;
}

/** How many reads run at once unless told otherwise (VIS-8). */
export const DEFAULT_ANALYSIS_CAP = 10;

/** One read: every field of a type, as one project sees it. */
export interface VisibilityRead {
	entityType: string;
	projectId: number;
}

/** What one read answered: the type's fields by programmatic name, or why there are none. */
export type VisibilityReadResult = { ok: true; fields: ReadonlyMap<string, FieldVisibility> } | { ok: false; message: string };

export type ReadState =
	| { status: 'pending' }
	| { status: 'failed'; message: string }
	/** Only the plan's fields of the type. */
	| { status: 'loaded'; fields: ReadonlyMap<string, FieldVisibility> };

export interface VisibilityAnalysis {
	/** What the analysis is of: the cache key (VIS-8). */
	key: string;
	/** Every read it needs, in order. */
	reads: readonly VisibilityRead[];
	/** The plan's fields, by entity type: the only ones kept. */
	wanted: ReadonlyMap<string, ReadonlySet<string>>;
	/** One state per read, by `readKey`. */
	states: ReadonlyMap<string, ReadState>;
}

/** Whether the analysis reads the row's field: update and already-matching rows (VIS-8). */
export function isAnalysed(row: Pick<AnalysisRow, 'class'>): boolean {
	return row.class === 'update' || row.class === 'already-matches';
}

/** The key of a read in `VisibilityAnalysis.states`. */
export function readKey(read: VisibilityRead): string {
	return `${read.entityType}\n${read.projectId}`;
}

function wantedFields(rows: readonly AnalysisRow[]): Map<string, Set<string>> {
	const wanted = new Map<string, Set<string>>();
	for (const row of rows) {
		if (!isAnalysed(row)) continue;
		const fields = wanted.get(row.entityType) ?? new Set<string>();
		fields.add(row.programmaticName);
		wanted.set(row.entityType, fields);
	}
	return wanted;
}

/**
 * The reads the rows need: for each entity type that has a row to analyse, in the order the types
 * first appear, one read per project, in the projects' order (VIS-8).
 */
export function planVisibilityReads(rows: readonly AnalysisRow[], projects: readonly ScopeProject[]): VisibilityRead[] {
	const reads: VisibilityRead[] = [];
	const seen = new Set<number>();
	const ids = projects.map((project) => project.id).filter((id) => !seen.has(id) && seen.add(id));
	for (const entityType of wantedFields(rows).keys()) for (const projectId of ids) reads.push({ entityType, projectId });
	return reads;
}

/**
 * What an analysis is of: the analysed fields and the projects, in no order. Two calls with the
 * same key need the same reads, so a held analysis answers both until a refresh (VIS-8). The
 * picker is not in it (VIS-11).
 */
export function analysisKey(rows: readonly AnalysisRow[], projects: readonly ScopeProject[]): string {
	const fields: string[] = [];
	for (const [entityType, names] of wantedFields(rows)) for (const name of names) fields.push(`${entityType}.${name}`);
	const ids = [...new Set(projects.map((project) => project.id))].sort((a, b) => a - b);
	return JSON.stringify([fields.sort(), ids]);
}

/** An analysis with every read pending. */
export function startAnalysis(rows: readonly AnalysisRow[], projects: readonly ScopeProject[]): VisibilityAnalysis {
	const reads = planVisibilityReads(rows, projects);
	return {
		key: analysisKey(rows, projects),
		reads,
		wanted: wantedFields(rows),
		states: new Map(reads.map((read) => [readKey(read), { status: 'pending' } as ReadState]))
	};
}

/**
 * The analysis with one read's answer folded in. The one given is left as it was. A read the
 * analysis did not plan is ignored: the same analysis comes back.
 */
export function foldRead(analysis: VisibilityAnalysis, read: VisibilityRead, result: VisibilityReadResult): VisibilityAnalysis {
	const key = readKey(read);
	if (!analysis.states.has(key)) return analysis;
	let state: ReadState;
	if (result.ok) {
		const fields = new Map<string, FieldVisibility>();
		for (const name of analysis.wanted.get(read.entityType) ?? []) {
			const visibility = result.fields.get(name);
			if (visibility) fields.set(name, visibility);
		}
		state = { status: 'loaded', fields };
	} else {
		state = { status: 'failed', message: result.message };
	}
	const states = new Map(analysis.states);
	states.set(key, state);
	return { ...analysis, states };
}

/**
 * `analysing` while a read is out. Then `loaded`, or `failed` when a read failed (VIS-12). An
 * analysis with nothing to read is loaded.
 */
export function analysisStatus(analysis: VisibilityAnalysis): 'analysing' | 'loaded' | 'failed' {
	let failed = false;
	for (const state of analysis.states.values()) {
		if (state.status === 'pending') return 'analysing';
		if (state.status === 'failed') failed = true;
	}
	return failed ? 'failed' : 'loaded';
}

/** One row against the picker (VIS-9). Each project of the scope is in exactly one of the first four lists. */
export interface RowVisibility {
	entryId: string;
	class: PlanClass;
	/** False for rows the run skips: every list is empty. */
	applies: boolean;
	/** In the picker, visible already. */
	visible: ScopeProject[];
	/** In the picker, to be made visible. For a create row: every picker project. */
	toAdd: ScopeProject[];
	/** In the picker, not known yet: the read is out, failed, or did not hold the field (VIS-12). */
	analysing: ScopeProject[];
	/** In the picker, hidden, and the site does not let it change (`visible.editable` false). No write is planned. */
	locked: ScopeProject[];
	/** Eligible, outside the picker, visible. They stay visible (VIS-6). Existing rows only. */
	outside: ScopeProject[];
	/** Eligible, outside the picker, where a new field will be hidden (VIS-4). Create rows only. */
	toHide: ScopeProject[];
}

function stateOf(analysis: VisibilityAnalysis | null, row: AnalysisRow, projectId: number): FieldVisibility | null {
	const state = analysis?.states.get(readKey({ entityType: row.entityType, projectId }));
	return state?.status === 'loaded' ? (state.fields.get(row.programmaticName) ?? null) : null;
}

/**
 * One row's visibility against the scope. `analysis` is null before any exists: every picker
 * project of an existing row is then still being analysed.
 */
export function rowVisibility(row: AnalysisRow, resolved: VisibilityScope, analysis: VisibilityAnalysis | null): RowVisibility {
	const result: RowVisibility = {
		entryId: row.entryId,
		class: row.class,
		applies: row.class === 'create' || isAnalysed(row),
		visible: [],
		toAdd: [],
		analysing: [],
		locked: [],
		outside: [],
		toHide: []
	};
	if (!result.applies) return result;
	const scope = resolved.scope;
	const inScope = new Set(scope.projects.map((project) => project.id));
	const others = scope.projects.length === 0 ? [] : resolved.eligible.filter((project) => !inScope.has(project.id));

	if (row.class === 'create') {
		result.toAdd = [...scope.projects];
		if (scope.kind === 'chosen') result.toHide = others;
		return result;
	}
	for (const project of scope.projects) {
		const now = stateOf(analysis, row, project.id);
		if (!now) result.analysing.push(project);
		else if (now.visible) result.visible.push(project);
		else if (now.editable === false) result.locked.push(project);
		else result.toAdd.push(project);
	}
	result.outside = others.filter((project) => stateOf(analysis, row, project.id)?.visible === true);
	return result;
}
