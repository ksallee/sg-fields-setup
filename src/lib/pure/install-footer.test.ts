import { describe, expect, it } from 'vitest';
import { footerActions, type FooterInput } from './install-footer';
import { INITIAL_RUN_STATE, type RunRow, type RunState } from './run';

function row(entryId: string, state: RunRow['state']): RunRow {
	return {
		entryId,
		entityType: 'Version',
		programmaticName: `sg_${entryId}`,
		displayName: entryId,
		dataType: 'text',
		class: 'create',
		state,
		note: null,
		effects: [],
		visibility: null
	};
}

function run(status: RunState['status'], states: RunRow['state'][] = [], more: Partial<RunState> = {}): RunState {
	return { ...INITIAL_RUN_STATE, status, phase: status === 'running' ? 'applying' : null, rows: states.map((state, index) => row(`e${index}`, state)), ...more };
}

function footer(more: Partial<FooterInput> = {}) {
	return footerActions({ load: 'loaded', run: INITIAL_RUN_STATE, selected: 2, reportEmpty: true, ...more });
}

function shown(more: Partial<FooterInput> = {}): string[] {
	const actions = footer(more);
	return (['refresh', 'report', 'close', 'cancel', 'retry', 'resume', 'apply'] as const).filter((name) => actions[name].visible && actions[name].enabled);
}

describe('footer actions (the table under RUN-5)', () => {
	it('refresh: not while loading, not while running', () => {
		expect(footer({ load: 'loading' }).refresh.enabled).toBe(false);
		expect(footer({ run: run('running', ['in_progress']) }).refresh.enabled).toBe(false);
		expect(footer().refresh.enabled).toBe(true);
		expect(footer({ load: 'failed' }).refresh.enabled).toBe(true);
		expect(footer({ run: run('finished', ['done']) }).refresh.enabled).toBe(true);
	});

	it('apply: plan loaded, not running, not finished, at least one row selected', () => {
		expect(footer().apply).toMatchObject({ visible: true, enabled: true, label: 'Install 2 fields' });
		expect(footer({ selected: 1 }).apply.label).toBe('Install 1 field');
		expect(footer({ selected: 0 }).apply).toMatchObject({ visible: true, enabled: false, label: 'Install' });
		expect(footer({ load: 'loading' }).apply.enabled).toBe(false);
		expect(footer({ load: 'failed' }).apply.enabled).toBe(false);
		expect(footer({ run: run('running', ['in_progress']) }).apply.visible).toBe(false);
		expect(footer({ run: run('finished', ['done']) }).apply.visible).toBe(false);
		expect(footer({ run: run('cancelled', ['done', 'pending']) }).apply.visible).toBe(false);
	});

	it('cancel: while running, once (RUN-18)', () => {
		expect(footer().cancel.visible).toBe(false);
		expect(footer({ run: run('running', ['in_progress']) }).cancel).toMatchObject({ visible: true, enabled: true, label: 'Cancel' });
		expect(footer({ run: run('running', ['in_progress'], { cancelRequested: true }) }).cancel).toMatchObject({
			visible: true,
			enabled: false,
			label: 'Cancelling…'
		});
		expect(footer({ run: run('finished', ['done']) }).cancel.visible).toBe(false);
	});

	it('close: not while running', () => {
		expect(footer().close.enabled).toBe(true);
		expect(footer({ load: 'loading' }).close.enabled).toBe(true);
		expect(footer({ run: run('running', ['in_progress']) }).close.enabled).toBe(false);
		expect(footer({ run: run('finished', ['failed']) }).close.enabled).toBe(true);
	});

	it('retry: finished with failures (RUN-19)', () => {
		expect(footer({ run: run('finished', ['done', 'skipped']) }).retry.visible).toBe(false);
		expect(footer({ run: run('finished', ['done', 'failed', 'failed']) }).retry).toMatchObject({ visible: true, enabled: true, label: 'Retry 2 failed' });
		expect(footer({ run: run('cancelled', ['failed', 'pending']) }).retry).toMatchObject({ visible: true, label: 'Retry 1 failed' });
		expect(footer({ run: run('running', ['failed', 'in_progress']) }).retry.visible).toBe(false);
	});

	it('resume: rows left pending by a cancel or a run-level error (RUN-20)', () => {
		expect(footer({ run: run('cancelled', ['done', 'pending', 'pending']) }).resume).toMatchObject({ visible: true, enabled: true, label: 'Resume 2 pending' });
		expect(footer({ run: run('finished', ['done', 'pending'], { error: 'Failed to fetch' }) }).resume.visible).toBe(true);
		expect(footer({ run: run('finished', ['done']) }).resume.visible).toBe(false);
		expect(footer({ run: run('running', ['done', 'pending']) }).resume.visible).toBe(false);
	});

	it('report: once a run changed something on the site (RUN-20)', () => {
		expect(footer({ run: run('finished', ['done']), reportEmpty: false }).report).toMatchObject({ visible: true, enabled: true });
		expect(footer({ run: run('finished', ['skipped']), reportEmpty: true }).report.visible).toBe(false);
		expect(footer({ run: run('running', ['done', 'in_progress']), reportEmpty: false }).report.visible).toBe(false);
		expect(footer({ reportEmpty: false }).report.visible).toBe(false);
	});

	it('offers exactly what each moment allows', () => {
		expect(shown({ load: 'loading' })).toEqual(['close']);
		expect(shown()).toEqual(['refresh', 'close', 'apply']);
		expect(shown({ selected: 0 })).toEqual(['refresh', 'close']);
		expect(shown({ run: run('running', ['in_progress', 'pending']) })).toEqual(['cancel']);
		expect(shown({ run: run('finished', ['done', 'skipped']), reportEmpty: false })).toEqual(['refresh', 'report', 'close']);
		expect(shown({ run: run('cancelled', ['done', 'failed', 'pending']), reportEmpty: false })).toEqual(['refresh', 'report', 'close', 'retry', 'resume']);
	});

	it('names one primary action at a time', () => {
		expect(footer().primary).toBe('apply');
		expect(footer({ run: run('running', ['in_progress']) }).primary).toBeNull();
		expect(footer({ run: run('cancelled', ['failed', 'pending']) }).primary).toBe('resume');
		expect(footer({ run: run('finished', ['failed']) }).primary).toBe('retry');
		expect(footer({ run: run('finished', ['done']) }).primary).toBe('close');
	});
});
