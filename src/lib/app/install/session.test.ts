/**
 * The install session, driven as the screen drives it. The session is wiring: these tests hold
 * the seams a pure test cannot reach. The store is a stub. The site is the fake of
 * `$lib/io/install-site-fake`, which `?fake` in the address asks for under vitest as under
 * `vite dev`: nothing here reaches a network.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ getSet: vi.fn() }));

vi.mock('$lib/io/set-store', async (original) => ({
	...(await original<typeof import('$lib/io/set-store')>()),
	sharedSetStore: async () => store
}));

const download = vi.hoisted(() => ({ downloadText: vi.fn() }));
vi.mock('$lib/io/download', () => download);

import { notify } from '$lib/app/toast';
import { writeInstallSelection } from '$lib/io/install-selection';
import * as installSiteModule from '$lib/io/install-site';
import { SetStoreError } from '$lib/io/set-store';
import type { FakeSite } from '$lib/pure/fixtures/fake-site';
import type { EntryDefinition } from '$lib/pure/model';
import { InstallSession } from './session.svelte';

const URL_OF_SET = new URL('http://localhost/sets/s1/install');
/** The fake site, with no delay and no injected fault. */
const FAKE = new URL('http://localhost/sets/s1/install?fake&delay=0&faults=0');

function definition(overrides: Partial<EntryDefinition> = {}): EntryDefinition {
	return {
		targetEntityType: 'Shot',
		programmaticName: 'sg_lens',
		displayName: 'Lens',
		dataType: 'text',
		validTypes: [],
		validValues: [],
		defaultValue: null,
		description: null,
		uniquePerProject: false,
		...overrides
	};
}

/** What the store answers for a set with these entries. Only what the session reads. */
function stored(entries: EntryDefinition[]) {
	return { set: { id: 's1', name: 'Lens kit' }, entries: entries.map((entry, index) => ({ ...entry, id: `e${index}`, setId: 's1' })) };
}

/** A session opened on the fake site with these entries. */
async function opened(entries: EntryDefinition[], url = FAKE): Promise<InstallSession> {
	store.getSet.mockResolvedValueOnce(stored(entries));
	const session = new InstallSession();
	await session.open('s1', url);
	return session;
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	download.downloadText.mockReset();
});

/** The fake site behind the session, as `window.__installFake` hands it to a drive. Call before `opened`. */
function exposeFake(): () => FakeSite {
	const page: { __installFake?: FakeSite } = {};
	vi.stubGlobal('window', page);
	return () => page.__installFake!;
}

/**
 * Runs `then` as soon as the first field has been created, inside the run: the one moment a test
 * can act mid-run with no clock. Answers the spy on `createField`.
 */
function afterFirstCreate(session: InstallSession, then: () => void) {
	const port = session.site!.port;
	const create = port.createField.bind(port);
	let count = 0;
	return vi.spyOn(port, 'createField').mockImplementation(async (...args) => {
		const answer = await create(...args);
		if ((count += 1) === 1) then();
		return answer;
	});
}

/** Waits until the run has taken its rows: Install was confirmed and the re-plan is under way or done. */
const started = (session: InstallSession): Promise<void> => vi.waitFor(() => expect(session.run.rows.length).toBeGreaterThan(0));

describe('a failed read of the set', () => {
	it('a store fault on the install screen shows the plain fallback, never the raw error', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const raw = new DOMException('The database connection is closing.', 'InvalidStateError');
		store.getSet.mockRejectedValueOnce(raw);
		const session = new InstallSession();
		await session.open('s1', URL_OF_SET);
		expect(session.load).toEqual({ status: 'set-failed', message: 'Something went wrong. Try again.' });
		expect(logged).toHaveBeenCalledWith(raw);
	});

	it('shows a store error\'s own plain sentence', async () => {
		const failure = new SetStoreError('unavailable');
		store.getSet.mockRejectedValueOnce(failure);
		const session = new InstallSession();
		await session.open('s1', URL_OF_SET);
		expect(session.load).toEqual({ status: 'set-failed', message: failure.message });
	});

	it('says a set that is gone is not found', async () => {
		store.getSet.mockResolvedValueOnce(null);
		const session = new InstallSession();
		await session.open('s1', URL_OF_SET);
		expect(session.load).toEqual({ status: 'not-found' });
	});
});

