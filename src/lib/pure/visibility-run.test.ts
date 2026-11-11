import { describe, expect, it } from 'vitest';
import type { FieldReply } from './live-field';
import type { PlanScope } from './plan';
import { createApplyVisibility, errorMessage, retryVisibility, runVisibilitySteps, type VisibilityPlan, type VisibilityPort } from './visibility-run';
import { planVisibilitySteps } from './visibility-steps';
import type { VisibilityHooks } from './visibility-types';
import type { VisibleWrite } from './visibility-value';

const A = { id: 1, name: 'A' };
const B = { id: 2, name: 'B' };
const C = { id: 3, name: 'C' };
const D = { id: 4, name: 'D' };
const eligible = [A, B, C, D];
const all: PlanScope = { kind: 'all-eligible', projects: eligible };
const chosen: PlanScope = { kind: 'chosen', projects: [A, C] };
const field = { entityType: 'Version', name: 'sg_lens' };

/** The refusal of a write, shaped like core's error: the server's words are in the body. */
function refusal(status: number, title: string): Error {
	return Object.assign(new Error('Bad Request'), { status, body: { errors: [{ status, code: 105, title, detail: null }] } });
}

interface FakeOptions {
	/** Projects where the field is hidden. Every other project shows it, as a new field does. */
	hidden?: number[];
	/** Projects where `visible.editable` is false. */
	locked?: number[];
	failRead?: Record<number, unknown>;
	failWrite?: Record<number, unknown>;
	/** Projects whose write answers 200 and changes nothing. */
	ignoreWrite?: number[];
	reply?: (projectId: number) => FieldReply | null;
}

/** A site in memory: one field's `visible` per project, failures on demand, and a log of every call. */
function fakePort(options: FakeOptions = {}) {
	const hidden = new Set(options.hidden ?? []);
	const log: string[] = [];
	const port: VisibilityPort = {
		async readField(entityType, name, projectId) {
			log.push(`read ${entityType}.${name} ${projectId}`);
			if (options.failRead && projectId in options.failRead) throw options.failRead[projectId];
			const canned = options.reply?.(projectId);
			if (canned) return canned;
			return { status: 'found', raw: { visible: { value: !hidden.has(projectId), editable: !options.locked?.includes(projectId) } } };
		},
		async updateField(entityType, name, properties: VisibleWrite, projectId) {
			log.push(`write ${entityType}.${name} ${projectId} ${JSON.stringify(properties)}`);
			if (options.failWrite && projectId in options.failWrite) throw options.failWrite[projectId];
			if (options.ignoreWrite?.includes(projectId)) return null;
			if (properties[0].value) hidden.delete(projectId);
			else hidden.add(projectId);
			return null;
		}
	};
	return { port, log, hidden };
}

function hooks(cancelAfter = Number.POSITIVE_INFINITY) {
	const progress: string[] = [];
	let asked = 0;
	const value: VisibilityHooks = {
		isCancelled: () => asked++ >= cancelAfter,
		onProgress: (done, total) => progress.push(`${done}/${total}`)
	};
	return { hooks: value, progress, asked: () => asked };
}

const plan = (scope: PlanScope): VisibilityPlan => ({ scope, eligible });

