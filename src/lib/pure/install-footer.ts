/**
 * The install screen's footer: which actions show and which can be used (the table under RUN-5,
 * RUN-18 to RUN-20). Pure, as typed values: the footer component renders them and decides nothing.
 *
 * | action  | when                                                              |
 * |---------|-------------------------------------------------------------------|
 * | refresh | not loading, not running                                          |
 * | apply   | plan loaded, not running, not finished, at least one row selected |
 * | cancel  | running                                                           |
 * | close   | not running                                                       |
 * | retry   | ended with failed rows                                            |
 * | resume  | ended with rows still pending: a cancel, or a run-level error     |
 * | report  | ended, and the run changed something on the site                  |
 *
 * An action that does not apply at all is not shown. One that will apply is shown disabled:
 * apply with nothing selected, close while running, cancel once asked.
 */
import { resumeIds, retryIds, type RunState } from './run';
import { fieldCount } from './set-text';

export interface FooterInput {
	/** `loading`: the set, the site or the plan is being read. `loaded`: a plan with rows is shown. `failed`: anything else. */
	load: 'loading' | 'loaded' | 'failed';
	run: RunState;
	/** How many rows are ticked. */
	selected: number;
	/** Whether the run's report has nothing in it. */
	reportEmpty: boolean;
}

export interface FooterAction {
	visible: boolean;
	enabled: boolean;
	label: string;
}

export type FooterActionName = 'refresh' | 'apply' | 'cancel' | 'close' | 'retry' | 'resume' | 'report';

export type Footer = Record<FooterActionName, FooterAction> & {
	/** The one action drawn as primary, or null while a run is in progress. */
	primary: FooterActionName | null;
};

export function footerActions(input: FooterInput): Footer {
	const { run } = input;
	const running = run.status === 'running';
	const idle = run.status === 'idle';
	const ended = run.status === 'finished' || run.status === 'cancelled';
	const failed = ended ? retryIds(run).length : 0;
	const pending = ended ? resumeIds(run).length : 0;
	const canApply = idle && input.load === 'loaded' && input.selected > 0;

	return {
		refresh: { visible: true, enabled: input.load !== 'loading' && !running, label: 'Refresh' },
		apply: { visible: idle, enabled: canApply, label: canApply ? `Install ${fieldCount(input.selected)}` : 'Install' },
		cancel: { visible: running, enabled: running && !run.cancelRequested, label: run.cancelRequested ? 'Cancelling…' : 'Cancel' },
		close: { visible: true, enabled: !running, label: 'Close' },
		retry: { visible: failed > 0, enabled: failed > 0, label: `Retry ${failed} failed` },
		resume: { visible: pending > 0, enabled: pending > 0, label: `Resume ${pending} pending` },
		report: { visible: ended && !input.reportEmpty, enabled: ended && !input.reportEmpty, label: 'Download report' },
		primary: running ? null : idle ? 'apply' : pending > 0 ? 'resume' : failed > 0 ? 'retry' : 'close'
	};
}