describe('the plan the screen shows', () => {
	it('PLN-10: a set of only mirror entries shows no row and says why, in the plan\'s words', async () => {
		const session = await opened([definition({ dataType: 'pivot_column' }), definition({ programmaticName: 'sg_sum', dataType: 'summary' })]);
		expect(session.load).toEqual({ status: 'loaded' });
		expect(session.items).toEqual([]);
		expect(session.emptyText).toBe('Nothing to install. The selected fields have data types the API cannot create.');
	});

	it('RUN-1: plans the set against the site', async () => {
		const session = await opened([definition(), definition({ programmaticName: 'sg_drive_count', displayName: 'Drive Count', dataType: 'number' })]);
		expect(session.items.map((item) => [item.programmaticName, item.class])).toEqual([
			['sg_lens', 'create'],
			['sg_drive_count', 'type-conflict']
		]);
		expect(session.emptyText).toBeNull();
	});
});

describe('what was read is dropped when a write may have happened (audit finding 1)', () => {
	const SLOW = new URL('http://localhost/sets/s1/install?fake&delay=2&faults=0');
	const two = [definition(), definition({ programmaticName: 'sg_focal', displayName: 'Focal' })];

	it('RUN-26: a run that finished', async () => {
		const session = await opened(two);
		const cleared = vi.spyOn(session.site!, 'clear');
		await session.apply(session.askConfirm());
		expect(session.run.status).toBe('finished');
		expect(session.run.rows.map((row) => row.state)).toEqual(['done', 'done']);
		expect(cleared).toHaveBeenCalledTimes(1);
	});

	it('RUN-18: a run that was cancelled', async () => {
		const session = await opened(two, SLOW);
		const cleared = vi.spyOn(session.site!, 'clear');
		const running = session.apply(session.askConfirm());
		session.cancel();
		await running;
		expect(session.run.status).toBe('cancelled');
		expect(cleared).toHaveBeenCalledTimes(1);
	});

	it('RUN-17: a run that failed outside any item', async () => {
		const session = await opened(two);
		const cleared = vi.spyOn(session.site!, 'clear');
		vi.spyOn(session.site!.reader, 'entityTypes').mockRejectedValueOnce(new TypeError('Failed to fetch'));
		await session.apply(session.askConfirm());
		expect(session.run).toMatchObject({ status: 'finished', error: 'Failed to fetch' });
		expect(cleared).toHaveBeenCalledTimes(1);
	});

	it('a run the person walked away from: the page is gone, the writes are not', async () => {
		const session = await opened(two, SLOW);
		const cleared = vi.spyOn(session.site!, 'clear');
		const running = session.apply(session.askConfirm());
		session.dispose();
		await running;
		expect(cleared).toHaveBeenCalledTimes(1);
	});

	it('RUN-5 footer: Refresh', async () => {
		const session = await opened(two);
		const cleared = vi.spyOn(session.site!, 'clear');
		await session.refresh();
		expect(cleared).toHaveBeenCalledTimes(1);
		expect(session.load).toEqual({ status: 'loaded' });
	});
});

