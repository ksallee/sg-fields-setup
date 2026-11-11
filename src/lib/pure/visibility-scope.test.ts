import { describe, expect, it } from 'vitest';
import {
	ELIGIBLE_PROJECT_FILTERS,
	VISIBILITY_EXPLANATION,
	analysisProjects,
	placeholderName,
	resolveScope,
	scopeNotes,
	scopeSummary,
	type ProjectRow,
	type ProjectsRead
} from './visibility-scope';

const row = (id: number, name: string, flags: Partial<ProjectRow> = {}): ProjectRow => ({
	id,
	name,
	is_template: false,
	archived: false,
	is_demo: false,
	...flags
});

const loaded: ProjectsRead = {
	status: 'loaded',
	projects: [
		row(70, 'Zebra'),
		row(71, 'Template', { is_template: true }),
		row(72, 'alpha'),
		row(73, 'Old show', { archived: true }),
		row(74, 'Demo', { is_demo: true }),
		row(75, 'Mango')
	]
};
const failed: ProjectsRead = { status: 'failed', message: 'Failed to fetch' };

describe('resolveScope', () => {
	it('VIS-2: an empty picker means all eligible projects, sorted by name', () => {
		const resolved = resolveScope(loaded, []);
		expect(resolved.scope).toEqual({
			kind: 'all-eligible',
			projects: [
				{ id: 72, name: 'alpha' },
				{ id: 75, name: 'Mango' },
				{ id: 70, name: 'Zebra' }
			]
		});
		expect(resolved.eligible).toEqual(resolved.scope.projects);
		expect(resolved.eligibleKnown).toBe(true);
		expect(resolved.dropped).toEqual([]);
		expect(resolved.problem).toBeNull();
	});

	it('VIS-3: chosen ids are resolved to names, in the list order', () => {
		const resolved = resolveScope(loaded, [70, 72]);
		expect(resolved.scope).toEqual({
			kind: 'chosen',
			projects: [
				{ id: 72, name: 'alpha' },
				{ id: 70, name: 'Zebra' }
			]
		});
		expect(resolved.eligible.map((project) => project.id)).toEqual([72, 75, 70]);
		expect(resolved.placeholderNames).toBe(false);
	});

	it('drops a chosen id that is unknown or not eligible, and counts it', () => {
		const resolved = resolveScope(loaded, [70, 999999999, 71, 74, 70]);
		expect(resolved.scope).toEqual({ kind: 'chosen', projects: [{ id: 70, name: 'Zebra' }] });
		expect(resolved.dropped).toEqual([999999999, 71, 74]);
	});

	it('stays a chosen scope with no project when every chosen id is dropped', () => {
		const resolved = resolveScope(loaded, [71]);
		expect(resolved.scope).toEqual({ kind: 'chosen', projects: [] });
		expect(resolved.dropped).toEqual([71]);
	});

	it('VIS-3: when the lookup fails, chosen projects get placeholder names from their ids', () => {
		const resolved = resolveScope(failed, [75, 70, 75]);
		expect(resolved.scope).toEqual({
			kind: 'chosen',
			projects: [
				{ id: 75, name: 'Project 75' },
				{ id: 70, name: 'Project 70' }
			]
		});
		expect(placeholderName(75)).toBe('Project 75');
		expect(resolved.placeholderNames).toBe(true);
		expect(resolved.eligible).toEqual([]);
		expect(resolved.eligibleKnown).toBe(false);
		expect(resolved.problem).toBe('Failed to fetch');
	});

	it('VIS-3: when the all-eligible lookup fails, the scope is empty', () => {
		const resolved = resolveScope(failed, []);
		expect(resolved.scope).toEqual({ kind: 'all-eligible', projects: [] });
		expect(resolved.eligibleKnown).toBe(false);
	});

	it('drops an id that is not a whole positive number', () => {
		expect(resolveScope(failed, [0, -3, 1.5, Number.NaN, 70]).scope.projects).toEqual([{ id: 70, name: 'Project 70' }]);
		expect(resolveScope(failed, [0, -3, 1.5, Number.NaN, 70]).dropped).toEqual([0, -3, 1.5, Number.NaN]);
	});

	it('names a project with no name by its id', () => {
		const resolved = resolveScope({ status: 'loaded', projects: [row(80, '  ')] }, []);
		expect(resolved.scope.projects).toEqual([{ id: 80, name: 'Project 80' }]);
	});
});

describe('scope texts', () => {
	it('VIS-1: explains that fields are site-wide', () => {
		expect(VISIBILITY_EXPLANATION).toBe(
			'Fields are site-wide. The picker only decides on which projects they are visible. Leave it empty for all eligible projects.'
		);
	});

	it('RUN-5: all eligible projects with their number', () => {
		expect(scopeSummary(resolveScope(loaded, []))).toBe('All eligible projects (3)');
	});

	it('RUN-5: the number chosen', () => {
		expect(scopeSummary(resolveScope(loaded, [70, 72]))).toBe('2 chosen projects');
		expect(scopeSummary(resolveScope(loaded, [70]))).toBe('1 chosen project');
	});

	it('VIS-3: says when no visibility will be applied', () => {
		const resolved = resolveScope(failed, []);
		expect(scopeSummary(resolved)).toBe('No projects');
		expect(scopeNotes(resolved)).toEqual(['The project list could not be read. No visibility will be changed.']);
	});

	it('VIS-3: says when names are placeholders and nothing can be hidden', () => {
		expect(scopeNotes(resolveScope(failed, [70]))).toEqual([
			'The project list could not be read. Projects show by id and were not checked. New fields stay visible on the other projects.'
		]);
	});

	it('says how many chosen projects were left out', () => {
		expect(scopeNotes(resolveScope(loaded, [70, 71]))).toEqual(['1 chosen project is not eligible and was left out.']);
		expect(scopeNotes(resolveScope(loaded, [70, 71, 74]))).toEqual(['2 chosen projects are not eligible and were left out.']);
		expect(scopeNotes(resolveScope(loaded, [71]))).toEqual([
			'1 chosen project is not eligible and was left out.',
			'No chosen project is left. No visibility will be changed.'
		]);
		expect(scopeNotes(resolveScope(loaded, [70]))).toEqual([]);
	});
});

describe('analysisProjects', () => {
	it('VIS-11: every eligible project, whatever the picker holds', () => {
		expect(analysisProjects(resolveScope(loaded, [70])).map((project) => project.id)).toEqual([72, 75, 70]);
	});

	it('falls back to the chosen projects when the list could not be read', () => {
		expect(analysisProjects(resolveScope(failed, [70])).map((project) => project.id)).toEqual([70]);
	});
});

describe('the picker filter (VIS-2, Q4)', () => {
	it('asks the site for the eligible projects only: no template, nothing archived, no demo project', () => {
		expect(ELIGIBLE_PROJECT_FILTERS).toEqual({
			logical_operator: 'and',
			conditions: [
				['is_template', 'is', false],
				['archived', 'is', false],
				['is_demo', 'is', false]
			]
		});
	});
});
