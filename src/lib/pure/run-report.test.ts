import { describe, expect, it } from 'vitest';
import type { FieldEffect, RunRow } from './run';
import { reportIsEmpty, reportText, runReport } from './run-report';

function row(name: string, effects: FieldEffect[], more: Partial<RunRow> = {}): RunRow {
	return {
		entryId: name,
		entityType: 'Version',
		programmaticName: name,
		displayName: name.replace('sg_', ''),
		dataType: 'text',
		class: 'create',
		state: 'done',
		note: null,
		effects,
		visibility: null,
		...more
	};
}

const rows = [
	row('sg_made', [{ kind: 'created', name: 'sg_made' }]),
	row('sg_link', [{ kind: 'updated', name: 'sg_link', validTypes: true }], { entityType: 'Shot' }),
	row('sg_back', [{ kind: 'revived', name: 'sg_back' }, { kind: 'updated', name: 'sg_back' }]),
	row('sg_bad', [{ kind: 'revived', name: 'sg_bad' }, { kind: 'retired', name: 'sg_bad' }], { state: 'failed' }),
	row('sg_dup', [{ kind: 'created', name: 'sg_dup_1' }, { kind: 'retired', name: 'sg_dup_1' }], { state: 'failed' }),
	row('sg_half', [{ kind: 'created', name: 'sg_half' }], { state: 'failed' }),
	row('sg_same', [])
];

describe('runReport (RUN-20)', () => {
	it('lists what was created, revived, updated and put back in the trash, by entity type then name', () => {
		const report = runReport({ rows });
		expect(report.created.map((field) => field.name)).toEqual(['sg_half', 'sg_made']);
		expect(report.revived.map((field) => field.name)).toEqual(['sg_back']);
		expect(report.updated.map((field) => `${field.entityType}.${field.name}`)).toEqual(['Shot.sg_link', 'Version.sg_back']);
		expect(report.retired.map((field) => field.name)).toEqual(['sg_bad', 'sg_dup_1']);
		expect(report.created[0]).toEqual({ entityType: 'Version', name: 'sg_half', displayName: 'half', rowState: 'failed', validTypes: false });
	});

	it('is empty for a run that changed nothing', () => {
		expect(reportIsEmpty(runReport({ rows: [rows[6]] }))).toBe(true);
		expect(reportText(runReport({ rows: [] }))).toBe('Install report\n\nNothing was changed on the site.\n');
	});

	it('reads as plain text, with the reverse fields of written valid types (finding 121) and no undo (Q12)', () => {
		expect(reportText(runReport({ rows }), { siteUrl: 'https://fake.shotgrid.autodesk.com', at: '2026-11-10T09:00:00.000Z' })).toBe(
			[
				'Install report',
				'Site: https://fake.shotgrid.autodesk.com',
				'Time: 2026-11-10T09:00:00.000Z',
				'',
				'Created (2)',
				'  Version.sg_half  "half" [the row failed: check this field]',
				'  Version.sg_made  "made"',
				'',
				'Restored from the trash (1)',
				'  Version.sg_back  "back"',
				'',
				'Updated (2)',
				'  Shot.sg_link  "link"',
				'  Version.sg_back  "back"',
				'',
				'Put back in the trash (2)',
				'Install made or restored these fields and could not use them. Their names stay taken until they are deleted for good from the trash page for fields.',
				'  Version.sg_bad  "bad"',
				'  Version.sg_dup_1  "dup"',
				'',
				'Valid types were written on Shot.sg_link.',
				'The site keeps a reverse field on each valid type. A type that was added got a new field there. A type that was removed had its field retired, and that name is spent.',
				'',
				'Install has no undo. To remove a field, delete it in FPT.',
				''
			].join('\n')
		);
	});
});
