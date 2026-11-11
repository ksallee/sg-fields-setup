/**
 * Applies per-project visibility to one field: the executor of `visibility-steps` (VIS-4 to
 * VIS-7, Q5, RUN-18, RUN-22). No I/O of its own: every call goes through the port it is given.
 *
 * One step, one project, as the corpus recipe does it (`recipes/024_field_visibility_in_a_project`):
 *
 * 1. Read the field at the project's scope (VIS-7). A missing `visible` value means visible.
 * 2. Already in the wanted state: done, nothing written.
 * 3. `visible.editable` is false: no write is sent. The step fails with a line that says the site
 *    does not let the field be shown or hidden. A write on such a field is not measured, and the
 *    recipe refuses it too.
 * 4. Write `visible` with the project (`findings/115`: without a project the write is a 400).
 * 5. Read again. The answer to an update is not proof. A write that changed nothing fails the step.
 *
 * Steps run one at a time, in the planned order. A failed step never stops the others and never
 * throws: it is collected with its project and the server's words (VIS-7, Q5). The item it
 * belongs to stays installed; the row shows the warning and offers `retryVisibility`.
 *
 * `isCancelled` is asked before every step, the first included (RUN-18). A step in flight
 * completes. `cancelled` is true only when steps were left. `onProgress(finished, total)` is
 * called after every step, failed or not, so it reaches the total (RUN-22). A hook that throws is
 * ignored; a cancel hook that throws counts as no cancel.
 *
 * Counts: `done` is the steps that ended in the wanted state. `written` is the steps whose write
 * was confirmed by the second read.
 */
import type { FieldReply } from './live-field';
import type { PlanScope } from './plan';
import { siteErrorMessage } from './site-error';
import type { ScopeProject } from './visibility-scope';
import { planVisibilitySteps, type VisibilityStep } from './visibility-steps';
import type { ApplyVisibility, FieldOrigin, VisibilityFailure, VisibilityHooks, VisibilityOutcome } from './visibility-types';
import { readVisibility, visibleWrite, type FieldVisibility, type VisibleWrite } from './visibility-value';

/**
 * What the executor needs from the site. Shaped after the schema client sg-widgets core is
 * growing, so that client is a port as it is:
 *
 * - `readField` is `SchemaSource.readField` and core's `SchemaClient.readField`.
 * - `updateField` is core's `SchemaClient.updateField(entityType, field, properties, projectId)`,
 *   which sends `project_id` in the body, the measured spelling.
 */
export interface VisibilityPort {
	/** `GET /schema/<Type>/fields/<field>?project_id=N`. Rejects on any failure but "does not exist". */
	readField(entityType: string, field: string, projectId: number): Promise<FieldReply>;
	/** `PUT /schema/<Type>/fields/<field>` with `{ properties, project_id }`. Rejects when the site refuses. */
	updateField(entityType: string, field: string, properties: VisibleWrite, projectId: number): Promise<unknown>;
}

/** What decides a field's steps: the scope and every eligible project. A `VisibilityScope` fits. */
export interface VisibilityPlan {
	scope: PlanScope;
	eligible: readonly ScopeProject[];
}

/** The field a step works on. */
export interface FieldRef {
	entityType: string;
	name: string;
}

export const NOT_EDITABLE_MESSAGE = 'Flow PT does not let this field be shown or hidden.';
export const NOT_APPLIED_MESSAGE = 'Flow PT accepted the change and did not apply it.';

/** What a step that failed without a word shows. */
export const STEP_FAILED_MESSAGE = 'The step failed.';

class StepFailure extends Error {}

async function read(port: VisibilityPort, field: FieldRef, projectId: number): Promise<FieldVisibility> {
	const reply = await port.readField(field.entityType, field.name, projectId);
	if (reply.status === 'missing') throw new StepFailure(reply.message || `${field.entityType}.${field.name} does not exist.`);
	if (reply.status === 'undeclared') throw new StepFailure(`The schema does not declare ${field.entityType}.${field.name}.`);
	const visibility = readVisibility(reply.raw);
	if (!visibility) throw new StepFailure(`${field.entityType}.${field.name} came back with no record.`);
	return visibility;
}

/** One step. Answers whether it wrote. Throws what went wrong. */
async function runStep(port: VisibilityPort, field: FieldRef, step: VisibilityStep): Promise<boolean> {
	const now = await read(port, field, step.projectId);
	if (now.visible === step.visible) return false;
	if (now.editable === false) throw new StepFailure(NOT_EDITABLE_MESSAGE);
	await port.updateField(field.entityType, field.name, visibleWrite(step.visible), step.projectId);
	const after = await read(port, field, step.projectId);
	if (after.visible !== step.visible) throw new StepFailure(NOT_APPLIED_MESSAGE);
	return true;
}

/** Runs the given steps for one field, one at a time, in their order. Never throws. */
export async function runVisibilitySteps(
	port: VisibilityPort,
	field: FieldRef,
	steps: readonly VisibilityStep[],
	hooks: VisibilityHooks
): Promise<VisibilityOutcome> {
	const total = steps.length;
	const failures: VisibilityFailure[] = [];
	let done = 0;
	let written = 0;
	let finished = 0;
	let cancelled = false;

	for (const step of steps) {
		let stop = false;
		try {
			stop = hooks.isCancelled() === true;
		} catch {
			/* A hook that throws does not cancel. */
		}
		if (stop) {
			cancelled = true;
			break;
		}
		try {
			if (await runStep(port, field, step)) written += 1;
			done += 1;
		} catch (error) {
			failures.push({ projectId: step.projectId, projectName: step.projectName, message: siteErrorMessage(error, STEP_FAILED_MESSAGE) });
		}
		finished += 1;
		try {
			hooks.onProgress(finished, total);
		} catch {
			/* The count is a courtesy. */
		}
	}
	return { total, done, written, failures, cancelled };
}

/** The step function the run engine calls for each field (the seam in `visibility-types`). */
export function createApplyVisibility(port: VisibilityPort, plan: VisibilityPlan): ApplyVisibility {
	return (field, origin, hooks) =>
		runVisibilitySteps(port, field, planVisibilitySteps({ origin, scope: plan.scope, eligible: plan.eligible }), hooks);
}

/**
 * Retry for one field: the same steps, for the given projects alone, each in the direction it had
 * (VIS-7, Q5). `origin` is the one the field had in the run. A project with no step for the field
 * is ignored. Pass `outcome.failures.map((failure) => failure.projectId)`.
 */
export function retryVisibility(
	port: VisibilityPort,
	plan: VisibilityPlan,
	field: FieldRef,
	origin: FieldOrigin,
	projectIds: readonly number[],
	hooks: VisibilityHooks
): Promise<VisibilityOutcome> {
	const wanted = new Set(projectIds);
	const steps = planVisibilitySteps({ origin, scope: plan.scope, eligible: plan.eligible }).filter((step) => wanted.has(step.projectId));
	return runVisibilitySteps(port, field, steps, hooks);
}
