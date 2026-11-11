/**
 * The visibility scope: which projects an install makes its fields visible on (VIS-1 to VIS-3).
 *
 * Pure. The caller reads the project list (`$lib/io/visibility`) and hands it in with the ids the
 * picker holds. What comes out is the planner's `PlanScope`, the full eligible list the steps and
 * the analysis need, and the lines the screen shows.
 *
 * Rules:
 *
 * - Eligible means not a template, not archived, not a demo project (VIS-2, Q4). Status is never
 *   read (B5).
 * - An empty picker means all eligible projects (VIS-2).
 * - The picker offers `eligible` and nothing else. A chosen id that is not in it, unknown or not
 *   eligible, is dropped and counted. It is never sent to the site: a schema read with a project
 *   id that does not exist answers 200 with everything visible (corpus `findings/115`), so an id
 *   is trusted only once the list holds it.
 * - When the list could not be read, chosen projects keep their ids and get placeholder names
 *   (VIS-3). They were not checked against the list, and the screen says so. With an empty picker
 *   the scope is empty and no visibility is applied (VIS-3).
 * - A chosen scope whose every id was dropped stays `chosen` with no project. It does not fall
 *   back to all eligible projects. The steps plan nothing for it.
 * - Projects are sorted by name, without case, then by id. The order of the picker's clicks
 *   decides nothing.
 */
import type { PlanScope } from './plan';
import { PROJECT_ELIGIBILITY_FIELDS, isEligibleProject, type EligibilityFlags } from './project-eligibility';
import { countText } from './set-text';

/** A project as the plan and the steps carry it. */
export interface ScopeProject {
	id: number;
	name: string;
}

/** A project as the list read hands it over: id, name and the eligibility checkboxes. */
export type ProjectRow = ScopeProject & EligibilityFlags;

/** The project list read. A failure is a value here: the scope has a rule for it (VIS-3). */
export type ProjectsRead = { status: 'loaded'; projects: readonly ProjectRow[] } | { status: 'failed'; message: string };

export interface VisibilityScope {
	/** What the planner takes (PLN-17). */
	scope: PlanScope;
	/** Every eligible project, sorted: what the picker offers. Empty when the list could not be read. */
	eligible: readonly ScopeProject[];
	/** False when the list could not be read. Then nothing can be hidden and no id was checked. */
	eligibleKnown: boolean;
	/** Chosen ids left out, in the order given, each once: unknown, not eligible, or not an id. */
	dropped: readonly number[];
	/** True when the scope's names are built from ids (VIS-3). */
	placeholderNames: boolean;
	/** Why the list could not be read, else null. */
	problem: string | null;
}

/** VIS-1. */
export const VISIBILITY_EXPLANATION =
	'Fields are site-wide. The picker only decides on which projects they are visible. Leave it empty for all eligible projects.';

/** The name a project shows under when the site gave none (VIS-3). */
export function placeholderName(id: number): string {
	return `Project ${id}`;
}

function byName(a: ScopeProject, b: ScopeProject): number {
	const order = a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
	return order !== 0 ? order : a.id - b.id;
}

function isId(value: number): boolean {
	return Number.isInteger(value) && value > 0;
}

function unique(ids: readonly number[]): number[] {
	const seen: number[] = [];
	// `includes` matches NaN, which `indexOf` and a Set of `===` would not.
	for (const id of ids) if (!seen.includes(id)) seen.push(id);
	return seen;
}

/** The eligible projects of a list, as the picker offers them: named, sorted, each id once. */
export function eligibleScopeProjects(projects: readonly ProjectRow[]): ScopeProject[] {
	const byId = new Map<number, ScopeProject>();
	for (const project of projects) {
		if (!isId(project.id) || byId.has(project.id) || !isEligibleProject(project)) continue;
		const name = typeof project.name === 'string' ? project.name.trim() : '';
		byId.set(project.id, { id: project.id, name: name === '' ? placeholderName(project.id) : name });
	}
	return [...byId.values()].sort(byName);
}

/** The scope for a project list read and the ids the picker holds. Empty picker: all eligible (VIS-2). */
export function resolveScope(read: ProjectsRead, chosenIds: readonly number[]): VisibilityScope {
	const chosen = unique(chosenIds);
	if (read.status === 'failed') {
		const valid = chosen.filter(isId);
		return {
			scope:
				chosen.length === 0
					? { kind: 'all-eligible', projects: [] }
					: { kind: 'chosen', projects: valid.map((id) => ({ id, name: placeholderName(id) })) },
			eligible: [],
			eligibleKnown: false,
			dropped: chosen.filter((id) => !isId(id)),
			placeholderNames: valid.length > 0,
			problem: read.message
		};
	}
	const eligible = eligibleScopeProjects(read.projects);
	if (chosen.length === 0) {
		return { scope: { kind: 'all-eligible', projects: eligible }, eligible, eligibleKnown: true, dropped: [], placeholderNames: false, problem: null };
	}
	const wanted = new Set(chosen);
	const known = new Set(eligible.map((project) => project.id));
	return {
		scope: { kind: 'chosen', projects: eligible.filter((project) => wanted.has(project.id)) },
		eligible,
		eligibleKnown: true,
		dropped: chosen.filter((id) => !known.has(id)),
		placeholderNames: false,
		problem: null
	};
}

/**
 * The filter the project picker searches with, so that it offers the eligible projects and no
 * other (VIS-2, Q4): no template, no demo project, nothing archived. The same three checkboxes
 * as `isEligibleProject`. What is chosen still goes through `resolveScope`, which is the rule.
 */
export const ELIGIBLE_PROJECT_FILTERS: { logical_operator: 'and'; conditions: [string, 'is', boolean][] } = {
	logical_operator: 'and',
	conditions: PROJECT_ELIGIBILITY_FIELDS.map((field): [string, 'is', boolean] => [field, 'is', false])
};

/** The summary's scope line (RUN-5): all eligible projects with their number, or the number chosen. */
export function scopeSummary(resolved: VisibilityScope): string {
	const count = resolved.scope.projects.length;
	if (resolved.scope.kind === 'chosen') return countText(count, 'chosen project');
	return resolved.eligibleKnown ? `All eligible projects (${count})` : 'No projects';
}

/** What the screen says beside the scope when something about it needs saying. Empty when nothing does. */
export function scopeNotes(resolved: VisibilityScope): string[] {
	const notes: string[] = [];
	const chosen = resolved.scope.kind === 'chosen';
	if (!resolved.eligibleKnown) {
		notes.push(
			chosen
				? 'The project list could not be read. Projects show by id and were not checked. New fields stay visible on the other projects.'
				: 'The project list could not be read. No visibility will be changed.'
		);
	}
	const dropped = resolved.dropped.length;
	if (dropped === 1) notes.push('1 chosen project is not eligible and was left out.');
	else if (dropped > 1) notes.push(`${dropped} chosen projects are not eligible and were left out.`);
	if (chosen && resolved.scope.projects.length === 0) notes.push('No chosen project is left. No visibility will be changed.');
	return notes;
}

/**
 * The projects the analysis reads (VIS-8): every eligible one, so that a change of the picker
 * needs no new read (VIS-11). The chosen ones when the list could not be read.
 */
export function analysisProjects(resolved: VisibilityScope): readonly ScopeProject[] {
	return resolved.eligibleKnown ? resolved.eligible : resolved.scope.projects;
}
