/**
 * The install screen's wiring (issues #18, #19): one object that holds what the screen shows and
 * calls the modules that decide it. No rule lives here.
 *
 * | what                         | decided by                                              |
 * |------------------------------|---------------------------------------------------------|
 * | the plan                     | `run-driver.replan`, the same reads a run makes (RUN-1)  |
 * | groups, rows, lines          | `install-view`                                          |
 * | ticks, select all            | `plan-selection`                                        |
 * | scope, notes                 | `visibility-scope` (`resolveScope`, no site read, VIS-11)|
 * | counters, nothing left to do | `visibility-analysis`, `visibility-text`                |
 * | summary, confirmation        | `install-text`, `visibility-text.visibilityCount`       |
 * | footer                       | `install-footer`                                        |
 * | the run                      | `run-driver.createRun`, `visibility-run`                |
 *
 * The site comes from `installSite(url)` and nowhere else. A run gets its visibility step bound
 * to the scope as it stands when Install is confirmed. The picker and the ticks are locked from
 * then until a refresh (RUN-25), so retry and resume apply the same scope.
 *
 * The analysis runs in the background and blocks nothing (VIS-8, VIS-12). It is asked again after
 * every plan and after every run (RUN-26).
 */
import type { EntityRef } from 'sg-widgets-core';
import { notify } from '$lib/app/toast';
import { downloadText } from '$lib/io/download';
import { readInstallSelection } from '$lib/io/install-selection';
import { installSite, type InstallSite } from '$lib/io/install-site';
import { sharedSetStore } from '$lib/io/set-store';
import { footerActions, type Footer } from '$lib/pure/install-footer';
import { confirmText, installSummary, planContext, reportFileName, summaryItems, type ConfirmText, type SummaryItem } from '$lib/pure/install-text';
import { analysisRows, groupRows, viewRows, type ViewGroup, type ViewRow } from '$lib/pure/install-view';
import type { LiveEntityType } from '$lib/pure/live-entity-types';
import { emptyPlanText, type PlanEntry, type PlanItem } from '$lib/pure/plan';
import { ALL_TICKED, ranSelectAllState, selectAllState, setAllTicked, tickedIds, toggleTick, type PlanSelection, type SelectAllState, type TickRow } from '$lib/pure/plan-selection';
import { INITIAL_RUN_STATE, runCounters, type RunState } from '$lib/pure/run';
import { createRun, replan, type Run } from '$lib/pure/run-driver';
import { errorMessage } from '$lib/pure/run-port';
import { reportIsEmpty, reportText, runReport } from '$lib/pure/run-report';
import { summaryText } from '$lib/pure/run-text';
import { analysisStatus, rowVisibility, type RowVisibility, type VisibilityAnalysis } from '$lib/pure/visibility-analysis';
import { createApplyVisibility, retryVisibility } from '$lib/pure/visibility-run';
import { analysisProjects, resolveScope, scopeNotes, scopeSummary, type ProjectsRead, type VisibilityScope } from '$lib/pure/visibility-scope';
import { nothingLeftToDo, visibilityCount, type VisibilityCount } from '$lib/pure/visibility-text';

/** Where the screen stands before it has a plan to show. */
export type LoadState =
	| { status: 'loading'; what: 'set' | 'site' | 'plan' }
	| { status: 'not-found' }
	| { status: 'set-failed'; message: string }
	| { status: 'disconnected'; problem: string }
	| { status: 'plan-failed'; message: string }
	| { status: 'loaded' };

const ABOVE_FOOTER = { position: 'top-right' } as const;

const NO_PROJECTS: ProjectsRead = { status: 'loaded', projects: [] };

