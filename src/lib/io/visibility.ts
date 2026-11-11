/**
 * The site calls of per-project visibility. Thin: every rule is in `$lib/pure`.
 *
 * | call                                         | here                    | for                         |
 * |----------------------------------------------|-------------------------|-----------------------------|
 * | `POST /entity/projects/_search`, every page  | `loadProjects`          | the picker, the scope       |
 * | `GET /schema/<Type>/fields?project_id=N`     | `coreVisibilitySource`  | the analysis (VIS-8)        |
 * | `GET /schema/<Type>/fields/<f>?project_id=N` | `visibilityPort`, read  | each step of the run (VIS-7)|
 * | `PUT /schema/<Type>/fields/<f>` + project    | `visibilityPort`, write | each step of the run        |
 *
 * All of it is measured in corpus `findings/115_field_visibility_per_project` and
 * `findings/018_project_listing`.
 *
 * The write is core's `SchemaClient.updateField(entityType, field, properties, projectId)`,
 * wrapped by `schema-client.visibilityWriter` and handed to `visibilityPort` by
 * `install-site`. Without a writer a write rejects, which the executor turns into a failed step.
 *
 * The listing read is core's `RestSchemaClient.readRawFields(entityType, projectId)`: the
 * wrapped records, each with that project's `visible`.
 */
import { RestSchemaClient, type RestClientOptions, type SearchOptions, type SearchResult } from 'sg-widgets-core';
import { PROJECT_ELIGIBILITY_FIELDS } from '$lib/pure/project-eligibility';
import { runCapped } from '$lib/pure/run-capped';
import {
	DEFAULT_ANALYSIS_CAP,
	analysisKey,
	foldRead,
	startAnalysis,
	type AnalysisRow,
	type VisibilityAnalysis,
	type VisibilityRead,
	type VisibilityReadResult
} from '$lib/pure/visibility-analysis';
import { siteErrorMessage } from '$lib/pure/site-error';
import type { VisibilityPort } from '$lib/pure/visibility-run';
import type { ProjectRow, ProjectsRead, ScopeProject } from '$lib/pure/visibility-scope';
import { readVisibilityListing, type VisibleWrite } from '$lib/pure/visibility-value';
import type { SchemaSource } from './schema';
import { isSchemaName } from '$lib/pure/schema-name';

/* The project list. */

/** What lists projects: core's client (`liveWriter()`, `liveContext().client`) fits. */
export interface ProjectLister {
	search(entityType: string, options: SearchOptions): Promise<SearchResult>;
}

/** Rows a page. A page costs the same whatever its size up to 500 (corpus `findings/082`). */
export const PROJECT_PAGE_SIZE = 500;

/** A stop for a site that never sends a short page: 100 000 projects. */
const MOST_PAGES = 200;

/**
 * Every project of the site: id, name and the eligibility checkboxes (VIS-2). No filter: status
 * is not a liveness signal (corpus `findings/018`, B5), and eligibility is computed here from the
 * checkboxes, so the rule stays in one place. Sorted by id so the pages do not shift. Paging
 * stops on a short or an empty page, never on `links.next` (corpus `findings/006`). Rejects when
 * a page cannot be read.
 */
export async function readProjects(client: ProjectLister): Promise<ProjectRow[]> {
	const projects: ProjectRow[] = [];
	for (let number = 1; number <= MOST_PAGES; number += 1) {
		const page = await client.search('Project', {
			fields: ['name', ...PROJECT_ELIGIBILITY_FIELDS],
			sort: 'id',
			page: { size: PROJECT_PAGE_SIZE, number }
		});
		for (const row of page.data) {
			const name = row.attributes['name'];
			projects.push({
				id: row.id,
				name: typeof name === 'string' ? name : '',
				is_template: row.attributes['is_template'],
				archived: row.attributes['archived'],
				is_demo: row.attributes['is_demo']
			});
		}
		if (page.data.length < PROJECT_PAGE_SIZE) break;
	}
	return projects;
}

/** The project list as the scope takes it. Never rejects: a failed lookup has its own rule (VIS-3). */
export async function loadProjects(client: ProjectLister): Promise<ProjectsRead> {
	try {
		return { status: 'loaded', projects: await readProjects(client) };
	} catch (error) {
		return { status: 'failed', message: siteErrorMessage(error) };
	}
}

/* The listing read, per type and project. */

/** Core's `SchemaClient.readRawFields(entityType, projectId)`, with the project required. */
export interface VisibilitySource {
	/**
	 * The `data` of `GET /schema/<Type>/fields?project_id=N`: every field of the type with that
	 * project's `visible`. Rejects when the read fails. The project id must come from the project
	 * list: one that does not exist answers 200 with everything visible (corpus `findings/115`).
	 */
	readRawFields(entityType: string, projectId: number): Promise<unknown>;
}

export function coreVisibilitySource(options: RestClientOptions): VisibilitySource {
	const schema = new RestSchemaClient(options);
	return {
		async readRawFields(entityType, projectId) {
			if (!isSchemaName(entityType)) throw new Error(`'${entityType}' is not an entity type name.`);
			// Without a project every field reads visible. Never ask that way.
			if (!Number.isInteger(projectId) || projectId <= 0) throw new Error(`'${String(projectId)}' is not a project id.`);
			// A refusal is core's SchemaApiError, its message the site's detail.
			return schema.readRawFields(entityType, projectId);
		}
	};
}

