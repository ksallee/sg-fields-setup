/** Whether the run made the field or found it: decides what visibility may do (VIS-4, VIS-5). */
export type FieldOrigin = 'new' | 'existing';

/** One project where a visibility step failed (VIS-7). */
export interface VisibilityFailure {
	projectId: number;
	projectName: string;
	message: string;
}

/** What applying visibility to one field came to. */
export interface VisibilityOutcome {
	/** Per-project steps attempted. */
	total: number;
	/** Steps that finished, written or already right. */
	done: number;
	/** Steps that changed the site. */
	written: number;
	failures: VisibilityFailure[];
	/** True when a cancel stopped it before the last step. */
	cancelled: boolean;
}

/** Hooks the run engine hands to a visibility step. */
export interface VisibilityHooks {
	/** Asked between per-project steps (RUN-18). */
	isCancelled(): boolean;
	/** Called after each per-project step (RUN-22). */
	onProgress(done: number, total: number): void;
}

/** Applies per-project visibility to one field. Never throws: failures come back in the outcome. */
export type ApplyVisibility = (
	field: { entityType: string; name: string },
	origin: FieldOrigin,
	hooks: VisibilityHooks
) => Promise<VisibilityOutcome>;
