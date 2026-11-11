/**
 * The report of a run (RUN-20, Q12): what it changed on the site, by entity type and name. There
 * is no undo, so this is the record a person keeps. Data first, then a plain text builder; the
 * screen may offer the text as a download.
 *
 * It lists what the site was told and answered, whether or not the row then passed its read-back:
 * a field that was created and failed verification is on the site and is in the report.
 */
import type { RunRow, RunState } from './run';

/** One field the run changed. */
export interface ReportField {
	entityType: string;
	/** The programmatic name on the site. For a field created under another name, that name. */
	name: string;
	displayName: string;
	/** How the row ended, or `pending` and `in_progress` when the report is made mid-run. */
	rowState: RunRow['state'];
	/** True when valid types were written: reverse fields changed on those types (corpus finding 121). */
	validTypes: boolean;
}

export interface RunReport {
	/** Fields created and still live. */
	created: ReportField[];
	/** Fields restored from the trash and still live. */
	revived: ReportField[];
	/** Fields whose settings were written, the created and revived ones included when they were. */
	updated: ReportField[];
	/** Fields the run made or restored, then put back in the trash. Their names are taken. */
	retired: ReportField[];
}

function byTypeAndName(a: ReportField, b: ReportField): number {
	if (a.entityType !== b.entityType) return a.entityType < b.entityType ? -1 : 1;
	return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** What the run changed, each list sorted by entity type, then name. Works on a run in any state. */
export function runReport(state: Pick<RunState, 'rows'>): RunReport {
	const report: RunReport = { created: [], revived: [], updated: [], retired: [] };
	for (const row of state.rows) {
		// By name: a row can touch two fields, the wanted one and one created under another name.
		const names = [...new Set(row.effects.map((effect) => effect.name))];
		for (const name of names) {
			const effects = row.effects.filter((effect) => effect.name === name);
			const has = (kind: (typeof effects)[number]['kind']) => effects.some((effect) => effect.kind === kind);
			const field: ReportField = {
				entityType: row.entityType,
				name,
				displayName: row.displayName,
				rowState: row.state,
				validTypes: effects.some((effect) => effect.validTypes === true)
			};
			// The last word on whether it is live: the latest of created, revived and retired.
			const last = effects.findLast((effect) => effect.kind !== 'updated')?.kind;
			if (last === 'retired') {
				report.retired.push(field);
				continue;
			}
			if (has('created')) report.created.push(field);
			else if (has('revived')) report.revived.push(field);
			if (has('updated')) report.updated.push(field);
		}
	}
	for (const list of Object.values(report) as ReportField[][]) list.sort(byTypeAndName);
	return report;
}

/** Whether the run changed anything on the site. */
export function reportIsEmpty(report: RunReport): boolean {
	return report.created.length + report.revived.length + report.updated.length + report.retired.length === 0;
}

function section(title: string, fields: readonly ReportField[], note?: string): string[] {
	if (fields.length === 0) return [];
	const lines = [`${title} (${fields.length})`];
	if (note) lines.push(note);
	for (const field of fields) {
		// A live field whose row failed is on the site in a state nobody checked.
		const failed = !note && field.rowState === 'failed' ? ' [the row failed: check this field]' : '';
		lines.push(`  ${field.entityType}.${field.name}  "${field.displayName}"${failed}`);
	}
	return [...lines, ''];
}

/**
 * The report as plain text, one field per line under "Created", "Restored from the trash",
 * "Updated" and "Put back in the trash". `site` and `at` head it when given: pure code never
 * reads the clock.
 */
export function reportText(report: RunReport, head: { siteUrl?: string; at?: string } = {}): string {
	const lines = ['Install report'];
	if (head.siteUrl) lines.push(`Site: ${head.siteUrl}`);
	if (head.at) lines.push(`Time: ${head.at}`);
	lines.push('');
	if (reportIsEmpty(report)) return [...lines, 'Nothing was changed on the site.', ''].join('\n');
	lines.push(
		...section('Created', report.created),
		...section('Restored from the trash', report.revived),
		...section('Updated', report.updated),
		...section(
			'Put back in the trash',
			report.retired,
			'Install made or restored these fields and could not use them. Their names stay taken until they are deleted for good from the trash page for fields.'
		)
	);
	const linked = [...report.created, ...report.updated].filter((field) => field.validTypes);
	const names = [...new Set(linked.map((field) => `${field.entityType}.${field.name}`))];
	if (names.length > 0) {
		lines.push(
			`Valid types were written on ${names.join(', ')}.`,
			'The site keeps a reverse field on each valid type. A type that was added got a new field there. A type that was removed had its field retired, and that name is spent.',
			''
		);
	}
	lines.push('Install has no undo. To remove a field, delete it in FPT.', '');
	return lines.join('\n');
}
