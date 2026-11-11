import { describe, expect, it } from 'vitest';
import {
	analysisKey,
	analysisStatus,
	foldRead,
	isAnalysed,
	planVisibilityReads,
	rowVisibility,
	startAnalysis,
	type AnalysisRow,
	type VisibilityAnalysis
} from './visibility-analysis';
import { resolveScope, type ProjectsRead } from './visibility-scope';
import type { FieldVisibility } from './visibility-value';

const projects: ProjectsRead = {
	status: 'loaded',
	projects: [
		{ id: 1, name: 'A' },
		{ id: 2, name: 'B' },
		{ id: 3, name: 'C' },
		{ id: 9, name: 'Template', is_template: true }
	]
};
const eligible = resolveScope(projects, []).eligible;

const row = (entryId: string, cls: AnalysisRow['class'], entityType: string, programmaticName: string): AnalysisRow => ({
	entryId,
	class: cls,
	entityType,
	programmaticName
});

const rows = [
	row('e1', 'update', 'Version', 'sg_lens'),
	row('e2', 'create', 'Version', 'sg_new'),
	row('e3', 'already-matches', 'Shot', 'sg_cut'),
	row('e4', 'already-matches', 'Version', 'sg_grade'),
	row('e5', 'type-conflict', 'Asset', 'sg_kind'),
	row('e6', 'blocked', 'Task', 'sg_note'),
	row('e7', 'refused', 'Note', 'sg_x')
];

const on: FieldVisibility = { visible: true, editable: true };
const off: FieldVisibility = { visible: false, editable: true };
const locked: FieldVisibility = { visible: false, editable: false };

const listing = (fields: Record<string, FieldVisibility>) => ({ ok: true as const, fields: new Map(Object.entries(fields)) });

/** The analysis with every read answered: sg_lens hidden in B, sg_grade hidden and locked in C, sg_cut visible everywhere. */
function loadedAnalysis(): VisibilityAnalysis {
	let analysis = startAnalysis(rows, eligible);
	for (const read of analysis.reads) {
		const fields: Record<string, FieldVisibility> =
			read.entityType === 'Shot'
				? { sg_cut: on, code: on }
				: { sg_lens: read.projectId === 2 ? off : on, sg_grade: read.projectId === 3 ? locked : on, sg_other: off };
		analysis = foldRead(analysis, read, listing(fields));
	}
	return analysis;
}

describe('planVisibilityReads', () => {
	it('VIS-8: one read per entity type and project, for update and already-matching rows only', () => {
		expect(isAnalysed(rows[0]!)).toBe(true);
		expect(isAnalysed(rows[1]!)).toBe(false);
		expect(planVisibilityReads(rows, eligible)).toEqual([
			{ entityType: 'Version', projectId: 1 },
			{ entityType: 'Version', projectId: 2 },
			{ entityType: 'Version', projectId: 3 },
			{ entityType: 'Shot', projectId: 1 },
			{ entityType: 'Shot', projectId: 2 },
			{ entityType: 'Shot', projectId: 3 }
		]);
	});

	it('plans nothing without projects or without rows to analyse', () => {
		expect(planVisibilityReads(rows, [])).toEqual([]);
		expect(planVisibilityReads([rows[1]!, rows[4]!], eligible)).toEqual([]);
	});
});

describe('analysisKey', () => {
	it('VIS-8: is the same for the same fields and projects, in any order', () => {
		const key = analysisKey(rows, eligible);
		expect(analysisKey([...rows].reverse(), [...eligible].reverse())).toBe(key);
		expect(analysisKey(rows.filter((item) => item.class !== 'create' && item.class !== 'refused'), eligible)).toBe(key);
	});

	it('changes with the analysed fields and with the projects', () => {
		const key = analysisKey(rows, eligible);
		expect(analysisKey(rows.slice(1), eligible)).not.toBe(key);
		expect(analysisKey(rows, eligible.slice(1))).not.toBe(key);
	});

	it('VIS-11: does not change with the picker', () => {
		const all = resolveScope(projects, []);
		const some = resolveScope(projects, [2]);
		expect(analysisKey(rows, some.eligible)).toBe(analysisKey(rows, all.eligible));
	});
});

describe('foldRead', () => {
	it('VIS-8: keeps only the fields that belong to the plan', () => {
		const analysis = loadedAnalysis();
		const state = analysis.states.get('Version\n1');
		expect(state?.status).toBe('loaded');
		expect(state?.status === 'loaded' ? [...state.fields.keys()] : []).toEqual(['sg_lens', 'sg_grade']);
	});

	it('gives the same analysis whatever order the reads land in', () => {
		const start = startAnalysis(rows, eligible);
		const answer = (read: { entityType: string; projectId: number }) => listing({ sg_lens: read.projectId === 2 ? off : on, sg_grade: on, sg_cut: on });
		let forwards = start;
		for (const read of start.reads) forwards = foldRead(forwards, read, answer(read));
		let backwards = start;
		for (const read of [...start.reads].reverse()) backwards = foldRead(backwards, read, answer(read));
		for (const item of rows) {
			expect(rowVisibility(item, resolveScope(projects, [1, 2]), backwards)).toEqual(rowVisibility(item, resolveScope(projects, [1, 2]), forwards));
		}
	});

	it('does not change the analysis it is given, and ignores a read that was not planned', () => {
		const start = startAnalysis(rows, eligible);
		const next = foldRead(start, { entityType: 'Version', projectId: 1 }, listing({ sg_lens: on }));
		expect(start.states.get('Version\n1')).toEqual({ status: 'pending' });
		expect(next).not.toBe(start);
		expect(foldRead(start, { entityType: 'Asset', projectId: 1 }, listing({ sg_kind: on }))).toBe(start);
		expect(foldRead(start, { entityType: 'Version', projectId: 999999999 }, listing({ sg_lens: on }))).toBe(start);
	});
});