describe('Install needs the proof of the confirmation (audit finding 15)', () => {
	const two = [definition(), definition({ programmaticName: 'sg_focal', displayName: 'Focal' })];
	const writes = (session: InstallSession) => vi.spyOn(session.site!.port, 'createField');

	it('does nothing for a caller that brings no proof', async () => {
		const session = await opened(two);
		const created = writes(session);
		await session.apply(null);
		expect(session.run.status).toBe('idle');
		expect(created).not.toHaveBeenCalled();
	});

	it('hands out the proof with the words the dialog shows, and runs on it once', async () => {
		const session = await opened(two);
		const created = writes(session);
		const confirmation = session.askConfirm();
		expect(confirmation?.text).toEqual(session.confirm);
		expect(confirmation?.text.confirmLabel).toBe('Install 2 fields');
		await session.apply(confirmation);
		expect(session.run.status).toBe('finished');
		expect(created).toHaveBeenCalledTimes(2);
	});

	it('hands out none when Install is not on offer', async () => {
		const session = await opened(two);
		session.setAll(false);
		expect(session.askConfirm()).toBeNull();
	});

	it('a tick changed between asking and confirming: nothing is installed, and the screen says why', async () => {
		const warned = vi.spyOn(notify, 'warning').mockImplementation(() => {});
		const session = await opened(two);
		const created = writes(session);
		const confirmation = session.askConfirm();
		session.toggle('e1');
		await session.apply(confirmation);
		expect(session.run.status).toBe('idle');
		expect(created).not.toHaveBeenCalled();
		expect(warned).toHaveBeenCalledWith('The plan changed after you were asked. Nothing was installed. Check the plan, then install again.', undefined, { position: 'top-right' });
	});

	it('a refresh between asking and confirming: nothing is installed', async () => {
		vi.spyOn(notify, 'warning').mockImplementation(() => {});
		const session = await opened(two);
		const created = writes(session);
		const confirmation = session.askConfirm();
		await session.refresh();
		await session.apply(confirmation);
		expect(session.run.status).toBe('idle');
		expect(created).not.toHaveBeenCalled();
	});

	it('a pick in the project picker between asking and confirming: nothing is installed', async () => {
		vi.spyOn(notify, 'warning').mockImplementation(() => {});
		const session = await opened(two);
		const confirmation = session.askConfirm();
		session.choose([{ type: 'Project', id: 70 }]);
		await session.apply(confirmation);
		expect(session.run.status).toBe('idle');
	});

	it('only the proof of the dialog last opened counts, and it is spent by one try', async () => {
		vi.spyOn(notify, 'warning').mockImplementation(() => {});
		const session = await opened(two);
		const created = writes(session);
		const first = session.askConfirm();
		const second = session.askConfirm();
		await session.apply(first);
		expect(session.run.status).toBe('idle');
		// The try spent the pending one too: the dialog has to be opened again.
		await session.apply(second);
		expect(session.run.status).toBe('idle');
		expect(created).not.toHaveBeenCalled();
		await session.apply(session.askConfirm());
		expect(session.run.status).toBe('finished');
	});
});

describe('opening (RUN-1, PLN-1)', () => {
	it('PLN-1: the route asks for the editor\'s selection and none is stored: nothing is planned, and the screen says the selection was lost', async () => {
		const connect = vi.spyOn(installSiteModule, 'installSite');
		const session = await opened([definition(), definition({ programmaticName: 'sg_focal', displayName: 'Focal' })], new URL(`${FAKE.href}&selection=1`));
		expect(session.load).toEqual({ status: 'selection-lost' });
		expect(session.setName).toBe('Lens kit');
		expect(session.entries).toEqual([]);
		expect(session.items).toEqual([]);
		// Never the whole set in its place, and no site is asked for anything.
		expect(connect).not.toHaveBeenCalled();
		expect(session.site).toBeNull();
		expect(session.footer.apply.enabled).toBe(false);
	});

	it('PLN-1: with the selection stored, only those fields are planned, and the context line says so', async () => {
		const items = new Map<string, string>();
		vi.stubGlobal('sessionStorage', { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), removeItem: (key: string) => void items.delete(key) });
		writeInstallSelection('s1', ['e1']);
		const session = await opened([definition(), definition({ programmaticName: 'sg_focal', displayName: 'Focal' })], new URL(`${FAKE.href}&selection=1`));
		expect(session.load).toEqual({ status: 'loaded' });
		expect(session.whole).toBe(false);
		expect(session.items.map((item) => item.programmaticName)).toEqual(['sg_focal']);
		expect(session.context).toBe('1 selected field · fake.shotgrid.autodesk.com');
	});

	it('RUN-1: with no site the screen says why, in the site\'s words, and plans nothing', async () => {
		vi.spyOn(installSiteModule, 'installSite').mockResolvedValueOnce({ ok: false, problem: 'Sign in to the site first.' });
		const session = await opened([definition()], URL_OF_SET);
		expect(session.load).toEqual({ status: 'disconnected', problem: 'Sign in to the site first.' });
		expect(session.items).toEqual([]);

		vi.spyOn(installSiteModule, 'installSite').mockRejectedValueOnce(new TypeError('Failed to fetch'));
		const other = await opened([definition()], URL_OF_SET);
		expect(other.load).toEqual({ status: 'disconnected', problem: 'Failed to fetch' });
	});

	it('a page that went before the set was read does nothing more', async () => {
		const connect = vi.spyOn(installSiteModule, 'installSite');
		store.getSet.mockResolvedValueOnce(stored([definition()]));
		const session = new InstallSession();
		const opening = session.open('s1', FAKE);
		session.dispose();
		await opening;
		expect(connect).not.toHaveBeenCalled();
		expect(session.load).toEqual({ status: 'loading', what: 'set' });
	});
});

