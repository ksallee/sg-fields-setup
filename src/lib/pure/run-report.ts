/**
 * The report of a run (RUN-20, Q12): what it changed on the site, by entity type and name. There
 * is no undo, so this is the record a person keeps. Data first, then a plain text builder; the
 * screen may offer the text as a download.
 *
 * It lists what the site was told and answered, whether or not the row then passed its read-back:
 * a field that was created and failed verification is on the site and is in the report.
 */
import { reverseFieldsText } from './plan-reason';
import type { RunRow, RunState } from './run';

/** One field the run changed. */
export interface ReportField {
	entityType: string;
	/** The programmatic name on the site. For a field created under another name, that name. */
	name: string;
	displayName: string;
	/** How the row ended, or `pending` and `in_progress` when the report is made mid-run. */
	rowState: RunRow['state'];
	/** The entity types the run made a reverse field on for this field (corpus findings 116 and 121). */
	reverseFieldTypes: string[];
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
				reverseFieldTypes: [...new Set(effects.flatMap((effect) => effect.reverseFieldTypes ?? []))]
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
	// A link keeps a reverse field on each of its valid types. The planner's words say where.
	const linked = new Map<string, string>();
	for (const field of [...report.created, ...report.updated]) {
		const note = reverseFieldsText(field.reverseFieldTypes);
		if (note !== null) linked.set(`${field.entityType}.${field.name}`, note);
	}
	if (linked.size > 0) {
		lines.push(`Reverse fields (${linked.size})`);
		for (const [name, note] of linked) lines.push(`  ${name}: ${note}`);
		lines.push('');
	}
	lines.push('Install has no undo. To remove a field, delete it in Flow PT.', '');
	return lines.join('\n');
}
