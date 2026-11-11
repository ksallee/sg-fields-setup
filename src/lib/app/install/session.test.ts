/**
 * The install session against a store that fails. The session is wiring: these tests hold the
 * seams a pure test cannot reach.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ getSet: vi.fn() }));

vi.mock('$lib/io/set-store', async (original) => ({
	...(await original<typeof import('$lib/io/set-store')>()),
	sharedSetStore: async () => store
}));

import { SetStoreError } from '$lib/io/set-store';
import { InstallSession } from './session.svelte';

const URL_OF_SET = new URL('http://localhost/sets/s1/install');

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