export class InstallSession {
	load = $state.raw<LoadState>({ status: 'loading', what: 'set' });
	/** True while a refresh re-plans over rows that stay on screen. */
	refreshing = $state(false);
	setId = $state('');
	setName = $state('');
	/** False when the plan is of the editor's selection (PLN-1). */
	whole = $state(true);
	site = $state.raw<InstallSite | null>(null);
	entries = $state.raw<PlanEntry[]>([]);
	items = $state.raw<PlanItem[]>([]);
	entityTypes = $state.raw<readonly LiveEntityType[]>([]);
	/** Why the plan has no row, when it has none. */
	emptyText = $state<string | null>(null);
	projects = $state.raw<ProjectsRead>(NO_PROJECTS);
	/** What the picker holds. Empty: all eligible projects (VIS-2). */
	chosen = $state.raw<EntityRef[]>([]);
	analysis = $state.raw<VisibilityAnalysis | null>(null);
	selection = $state.raw<PlanSelection>(ALL_TICKED);
	run = $state.raw<RunState>(INITIAL_RUN_STATE);

	#runner: Run | null = null;
	#stopListening: (() => void) | null = null;
	#trashPageUrl: string | null = null;
	/** Which analysis may still write to `analysis`: an older one is ignored. */
	#asked = 0;
	#disposed = false;

	/* What the screen reads. Each line is one call into a pure module. */