describe('createApplyVisibility', () => {
	it('VIS-7: reads each project first and writes nothing where the state is already right', async () => {
		const site = fakePort();
		const run = hooks();
		const outcome = await createApplyVisibility(site.port, plan(all))(field, 'new', run.hooks);
		expect(outcome).toEqual({ total: 4, done: 4, written: 0, failures: [], cancelled: false });
		expect(site.log).toEqual(['read Version.sg_lens 1', 'read Version.sg_lens 2', 'read Version.sg_lens 3', 'read Version.sg_lens 4']);
		expect(run.progress).toEqual(['1/4', '2/4', '3/4', '4/4']);
	});

	it('VIS-4: a new field with chosen projects ends up visible only there', async () => {
		const site = fakePort();
		const outcome = await createApplyVisibility(site.port, plan(chosen))(field, 'new', hooks().hooks);
		expect(outcome).toEqual({ total: 4, done: 4, written: 2, failures: [], cancelled: false });
		expect([...site.hidden]).toEqual([2, 4]);
		expect(site.log).toEqual([
			'read Version.sg_lens 1',
			'read Version.sg_lens 3',
			'read Version.sg_lens 2',
			'write Version.sg_lens 2 [{"property_name":"visible","value":false}]',
			'read Version.sg_lens 2',
			'read Version.sg_lens 4',
			'write Version.sg_lens 4 [{"property_name":"visible","value":false}]',
			'read Version.sg_lens 4'
		]);
	});

	it('VIS-5, VIS-6: an existing field is shown in scope and never hidden anywhere', async () => {
		const site = fakePort({ hidden: [3] });
		const outcome = await createApplyVisibility(site.port, plan(chosen))(field, 'existing', hooks().hooks);
		expect(outcome).toEqual({ total: 2, done: 2, written: 1, failures: [], cancelled: false });
		expect([...site.hidden]).toEqual([]);
		expect(site.log.filter((line) => line.startsWith('write'))).toEqual(['write Version.sg_lens 3 [{"property_name":"visible","value":true}]']);
	});

	it('VIS-7, Q5: a failed step is collected with the project and the server\'s words, and the rest still runs', async () => {
		const site = fakePort({
			hidden: [1, 2, 3],
			failWrite: { 2: refusal(400, 'API schema_field_update(): The Project with the given project_id does not exist.') },
			failRead: { 3: new TypeError('Failed to fetch') }
		});
		const run = hooks();
		const outcome = await createApplyVisibility(site.port, plan(all))(field, 'existing', run.hooks);
		expect(outcome).toEqual({
			total: 4,
			done: 2,
			written: 1,
			failures: [
				{ projectId: 2, projectName: 'B', message: 'API schema_field_update(): The Project with the given project_id does not exist.' },
				{ projectId: 3, projectName: 'C', message: 'Failed to fetch' }
			],
			cancelled: false
		});
		expect(run.progress).toEqual(['1/4', '2/4', '3/4', '4/4']);
	});

	it('plans no write where the site does not let visibility change, and says so', async () => {
		const site = fakePort({ hidden: [1], locked: [1, 2] });
		const outcome = await createApplyVisibility(site.port, plan({ kind: 'chosen', projects: [A, B] }))(field, 'existing', hooks().hooks);
		expect(outcome.done).toBe(1);
		expect(outcome.failures).toEqual([{ projectId: 1, projectName: 'A', message: 'Flow PT does not let this field be shown or hidden.' }]);
		expect(site.log.some((line) => line.startsWith('write'))).toBe(false);
	});

	it('fails a step whose write was accepted and not applied', async () => {
		const site = fakePort({ hidden: [1], ignoreWrite: [1] });
		const outcome = await createApplyVisibility(site.port, plan({ kind: 'chosen', projects: [A] }))(field, 'existing', hooks().hooks);
		expect(outcome).toEqual({
			total: 1,
			done: 0,
			written: 0,
			failures: [{ projectId: 1, projectName: 'A', message: 'Flow PT accepted the change and did not apply it.' }],
			cancelled: false
		});
	});

	it('fails a step whose field the site does not have', async () => {
		const missing: FieldReply = { status: 'missing', message: "Field 'Version.sg_lens' does not exist." };
		const site = fakePort({ reply: (projectId) => (projectId === 1 ? missing : projectId === 2 ? { status: 'undeclared' } : null) });
		const outcome = await createApplyVisibility(site.port, plan({ kind: 'chosen', projects: [A, B] }))(field, 'existing', hooks().hooks);
		expect(outcome.failures).toEqual([
			{ projectId: 1, projectName: 'A', message: "Field 'Version.sg_lens' does not exist." },
			{ projectId: 2, projectName: 'B', message: 'The schema does not declare Version.sg_lens.' }
		]);
	});

	it('VIS-7: a record with no visible value counts as visible', async () => {
		const site = fakePort({ reply: () => ({ status: 'found', raw: { name: { value: 'Lens', editable: true } } }) });
		const outcome = await createApplyVisibility(site.port, plan({ kind: 'chosen', projects: [A] }))(field, 'existing', hooks().hooks);
		expect(outcome).toEqual({ total: 1, done: 1, written: 0, failures: [], cancelled: false });
	});

	it('RUN-18: asks for a cancel between steps and stops with the rest untouched', async () => {
		const site = fakePort({ hidden: [1, 2, 3, 4] });
		const run = hooks(2);
		const outcome = await createApplyVisibility(site.port, plan(all))(field, 'existing', run.hooks);
		expect(outcome).toEqual({ total: 4, done: 2, written: 2, failures: [], cancelled: true });
		expect([...site.hidden]).toEqual([3, 4]);
		expect(run.progress).toEqual(['1/4', '2/4']);
	});

	it('RUN-18: a cancel before the first step writes and reads nothing', async () => {
		const site = fakePort({ hidden: [1] });
		const outcome = await createApplyVisibility(site.port, plan(all))(field, 'existing', hooks(0).hooks);
		expect(outcome).toEqual({ total: 4, done: 0, written: 0, failures: [], cancelled: true });
		expect(site.log).toEqual([]);
	});

	it('is not cancelled when the cancel comes after the last step', async () => {
		const run = hooks(1);
		const outcome = await createApplyVisibility(fakePort().port, plan({ kind: 'chosen', projects: [A] }))(field, 'existing', run.hooks);
		expect(outcome.cancelled).toBe(false);
		expect(run.asked()).toBe(1);
	});

	it('VIS-3: an empty scope applies nothing', async () => {
		const site = fakePort();
		const run = hooks();
		const outcome = await createApplyVisibility(site.port, { scope: { kind: 'all-eligible', projects: [] }, eligible: [] })(field, 'new', run.hooks);
		expect(outcome).toEqual({ total: 0, done: 0, written: 0, failures: [], cancelled: false });
		expect(site.log).toEqual([]);
		expect(run.progress).toEqual([]);
	});

	it('never throws: a port that throws outside a promise and hooks that throw are survived', async () => {
		const port: VisibilityPort = {
			readField() {
				throw new Error('not connected');
			},
			updateField: async () => null
		};
		const outcome = await createApplyVisibility(port, plan({ kind: 'chosen', projects: [A, B] }))(field, 'existing', {
			isCancelled() {
				throw new Error('hook');
			},
			onProgress() {
				throw new Error('hook');
			}
		});
		expect(outcome.failures.map((failure) => failure.message)).toEqual(['not connected', 'not connected']);
		expect(outcome.cancelled).toBe(false);
	});
});

