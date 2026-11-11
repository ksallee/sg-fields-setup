import { describe, expect, it } from 'vitest';
import { PROJECT_ELIGIBILITY_FIELDS, eligibleProjects, isEligibleProject } from './project-eligibility';

// The flags are the ones the corpus measured (findings/018_project_listing).
describe('project eligibility', () => {
	it('VIS-2, Q4: reads the three checkboxes and nothing else', () => {
		expect([...PROJECT_ELIGIBILITY_FIELDS]).toEqual(['is_template', 'archived', 'is_demo']);
	});

	it('VIS-2, Q4: a template, an archived project and a demo project are out', () => {
		expect(isEligibleProject({ is_template: false, archived: false, is_demo: false })).toBe(true);
		expect(isEligibleProject({ is_template: true, archived: false, is_demo: false })).toBe(false);
		expect(isEligibleProject({ is_template: false, archived: true, is_demo: false })).toBe(false);
		expect(isEligibleProject({ is_template: false, archived: false, is_demo: true })).toBe(false);
	});

	it('B5: status is never consulted', () => {
		expect(isEligibleProject({ is_template: false, archived: false, is_demo: false, sg_status: null })).toBe(true);
		expect(isEligibleProject({ is_template: false, archived: false, is_demo: false, sg_status: 'Lost' })).toBe(true);
	});

	it('keeps the eligible projects in their order', () => {
		const rows = [
			{ id: 3, is_template: false },
			{ id: 1, is_template: true },
			{ id: 2, is_demo: false }
		];
		expect(eligibleProjects(rows).map((row) => row.id)).toEqual([3, 2]);
	});
});