describe('analysisStatus', () => {
	it('is analysing until every read has landed, then loaded', () => {
		const start = startAnalysis(rows, eligible);
		expect(analysisStatus(start)).toBe('analysing');
		expect(analysisStatus(foldRead(start, start.reads[0]!, listing({})))).toBe('analysing');
		expect(analysisStatus(loadedAnalysis())).toBe('loaded');
		expect(analysisStatus(startAnalysis([rows[1]!], eligible))).toBe('loaded');
	});

	it('VIS-12: is failed once every read has landed and one of them failed', () => {
		let analysis = loadedAnalysis();
		analysis = foldRead(analysis, { entityType: 'Shot', projectId: 2 }, { ok: false, message: 'Failed to fetch' });
		expect(analysisStatus(analysis)).toBe('failed');
	});
});

describe('rowVisibility', () => {
	const names = (list: readonly { name: string }[]) => list.map((project) => project.name).join('');
	const brief = (entryId: string, chosen: number[], analysis: VisibilityAnalysis | null) => {
		const state = rowVisibility(rows.find((item) => item.entryId === entryId)!, resolveScope(projects, chosen), analysis);
		return {
			visible: names(state.visible),
			toAdd: names(state.toAdd),
			analysing: names(state.analysing),
			outside: names(state.outside),
			locked: names(state.locked),
			toHide: names(state.toHide)
		};
	};

	it('VIS-9: an existing row against all eligible projects', () => {
		expect(brief('e1', [], loadedAnalysis())).toEqual({ visible: 'AC', toAdd: 'B', analysing: '', outside: '', locked: '', toHide: '' });
	});

	it('VIS-9: an existing row against chosen projects, with the projects outside the picker where it is visible', () => {
		expect(brief('e1', [2], loadedAnalysis())).toEqual({ visible: '', toAdd: 'B', analysing: '', outside: 'AC', locked: '', toHide: '' });
		expect(brief('e3', [1], loadedAnalysis())).toEqual({ visible: 'A', toAdd: '', analysing: '', outside: 'BC', locked: '', toHide: '' });
	});

	it('VIS-11: a change of the picker recomputes from the same analysis', () => {
		const analysis = loadedAnalysis();
		expect(brief('e1', [1], analysis).toAdd).toBe('');
		expect(brief('e1', [1, 2], analysis).toAdd).toBe('B');
		expect(brief('e1', [3, 2], analysis)).toEqual({ visible: 'C', toAdd: 'B', analysing: '', outside: 'A', locked: '', toHide: '' });
	});

	it('VIS-9: a create row has every picker project as to add', () => {
		expect(brief('e2', [], null)).toEqual({ visible: '', toAdd: 'ABC', analysing: '', outside: '', locked: '', toHide: '' });
	});

	it('VIS-4: a create row with chosen projects also says where the new field will be hidden', () => {
		expect(brief('e2', [2], loadedAnalysis())).toEqual({ visible: '', toAdd: 'B', analysing: '', outside: '', locked: '', toHide: 'AC' });
	});

	it('VIS-9: projects are still being analysed until their read lands', () => {
		const start = startAnalysis(rows, eligible);
		expect(brief('e1', [], null).analysing).toBe('ABC');
		expect(brief('e1', [], start).analysing).toBe('ABC');
		const one = foldRead(start, { entityType: 'Version', projectId: 2 }, listing({ sg_lens: off }));
		expect(brief('e1', [], one)).toEqual({ visible: '', toAdd: 'B', analysing: 'AC', outside: '', locked: '', toHide: '' });
	});

	it('VIS-12: a failed read leaves its projects in analysing', () => {
		const analysis = foldRead(loadedAnalysis(), { entityType: 'Version', projectId: 1 }, { ok: false, message: 'Failed to fetch' });
		expect(brief('e1', [], analysis)).toEqual({ visible: 'C', toAdd: 'B', analysing: 'A', outside: '', locked: '', toHide: '' });
		expect(brief('e1', [3], analysis).outside).toBe('');
	});

	it('keeps a project in analysing when its listing does not hold the field', () => {
		const start = startAnalysis(rows, eligible);
		const analysis = foldRead(start, { entityType: 'Version', projectId: 1 }, listing({ sg_grade: on }));
		expect(brief('e1', [1], analysis).analysing).toBe('A');
	});

	it('sets apart a project where the field is hidden and the site does not let it be shown', () => {
		expect(brief('e4', [], loadedAnalysis())).toEqual({ visible: 'AB', toAdd: '', analysing: '', outside: '', locked: 'C', toHide: '' });
	});

	it('gives nothing for rows the run skips', () => {
		for (const entryId of ['e5', 'e6', 'e7']) {
			const state = rowVisibility(rows.find((item) => item.entryId === entryId)!, resolveScope(projects, []), loadedAnalysis());
			expect(state.applies).toBe(false);
			expect(state.toAdd).toEqual([]);
			expect(state.analysing).toEqual([]);
		}
	});

	it('VIS-3: an empty scope leaves nothing to add', () => {
		const empty = resolveScope({ status: 'failed', message: 'Failed to fetch' }, []);
		expect(rowVisibility(rows[0]!, empty, null).analysing).toEqual([]);
		expect(rowVisibility(rows[1]!, empty, null).toAdd).toEqual([]);
	});

	it('carries the entry and the class', () => {
		const state = rowVisibility(rows[0]!, resolveScope(projects, []), null);
		expect(state.entryId).toBe('e1');
		expect(state.class).toBe('update');
		expect(state.applies).toBe(true);
	});
});
