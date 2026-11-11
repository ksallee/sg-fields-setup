import { describe, expect, it } from 'vitest';
import type { PlanScope } from './plan';
import { planVisibilitySteps } from './visibility-steps';

const A = { id: 1, name: 'A' };
const B = { id: 2, name: 'B' };
const C = { id: 3, name: 'C' };
const D = { id: 4, name: 'D' };
const eligible = [A, B, C, D];
const all: PlanScope = { kind: 'all-eligible', projects: eligible };
const chosen: PlanScope = { kind: 'chosen', projects: [C, A] };

const brief = (steps: ReturnType<typeof planVisibilitySteps>) =>
	steps.map((step) => `${step.visible ? 'show' : 'hide'} ${step.projectName} ${step.expect}`);

describe('planVisibilitySteps', () => {
	it('VIS-4: a new field with an empty picker is shown everywhere in scope and hidden nowhere', () => {
		expect(brief(planVisibilitySteps({ origin: 'new', scope: all, eligible }))).toEqual([
			'show A no-op',
			'show B no-op',
			'show C no-op',
			'show D no-op'
		]);
	});

	it('VIS-4: a new field with chosen projects is shown there and hidden on every other eligible project', () => {
		expect(brief(planVisibilitySteps({ origin: 'new', scope: chosen, eligible }))).toEqual([
			'show C no-op',
			'show A no-op',
			'hide B write',
			'hide D write'
		]);
	});

	it('VIS-5, VIS-6: an existing field is shown in scope and never hidden', () => {
		expect(brief(planVisibilitySteps({ origin: 'existing', scope: chosen, eligible }))).toEqual(['show C unknown', 'show A unknown']);
		expect(planVisibilitySteps({ origin: 'existing', scope: all, eligible }).every((step) => step.visible)).toBe(true);
	});

	it('says what each step is expected to do where the current state is known', () => {
		const current = new Map([
			[1, true],
			[3, false],
			[2, false]
		]);
		expect(brief(planVisibilitySteps({ origin: 'existing', scope: chosen, eligible, current }))).toEqual(['show C write', 'show A no-op']);
		expect(brief(planVisibilitySteps({ origin: 'new', scope: chosen, eligible, current }))).toEqual([
			'show C write',
			'show A no-op',
			'hide B no-op',
			'hide D write'
		]);
	});

	it('VIS-3: plans nothing for an empty scope, chosen or not', () => {
		expect(planVisibilitySteps({ origin: 'new', scope: { kind: 'all-eligible', projects: [] }, eligible: [] })).toEqual([]);
		expect(planVisibilitySteps({ origin: 'new', scope: { kind: 'chosen', projects: [] }, eligible })).toEqual([]);
	});

	it('hides nothing when the eligible list is not known', () => {
		expect(brief(planVisibilitySteps({ origin: 'new', scope: chosen, eligible: [] }))).toEqual(['show C no-op', 'show A no-op']);
	});

	it('plans one step per project, however often it is listed', () => {
		const scope: PlanScope = { kind: 'chosen', projects: [A, A] };
		expect(brief(planVisibilitySteps({ origin: 'new', scope, eligible: [A, B, B] }))).toEqual(['show A no-op', 'hide B write']);
	});
});
