/**
 * What the install screen needs from a site, and the one place it gets it.
 *
 * The screen never builds a client. It asks `installSite(url)` once and is handed an
 * `InstallSite`: the run's writes and reads, the trash page, the project list, the visibility
 * analyser and port, and the context the project picker searches with.
 *
 * `liveInstallSite` is the connected site: `$lib/live` for the address and the bearer,
 * `schema-client` for the writes, `visibility` for the per-project reads.
 *
 * Under `vite dev` only, `?fake` in the address swaps in a site held in memory
 * (`install-site-fake`), so the run can be driven with no network and nothing written anywhere.
 * The swap sits behind `import.meta.env.DEV`, which a production build replaces with `false`: the
 * branch and the module it imports are dropped from the build. `install-site.test.ts` holds the
 * source to that shape.
 */
import type { SgContext } from 'sg-widgets-core';
import { liveClientOptions, liveContext, liveSchema, liveWriter, prepareLive } from '$lib/live';
import type { RunReader, SchemaWritePort } from '$lib/pure/run-port';
import type { VisibilityPort } from '$lib/pure/visibility-run';
import type { ProjectsRead } from '$lib/pure/visibility-scope';
import { coreSchemaSource } from './core-schema-source';
import { onceLoaded } from './read-once';
import { createTrashPage, siteSchemaClient } from './schema-client';
import { afterSiteWrite } from './site-cache';
import { coreVisibilitySource, createVisibilityAnalyser, loadProjects, visibilityPort, type VisibilityAnalyser } from './visibility';

export interface InstallSite {
	/** `fake` only under `vite dev` with `?fake`. The screen says so. */
	kind: 'live' | 'fake';
	siteUrl: string;
	/** The four schema writes of a run. */
	port: SchemaWritePort;
	/** The reads of a plan and a run, each one past any cache (RUN-6). */
	reader: RunReader;
	/** The address of the site's trash page for fields, or null (RUN-21). Looked up once. Never rejects. */
	trashPageUrl(): Promise<string | null>;
	/** The project list, read once a session; a failed read is tried again the next time (VIS-3). Never rejects. */
	loadProjects(): Promise<ProjectsRead>;
	/** One analyser a session (VIS-8). */
	analyser: VisibilityAnalyser;
	/** What `createApplyVisibility` runs on (VIS-7). */
	visibility: VisibilityPort;
	/** What the project picker searches with. */
	pickerContext: SgContext;
	/**
	 * Forgets everything read, here and in the widgets: the refresh (D6), and the end of a run,
	 * since a write may have happened (`afterSiteWrite` in `./site-cache`).
	 */
	clear(): void;
}

export type InstallSiteResult = { ok: true; site: InstallSite } | { ok: false; problem: string };

/** The address flag that asks for the fake site. Read under `vite dev` only. */
export const FAKE_FLAG = 'fake';

let live: InstallSite | null = null;

/** The connected site. Call after `prepareLive()` has settled. One object a session. */
export function liveInstallSite(): InstallSite {
	if (live) return live;
	const options = liveClientOptions();
	const schema = liveSchema();
	const client = liveWriter();
	const { port, reader, visibilityWriter } = siteSchemaClient(options, schema);
	const analyser = createVisibilityAnalyser(coreVisibilitySource(options));
	live = {
		kind: 'live',
		siteUrl: options.siteUrl,
		port,
		reader,
		trashPageUrl: createTrashPage(client, options.siteUrl),
		loadProjects: onceLoaded(() => loadProjects(client)),
		analyser,
		visibility: visibilityPort(coreSchemaSource(options), visibilityWriter),
		pickerContext: liveContext(),
		clear() {
			afterSiteWrite({ schema, context: liveContext() });
			analyser.clear();
		}
	};
	return live;
}

/** The site the install screen works on: the connected one, or why there is none. */
export async function installSite(url: URL): Promise<InstallSiteResult> {
	if (import.meta.env.DEV && url.searchParams.has(FAKE_FLAG)) {
		const { fakeInstallSite } = await import('$lib/testing/install-site-fake');
		return { ok: true, site: fakeInstallSite(url.searchParams) };
	}
	const state = await prepareLive();
	if (state.problem !== null) return { ok: false, problem: state.problem };
	return { ok: true, site: liveInstallSite() };
}