describe('retryVisibility', () => {
	it('VIS-7, Q5: retries only the failed projects, each in the direction it had', async () => {
		const site = fakePort({ failWrite: { 2: new Error('nope') } });
		const apply = createApplyVisibility(site.port, plan(chosen));
		const first = await apply(field, 'new', hooks().hooks);
		expect(first.failures.map((failure) => failure.projectId)).toEqual([2]);

		const again = fakePort({ hidden: [4] });
		const run = hooks();
		const outcome = await retryVisibility(again.port, plan(chosen), field, 'new', first.failures.map((failure) => failure.projectId), run.hooks);
		expect(outcome).toEqual({ total: 1, done: 1, written: 1, failures: [], cancelled: false });
		expect(again.log).toEqual(['read Version.sg_lens 2', 'write Version.sg_lens 2 [{"property_name":"visible","value":false}]', 'read Version.sg_lens 2']);
		expect(run.progress).toEqual(['1/1']);
	});

	it('ignores a project that has no step for this field', async () => {
		const site = fakePort();
		const outcome = await retryVisibility(site.port, plan(chosen), field, 'existing', [2, 999], hooks().hooks);
		expect(outcome).toEqual({ total: 0, done: 0, written: 0, failures: [], cancelled: false });
		expect(site.log).toEqual([]);
	});
});

describe('runVisibilitySteps', () => {
	it('runs the steps it is given, in their order', async () => {
		const site = fakePort({ hidden: [3] });
		const steps = planVisibilitySteps({ origin: 'existing', scope: chosen, eligible });
		await runVisibilitySteps(site.port, field, steps.reverse(), hooks().hooks);
		expect(site.log.map((line) => line.split(' ').slice(0, 3).join(' '))).toEqual([
			'read Version.sg_lens 3',
			'write Version.sg_lens 3',
			'read Version.sg_lens 3',
			'read Version.sg_lens 1'
		]);
	});
});

describe('errorMessage', () => {
	it('prefers what the server said: the detail, else the title', () => {
		expect(errorMessage(refusal(400, "API schema_field_update(): The 'visible' property requires a project to be updated."))).toBe(
			"API schema_field_update(): The 'visible' property requires a project to be updated."
		);
		expect(errorMessage(Object.assign(new Error('Not Found'), { body: { errors: [{ title: 'Not Found', detail: "Field 'Version.sg_x' does not exist." }] } }))).toBe(
			"Field 'Version.sg_x' does not exist."
		);
	});

	it('falls back to the error\'s own message, then to a plain line', () => {
		expect(errorMessage(new Error('Failed to fetch'))).toBe('Failed to fetch');
		expect(errorMessage('timeout')).toBe('timeout');
		expect(errorMessage(null)).toBe('The step failed.');
		expect(errorMessage(new Error(''))).toBe('The step failed.');
	});
});