describe('a plan that cannot be read (RUN-1, PLN-3)', () => {
	const two = [definition(), definition({ programmaticName: 'sg_focal', displayName: 'Focal' })];

	it('RUN-1: the error shows in place of the plan, never a part of one; "Try again" plans', async () => {
		const session = await opened(two);
		expect(session.items).toHaveLength(2);
		// The second field's read fails: the first one's row must not show alone.
		vi.spyOn(session.site!.reader, 'field')
			.mockImplementationOnce(session.site!.reader.field)
			.mockRejectedValueOnce(Object.assign(new Error('Service Unavailable'), { status: 503 }));
		await session.refresh();
		expect(session.load).toEqual({ status: 'plan-failed', message: 'Service Unavailable' });
		expect(session.items).toEqual([]);
		expect(session.groups).toEqual([]);
		expect(session.refreshing).toBe(false);
		expect(session.footer.apply.enabled).toBe(false);
		expect(session.askConfirm()).toBeNull();
		expect(session.footer.refresh.enabled).toBe(true);

		await session.refresh();
		expect(session.load).toEqual({ status: 'loaded' });
		expect(session.items).toHaveLength(2);
	});

	it('RUN-1: a type list that cannot be read on opening shows the error and no plan', async () => {
		const real = installSiteModule.installSite;
		vi.spyOn(installSiteModule, 'installSite').mockImplementationOnce(async (url) => {
			const result = await real(url);
			if (result.ok) vi.spyOn(result.site.reader, 'entityTypes').mockRejectedValueOnce(new TypeError('Failed to fetch'));
			return result;
		});
		const session = await opened(two);
		expect(session.load).toEqual({ status: 'plan-failed', message: 'Failed to fetch' });
		expect(session.items).toEqual([]);
	});

	it('VIS-3: a project list that cannot be read is no such failure: the plan shows', async () => {
		const real = installSiteModule.installSite;
		vi.spyOn(installSiteModule, 'installSite').mockImplementationOnce(async (url) => {
			const result = await real(url);
			if (result.ok) result.site.loadProjects = async () => ({ status: 'failed', message: 'No.' });
			return result;
		});
		const session = await opened(two);
		expect(session.load).toEqual({ status: 'loaded' });
		expect(session.items).toHaveLength(2);
		expect(session.resolved.eligibleKnown).toBe(false);
	});
});