	readonly resolved: VisibilityScope = $derived(resolveScope(this.projects, this.chosen.map((project) => project.id)));
	readonly rows: ViewRow[] = $derived(viewRows(this.items, this.run, this.entityTypes));
	readonly groups: ViewGroup[] = $derived(groupRows(this.rows));
	readonly visibility: ReadonlyMap<string, RowVisibility> = $derived(
		new Map(analysisRows(this.items, this.run).map((row) => [row.entryId, rowVisibility(row, this.resolved, this.analysis)]))
	);
	readonly tickRows: TickRow[] = $derived(
		this.rows.map((row) => {
			const visibility = this.visibility.get(row.entryId);
			return { entryId: row.entryId, selectable: row.selectable, disabled: visibility !== undefined && nothingLeftToDo(visibility) };
		})
	);
	/** The rows of the run once there is one; until then the ticked rows (RUN-25). */
	readonly ticked: ReadonlySet<string> = $derived(
		new Set(this.run.status === 'idle' ? tickedIds(this.selection, this.tickRows) : this.run.rows.map((row) => row.entryId))
	);
	readonly disabled: ReadonlySet<string> = $derived(new Set(this.tickRows.filter((row) => row.disabled).map((row) => row.entryId)));
	/** Before a run: the ticks. Once there is one: the rows it took, so a finished row stays counted (RUN-25). */
	readonly selectAll: SelectAllState = $derived(
		this.run.status === 'idle' ? selectAllState(this.selection, this.tickRows) : ranSelectAllState(this.tickRows, this.ticked)
	);
	/** Checkboxes and the picker are locked while running and after finishing (RUN-25). */
	readonly locked: boolean = $derived(this.run.status !== 'idle' || this.refreshing);
	readonly running: boolean = $derived(this.run.status === 'running');
	readonly summary: SummaryItem[] = $derived(summaryItems(this.#summary()));
	readonly scopeText: string = $derived(scopeSummary(this.resolved));
	readonly scopeNotes: string[] = $derived(scopeNotes(this.resolved));
	readonly visibilityCount: VisibilityCount = $derived(
		visibilityCount(
			[...this.ticked].flatMap((id) => this.visibility.get(id) ?? []),
			this.resolved.scope
		)
	);
	readonly analysisState: 'analysing' | 'loaded' | 'failed' | null = $derived(this.analysis ? analysisStatus(this.analysis) : null);
	readonly reportEmpty: boolean = $derived(reportIsEmpty(runReport(this.run)));
	readonly footer: Footer = $derived(
		footerActions({
			load: this.refreshing || this.load.status === 'loading' ? 'loading' : this.load.status === 'loaded' && this.items.length > 0 ? 'loaded' : 'failed',
			run: this.run,
			selected: this.ticked.size,
			reportEmpty: this.reportEmpty
		})
	);
	readonly context: string = $derived(planContext({ whole: this.whole, entries: this.entries.length, siteUrl: this.site?.siteUrl ?? '' }));
	readonly confirm: ConfirmText = $derived(
		confirmText({ summary: this.#summary(), siteUrl: this.site?.siteUrl ?? '', scope: this.scopeText, visibility: this.visibilityCount.text })
	);

	#summary() {
		const byId = new Map(this.items.map((item) => [item.entryId, item]));
		return installSummary(
			this.rows.map((row) => ({ class: row.class, ticked: this.ticked.has(row.entryId), reverseFieldTypes: byId.get(row.entryId)?.reverseFieldTypes ?? [] }))
		);
	}

	/* Opening. */

	/** Loads the set, takes the selection or the whole set, connects, then plans (RUN-1, PLN-1). */
	async open(setId: string, url: URL): Promise<void> {
		this.setId = setId;
		this.load = { status: 'loading', what: 'set' };
		try {
			const found = await (await sharedSetStore()).getSet(setId);
			if (this.#disposed) return;
			if (!found) {
				this.load = { status: 'not-found' };
				return;
			}
			const ids = url.searchParams.get('selection') === '1' ? readInstallSelection(setId) : null;
			const wanted = ids === null ? null : new Set(ids);
			this.setName = found.set.name;
			this.whole = wanted === null;
			this.entries = wanted === null ? found.entries : found.entries.filter((entry) => wanted.has(entry.id));
		} catch (error) {
			this.load = { status: 'set-failed', message: errorMessage(error) };
			return;
		}
		this.load = { status: 'loading', what: 'site' };
		try {
			const result = await installSite(url);
			if (this.#disposed) return;
			if (!result.ok) {
				this.load = { status: 'disconnected', problem: result.problem };
				return;
			}
			this.site = result.site;
		} catch (error) {
			this.load = { status: 'disconnected', problem: errorMessage(error) };
			return;
		}
		await this.#plan();
	}

	/**
	 * Reads the site and plans. Any read that fails shows the error in place of the plan, never a
	 * part of one (RUN-1, PLN-3). The project list is not such a read: its failure has its own rule
	 * (VIS-3).
	 */
	async #plan(): Promise<void> {
		const site = this.site;
		if (!site) return;
		if (this.items.length > 0) this.refreshing = true;
		else this.load = { status: 'loading', what: 'plan' };
		try {
			this.#trashPageUrl = await site.trashPageUrl();
			const [planned, projects] = await Promise.all([
				replan({ reader: site.reader, site: { siteUrl: site.siteUrl, trashPageUrl: this.#trashPageUrl } }, this.entries),
				site.loadProjects()
			]);
			if (this.#disposed) return;
			const mirrorsLeftOut = this.entries.length - planned.items.length;
			this.projects = projects;
			this.entityTypes = planned.site.entityTypes;
			this.items = planned.items;
			this.emptyText = emptyPlanText({ empty: planned.items.length > 0 ? null : mirrorsLeftOut > 0 ? 'only-mirrors' : 'no-entries', mirrorsLeftOut });
			this.load = { status: 'loaded' };
			this.#analyse();
		} catch (error) {
			if (this.#disposed) return;
			this.items = [];
			this.load = { status: 'plan-failed', message: errorMessage(error) };
		} finally {
			this.refreshing = false;
		}
	}

	/** Asks for the analysis of the rows as they stand. In the background: nothing waits on it (VIS-8, VIS-12). */
	#analyse(): void {
		const site = this.site;
		if (!site) return;
		const asked = ++this.#asked;
		const rows = analysisRows(this.items, this.run);
		const projects = analysisProjects(this.resolved);
		this.analysis = site.analyser.held(rows, projects);
		void site.analyser.analyse(rows, projects, (analysis) => {
			if (asked === this.#asked && !this.#disposed) this.analysis = analysis;
		});
	}

	/* The plan's controls. */

	/** The picker changed. The scope is recomputed from what is held, with no site read (VIS-11). */
	choose(value: EntityRef[]): void {
		if (this.locked) return;
		this.chosen = value;
		// With no project list the analysis reads the chosen projects, so it follows them.
		if (!this.resolved.eligibleKnown) this.#analyse();
	}

	toggle(entryId: string): void {
		if (!this.locked) this.selection = toggleTick(this.selection, entryId);
	}

	setAll(ticked: boolean): void {
		if (!this.locked) this.selection = setAllTicked(this.selection, this.tickRows, ticked);
	}

	/** Discards the run, forgets what was read, and plans again from the site. The ticks a person took off stay off. */
	async refresh(): Promise<void> {
		if (!this.footer.refresh.enabled || !this.site) return;
		this.#dropRun();
		this.site.clear();
		this.analysis = null;
		this.#asked += 1;
		await this.#plan();
	}

	#dropRun(): void {
		this.#stopListening?.();
		this.#stopListening = null;
		this.#runner?.reset();
		this.#runner = null;
		this.run = INITIAL_RUN_STATE;
	}

	/* The run. */

	/** Starts the run for the ticked rows, in plan order (RUN-6). Call after the person confirmed. */
	async apply(): Promise<void> {
		const site = this.site;
		if (!site || !this.footer.apply.enabled) return;
		const wanted = this.ticked;
		const selected = this.entries.filter((entry) => wanted.has(entry.id));
		// The scope as it stands now. The picker is locked from here on.
		const scope = this.resolved;
		const runner = createRun({
			port: site.port,
			reader: site.reader,
			site: { siteUrl: site.siteUrl, trashPageUrl: this.#trashPageUrl },
			applyVisibility: createApplyVisibility(site.visibility, scope),
			retryVisibility: (field, origin, projectIds, hooks) => retryVisibility(site.visibility, scope, field, origin, projectIds, hooks)
		});
		this.#runner = runner;
		this.#stopListening = runner.subscribe((state) => (this.run = state));
		await this.#drive(() => runner.start(selected));
	}

	cancel(): void {
		this.#runner?.cancel();
	}

	async retry(): Promise<void> {
		const runner = this.#runner;
		if (runner && this.footer.retry.enabled) await this.#drive(() => runner.retry());
	}

	async resume(): Promise<void> {
		const runner = this.#runner;
		if (runner && this.footer.resume.enabled) await this.#drive(() => runner.resume());
	}

	/** One row's visibility again (VIS-7, Q5). */
	async retryVisibility(entryId: string): Promise<void> {
		const runner = this.#runner;
		if (runner && !this.running) await this.#drive(() => runner.retryVisibility(entryId));
	}

	/** Runs one operation of the run to its end, then says how it went and reads visibility again (RUN-24, RUN-26). */
	async #drive(operation: () => Promise<RunState>): Promise<void> {
		try {
			const state = await operation();
			if (this.#disposed) return;
			const text = summaryText(state);
			const counters = runCounters(state);
			if (text === null) return;
			// Top right: the footer's actions stay clear (docs/design.md).
			if (state.error !== null || counters.failed > 0) notify.error(text, undefined, ABOVE_FOOTER);
			else if (state.status === 'cancelled' || counters.visibilityWarnings > 0) notify.warning(text, undefined, ABOVE_FOOTER);
			else notify.success(text, undefined, ABOVE_FOOTER);
		} catch (error) {
			if (!this.#disposed) notify.error(errorMessage(error), undefined, ABOVE_FOOTER);
		} finally {
			if (!this.#disposed && this.site) {
				// New fields exist now, and visibility changed.
				this.site.analyser.clear();
				this.#analyse();
			}
		}
	}

	/** The run's report as a text file (RUN-20). */
	downloadReport(): void {
		const at = new Date().toISOString();
		downloadText(reportFileName(this.setName, at), reportText(runReport(this.run), { siteUrl: this.site?.siteUrl, at }), 'text/plain');
	}

	/** The page is going away. A run in progress is asked to stop after the step in flight. */
	dispose(): void {
		this.#disposed = true;
		this.#asked += 1;
		this.#runner?.cancel();
		this.#stopListening?.();
	}
}
