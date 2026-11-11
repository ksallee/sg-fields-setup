/**
 * The per-project visibility steps for one field (VIS-4 to VIS-7). Pure planning: nothing is read
 * or written here. `visibility-run` executes the steps.
 *
 * | origin     | scope        | steps                                                                  |
 * |------------|--------------|------------------------------------------------------------------------|
 * | `new`      | all eligible | show on every project in scope. Nothing is hidden (VIS-4).             |
 * | `new`      | chosen       | show on every project in scope, hide on every other eligible (VIS-4).  |
 * | `existing` | either       | show on every project in scope. Never hidden anywhere (VIS-5, VIS-6).  |
 *
 * Order, always the same: the show steps first, in the scope's order, then the hide steps, in the
 * eligible list's order. Showing comes first so that a cancel or a failure half way leaves the
 * field visible in more places than asked, never in fewer.
 *
 * A field just created or revived is visible in every project (corpus `findings/115`), so on a
 * new field the show steps are expected to write nothing and the hide steps to write. That is
 * `expect`, a forecast for the screen. It decides nothing: each step still reads the project's
 * state first and writes only on a difference (VIS-7).
 *
 * Nothing is planned for an empty scope, a chosen scope with no project included: hiding a new
 * field on every eligible project because every chosen id was dropped would be the opposite of
 * what was asked. Nothing is hidden when the eligible list is empty, as it is when it could not
 * be read (VIS-3).
 */
import type { PlanScope } from './plan';
import type { FieldOrigin } from './visibility-types';
import type { ScopeProject } from './visibility-scope';

export interface VisibilityStep {
	projectId: number;
	projectName: string;
	/** The state the step leaves the project in: true shows the field, false hides it. */
	visible: boolean;
	/**
	 * What the step is expected to do. `no-op`: the project is already in that state. `write`: it
	 * is not. `unknown`: an existing field whose state in the project was not handed in.
	 */
	expect: 'no-op' | 'write' | 'unknown';
}

export interface VisibilityStepsInput {
	origin: FieldOrigin;
	scope: PlanScope;
	/** Every eligible project (`VisibilityScope.eligible`). Empty when the list could not be read. */
	eligible: readonly ScopeProject[];
	/** Where the field is visible now, by project id, where known (the analysis, VIS-8). */
	current?: ReadonlyMap<number, boolean>;
}

export function planVisibilitySteps(input: VisibilityStepsInput): VisibilityStep[] {
	const { origin, scope, eligible, current } = input;
	const steps: VisibilityStep[] = [];
	const planned = new Set<number>();

	function add(project: ScopeProject, visible: boolean): void {
		if (planned.has(project.id)) return;
		planned.add(project.id);
		const now = current?.get(project.id);
		const expect = now !== undefined ? (now === visible ? 'no-op' : 'write') : origin === 'new' ? (visible ? 'no-op' : 'write') : 'unknown';
		steps.push({ projectId: project.id, projectName: project.name, visible, expect });
	}

	if (scope.projects.length === 0) return steps;
	for (const project of scope.projects) add(project, true);
	if (origin === 'new' && scope.kind === 'chosen') for (const project of eligible) add(project, false);
	return steps;
}