describe('one run at a time (RUN-6, RUN-25, audit H2)', () => {
	const SLOW = new URL('http://localhost/sets/s1/install?fake&delay=2&faults=0');
	const two = [definition(), definition({ programmaticName: 'sg_focal', displayName: 'Focal' })];

	it('RUN-6: a second Install click and a Refresh during a run do nothing: one create a field, no second plan', async () => {
		const fake = exposeFake();
		const session = await opened(two, SLOW);
		const created = vi.spyOn(session.site!.port, 'createField');
		const first = session.apply(session.askConfirm());
		await started(session);
		const types = vi.spyOn(session.site!.reader, 'entityTypes');
		const typeReads = types.mock.calls.length;

		// Install is not on offer while running: the dialog gets no proof, and a kept one starts nothing.
		expect(session.footer.apply.visible).toBe(false);
		expect(session.askConfirm()).toBeNull();
		await session.apply(null);
		expect(session.footer.refresh.enabled).toBe(false);
		await session.refresh();
		expect(session.run.status).toBe('running');

		await first;
		expect(session.run.status).toBe('finished');
		expect(session.run.rows.map((row) => row.state)).toEqual(['done', 'done']);
		expect(created).toHaveBeenCalledTimes(2);
		expect(fake().writesOverlapped()).toBe(false);
		// The refresh read nothing: no type list beyond the run's own.
		expect(types.mock.calls.length).toBeLessThanOrEqual(typeReads + 1);

		// Install after the run finished: not on offer, nothing written.
		const calls = fake().calls.length;
		expect(session.askConfirm()).toBeNull();
		await session.apply(null);
		expect(fake().calls.length).toBe(calls);
	});

	it('RUN-25: the ticks and the picker are locked while running and after finishing; Refresh unlocks them', async () => {
		const session = await opened(two, SLOW);
		const running = session.apply(session.askConfirm());
		await started(session);
		expect(session.locked).toBe(true);
		session.toggle('e0');
		session.setAll(false);
		session.choose([{ type: 'Project', id: 70 }]);
		expect([...session.ticked]).toEqual(['e0', 'e1']);
		// Nothing was taken note of either, to show up after a refresh.
		expect(session.selection.unticked.size).toBe(0);
		expect(session.chosen).toEqual([]);

		await running;
		expect(session.run.status).toBe('finished');
		expect(session.locked).toBe(true);
		session.toggle('e0');
		session.setAll(false);
		session.choose([{ type: 'Project', id: 70 }]);
		expect([...session.ticked]).toEqual(['e0', 'e1']);
		expect(session.selectAll.state).toBe('all');
		expect(session.selection.unticked.size).toBe(0);
		expect(session.chosen).toEqual([]);

		await session.refresh();
		expect(session.run.status).toBe('idle');
		expect(session.locked).toBe(false);
		// Both fields exist now and are visible everywhere: nothing left to do, so nothing is ticked.
		expect(session.items.map((item) => item.class)).toEqual(['already-matches', 'already-matches']);
		session.choose([{ type: 'Project', id: 70 }]);
		expect(session.chosen).toEqual([{ type: 'Project', id: 70 }]);
	});

	it('RUN-25: before a run the ticks and the picker answer', async () => {
		const session = await opened(two);
		session.toggle('e0');
		expect([...session.ticked]).toEqual(['e1']);
		expect(session.selectAll.state).toBe('some');
		session.setAll(true);
		expect([...session.ticked]).toEqual(['e0', 'e1']);
		session.setAll(false);
		expect(session.ticked.size).toBe(0);
		expect(session.footer.apply.enabled).toBe(false);
	});

	it('RUN-6: only the ticked rows are run, in plan order', async () => {
		const session = await opened([...two, definition({ programmaticName: 'sg_iris', displayName: 'Iris' })]);
		const created = vi.spyOn(session.site!.port, 'createField');
		session.toggle('e1');
		await session.apply(session.askConfirm());
		expect(session.run.rows.map((row) => row.entryId)).toEqual(['e0', 'e2']);
		expect(created.mock.calls.map(([, payload]) => payload.properties[0]?.value)).toEqual(['Lens', 'Iris']);
		// The row left out reads "Not selected" and stays out of the count (RUN-25).
		expect([...session.ticked]).toEqual(['e0', 'e2']);
	});
});

