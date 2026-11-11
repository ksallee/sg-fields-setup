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

import { SetStoreError } from '$lib/io/set-store';
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

afterEach(() => vi.restoreAllMocks());

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