/** One read of the analysis: each field's `visible` value and `editable` flag. Never rejects (VIS-12). */
export async function readTypeVisibility(source: VisibilitySource, read: VisibilityRead): Promise<VisibilityReadResult> {
	try {
		return { ok: true, fields: readVisibilityListing(await source.readRawFields(read.entityType, read.projectId)) };
	} catch (error) {
		return { ok: false, message: siteErrorMessage(error) };
	}
}

/* The analysis, run and kept. */

export interface VisibilityAnalyser {
	/**
	 * Reads where the rows' fields are visible in the given projects (`analysisProjects(scope)`),
	 * a few reads at once (VIS-8). Never rejects: a failed read stays in the analysis as failed
	 * (VIS-12). The same rows and projects are read once and shared until `clear` (VIS-8). The
	 * picker is not part of what is asked, so changing it reads nothing (VIS-11).
	 *
	 * `onUpdate` hears the analysis at the start and after each read that lands, so rows leave
	 * "analysing" as they can. A caller that joins a finished analysis hears the result once.
	 */
	analyse(rows: readonly AnalysisRow[], projects: readonly ScopeProject[], onUpdate?: (analysis: VisibilityAnalysis) => void): Promise<VisibilityAnalysis>;
	/** The analysis held for these rows and projects, as far as it has come, else null. Never reads. */
	held(rows: readonly AnalysisRow[], projects: readonly ScopeProject[]): VisibilityAnalysis | null;
	/** Forgets everything: the refresh, and the recompute after a run (RUN-26). */
	clear(): void;
}

interface HeldAnalysis {
	analysis: VisibilityAnalysis;
	finished: boolean;
	promise: Promise<VisibilityAnalysis>;
	listeners: ((analysis: VisibilityAnalysis) => void)[];
}

export function createVisibilityAnalyser(source: VisibilitySource, options: { cap?: number } = {}): VisibilityAnalyser {
	const cap = options.cap ?? DEFAULT_ANALYSIS_CAP;
	const byKey = new Map<string, HeldAnalysis>();

	function tell(listener: ((analysis: VisibilityAnalysis) => void) | undefined, analysis: VisibilityAnalysis): void {
		try {
			listener?.(analysis);
		} catch {
			/* A listener's failure is its own. */
		}
	}

	function start(rows: readonly AnalysisRow[], projects: readonly ScopeProject[]): HeldAnalysis {
		const first = startAnalysis(rows, projects);
		const held: HeldAnalysis = { analysis: first, finished: false, promise: Promise.resolve(first), listeners: [] };
		held.promise = (async () => {
			// Let the first caller's listener in before any read lands.
			await Promise.resolve();
			for (const listener of held.listeners) tell(listener, held.analysis);
			await runCapped(
				first.reads,
				cap,
				(read) => readTypeVisibility(source, read),
				(index, result) => {
					const read = first.reads[index];
					if (!read) return;
					const answer: VisibilityReadResult = result.ok ? result.value : { ok: false, message: siteErrorMessage(result.error) };
					held.analysis = foldRead(held.analysis, read, answer);
					for (const listener of held.listeners) tell(listener, held.analysis);
				}
			);
			held.finished = true;
			held.listeners = [];
			return held.analysis;
		})();
		byKey.set(first.key, held);
		return held;
	}

	return {
		analyse(rows, projects, onUpdate) {
			const existing = byKey.get(analysisKey(rows, projects));
			const held = existing ?? start(rows, projects);
			if (onUpdate) {
				if (held.finished) tell(onUpdate, held.analysis);
				else {
					held.listeners.push(onUpdate);
					// A caller that joins a running analysis hears where it stands.
					if (existing) tell(onUpdate, held.analysis);
				}
			}
			return held.promise;
		},
		held: (rows, projects) => byKey.get(analysisKey(rows, projects))?.analysis ?? null,
		clear: () => byKey.clear()
	};
}

/* The executor's port. */

/**
 * What writes one field's `visible` for one project. sg-widgets core's
 * `SchemaClient.updateField(entityType, field, properties, projectId)` is one as it is: it sends
 * `{ properties, project_id }`, the measured body (corpus `findings/115`).
 */
export interface VisibilityWriter {
	updateField(entityType: string, field: string, properties: VisibleWrite, projectId: number): Promise<unknown>;
}

/**
 * The port the executor runs on (`createApplyVisibility`). The read is the schema source's
 * one-field read (`coreSchemaSource(...)`). The writer is core's schema client
 * (`visibilityWriter` in `schema-client.ts`).
 */
export function visibilityPort(reader: Pick<SchemaSource, 'readField'>, writer: VisibilityWriter): VisibilityPort {
	return {
		readField: (entityType, field, projectId) => reader.readField(entityType, field, projectId),
		updateField: (entityType, field, properties, projectId) => writer.updateField(entityType, field, properties, projectId)
	};
}