describe('the scope is the one confirmed (VIS-4, RUN-25)', () => {
	const SLOW = new URL('http://localhost/sets/s1/install?fake&delay=2&faults=0');
	const two = [definition(), definition({ programmaticName: 'sg_focal', displayName: 'Focal' })];

	it('VIS-4, RUN-25: the scope is frozen at Install: a cancel, a try at the picker and a resume apply the same one', async () => {
		const fake = exposeFake();
		const session = await opened(two, SLOW);
		session.choose([{ type: 'Project', id: 70 }]);
		expect(session.resolved.scope).toMatchObject({ kind: 'chosen', projects: [{ id: 70 }] });
		afterFirstCreate(session, () => session.cancel());
		await session.apply(session.askConfirm());
		expect(session.run.status).toBe('cancelled');
		expect(session.run.rows.map((row) => row.state)).toEqual(['done', 'pending']);

		// The picker does not answer, so the scope cannot move under the rest of the run.
		session.choose([]);
		session.choose([{ type: 'Project', id: 71 }]);
		expect(session.chosen).toEqual([{ type: 'Project', id: 70 }]);

		expect(session.footer.resume.enabled).toBe(true);
		await session.resume();
		expect(session.run.status).toBe('finished');
		expect(session.run.rows.map((row) => row.state)).toEqual(['done', 'done']);
		// The resumed field is new: visible on the chosen project, hidden on the other eligible ones.
		expect(fake().get('Shot', 'sg_focal')?.hiddenIn).toEqual([71, 72]);
		// The cancel cut the first field's visibility short. Its own retry applies the same scope.
		expect(session.run.rows[0].visibility?.status).toBe('cancelled');
		expect(fake().get('Shot', 'sg_lens')?.hiddenIn).toEqual([]);
		await session.retryVisibility('e0');
		expect(fake().get('Shot', 'sg_lens')?.hiddenIn).toEqual([71, 72]);
	});
});

describe('after a run (RUN-24, RUN-26)', () => {
	const two = [definition(), definition({ programmaticName: 'sg_focal', displayName: 'Focal' })];

	it('RUN-26: the visibility analysis is asked again after a run, with the fields the run made read as existing', async () => {
		const session = await opened(two);
		const analyse = vi.spyOn(session.site!.analyser, 'analyse');
		expect([...session.visibility.values()].map((row) => row.class)).toEqual(['create', 'create']);
		await session.apply(session.askConfirm());
		expect(analyse).toHaveBeenCalledTimes(1);
		expect(analyse.mock.calls[0][0].map((row) => [row.programmaticName, row.class])).toEqual([
			['sg_lens', 'already-matches'],
			['sg_focal', 'already-matches']
		]);
		// The counters follow: read from the site, each field is visible on every project now.
		await vi.waitFor(() => expect(session.analysisState).toBe('loaded'));
		expect([...session.visibility.values()].map((row) => [row.class, row.visible.length, row.toAdd.length])).toEqual([
			['already-matches', 3, 0],
			['already-matches', 3, 0]
		]);
	});

	it('RUN-24: a clean run closes with a success, top right', async () => {
		const done = vi.spyOn(notify, 'success').mockImplementation(() => {});
		const session = await opened(two);
		await session.apply(session.askConfirm());
		expect(done).toHaveBeenCalledExactlyOnceWith('2 applied, 0 skipped.', undefined, { position: 'top-right' });
	});

	it('RUN-16, RUN-19, RUN-24: a refused create fails its row and closes with an error; Retry runs that row alone', async () => {
		const failed = vi.spyOn(notify, 'error').mockImplementation(() => {});
		const done = vi.spyOn(notify, 'success').mockImplementation(() => {});
		// With the fake's faults armed: the first create of "Drive Refused" answers 403.
		const session = await opened([definition(), definition({ programmaticName: 'sg_drive_refused', displayName: 'Drive Refused' })], new URL('http://localhost/sets/s1/install?fake&delay=0'));
		const created = vi.spyOn(session.site!.port, 'createField');
		await session.apply(session.askConfirm());
		expect(session.run.rows.map((row) => row.state)).toEqual(['done', 'failed']);
		expect(failed).toHaveBeenCalledExactlyOnceWith('1 applied, 0 skipped, 1 failed.', undefined, { position: 'top-right' });
		expect(session.footer).toMatchObject({ retry: { enabled: true, label: 'Retry 1 failed' }, primary: 'retry' });

		await session.retry();
		expect(session.run.rows.map((row) => row.state)).toEqual(['done', 'done']);
		expect(created.mock.calls.map(([, payload]) => payload.properties[0]?.value)).toEqual(['Lens', 'Drive Refused', 'Drive Refused']);
		expect(done).toHaveBeenLastCalledWith('2 applied, 0 skipped.', undefined, { position: 'top-right' });
		expect(session.footer.retry.visible).toBe(false);
	});

	it('VIS-7, RUN-24: a visibility write that fails warns, and the row\'s own retry applies it', async () => {
		const warned = vi.spyOn(notify, 'warning').mockImplementation(() => {});
		const done = vi.spyOn(notify, 'success').mockImplementation(() => {});
		// The fake seeds `sg_drive_match` live and hidden in project 71; its first visibility write fails.
		const session = await opened([definition({ programmaticName: 'sg_drive_match', displayName: 'Drive Match' })], new URL('http://localhost/sets/s1/install?fake&delay=0'));
		await vi.waitFor(() => expect(session.analysisState).toBe('loaded'));
		await session.apply(session.askConfirm());
		expect(session.run.rows[0]).toMatchObject({ state: 'skipped', visibility: { failures: [{ projectId: 71 }] } });
		expect(warned).toHaveBeenCalledExactlyOnceWith('0 applied, 1 skipped. Visibility is incomplete on 1 field.', undefined, { position: 'top-right' });

		await session.retryVisibility('e0');
		expect(session.run.rows[0].visibility).toMatchObject({ failures: [], status: 'applied' });
		expect(done).toHaveBeenCalledTimes(1);
	});

	it('RUN-18, RUN-24: a cancel closes with a warning; nothing more is written until Resume', async () => {
		const warned = vi.spyOn(notify, 'warning').mockImplementation(() => {});
		const session = await opened(two, new URL('http://localhost/sets/s1/install?fake&delay=2&faults=0'));
		let footerWhileCancelling: unknown;
		const created = afterFirstCreate(session, () => {
			session.cancel();
			footerWhileCancelling = session.footer.cancel;
		});
		await session.apply(session.askConfirm());
		expect(footerWhileCancelling).toMatchObject({ enabled: false, label: 'Cancelling…' });
		expect(session.run.rows.map((row) => row.state)).toEqual(['done', 'pending']);
		expect(created).toHaveBeenCalledTimes(1);
		// The cancel landed before the first field's visibility: the field is made, its visibility is not.
		expect(warned).toHaveBeenCalledExactlyOnceWith('Install cancelled. 1 applied, 0 skipped, 1 not started. Visibility is incomplete on 1 field.', undefined, {
			position: 'top-right'
		});
		// Retry has nothing to retry, and does nothing.
		await session.retry();
		expect(created).toHaveBeenCalledTimes(1);
	});

	it('RUN-20: the report is offered once the run changed something, and is named after the set and the day', async () => {
		const session = await opened(two);
		expect(session.footer.report.visible).toBe(false);
		await session.apply(session.askConfirm());
		expect(session.footer.report).toMatchObject({ visible: true, enabled: true });
		session.downloadReport();
		const [name, text, type] = download.downloadText.mock.calls[0];
		expect(name).toMatch(/^install-report-lens-kit-\d{4}-\d{2}-\d{2}\.txt$/);
		expect(text).toContain('fake.shotgrid.autodesk.com');
		expect(text).toContain('sg_lens');
		expect(type).toBe('text/plain');
	});
});

describe('leaving mid-run (RUN-18)', () => {
	const SLOW = new URL('http://localhost/sets/s1/install?fake&delay=2&faults=0');
	const two = [definition(), definition({ programmaticName: 'sg_focal', displayName: 'Focal' })];

	it('RUN-18: a page that goes mid-run asks the run to stop after the step in flight: the rest is not written, and nothing is announced', async () => {
		const toasts = [vi.spyOn(notify, 'success'), vi.spyOn(notify, 'warning'), vi.spyOn(notify, 'error')].map((spy) => spy.mockImplementation(() => {}));
		const session = await opened(two, SLOW);
		const analyse = vi.spyOn(session.site!.analyser, 'analyse');
		let seen: unknown;
		const created = afterFirstCreate(session, () => {
			session.dispose();
			seen = session.run;
		});
		await session.apply(session.askConfirm());
		// The field in flight was finished; the second was never started.
		expect(created).toHaveBeenCalledTimes(1);
		// The screen is gone: its state stops moving, no toast, no new analysis.
		expect(session.run).toBe(seen);
		for (const toast of toasts) expect(toast).not.toHaveBeenCalled();
		expect(analyse).not.toHaveBeenCalled();
	});
});
