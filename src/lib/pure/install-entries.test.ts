import { describe, expect, it } from 'vitest';
import { installEntries, SELECTION_LOST } from './install-entries';

const ENTRIES = [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }];

describe('installEntries (PLN-1, EDT-10)', () => {
	it('PLN-1: with no selection asked for, the whole set is planned, whatever is stored', () => {
		expect(installEntries(ENTRIES, false, null)).toEqual({ kind: 'whole', entries: ENTRIES });
		expect(installEntries(ENTRIES, false, ['e2'])).toEqual({ kind: 'whole', entries: ENTRIES });
		expect(installEntries([], false, null)).toEqual({ kind: 'whole', entries: [] });
	});

	it('PLN-1: a selection is its entries, in the order of the set', () => {
		expect(installEntries(ENTRIES, true, ['e3', 'e1'])).toEqual({ kind: 'selection', entries: [{ id: 'e1' }, { id: 'e3' }] });
		// An id the set no longer holds is left out.
		expect(installEntries(ENTRIES, true, ['e2', 'gone'])).toEqual({ kind: 'selection', entries: [{ id: 'e2' }] });
	});

	it('PLN-1: a selection asked for and not stored is lost: it never widens to the whole set', () => {
		// A new tab, a cleared storage, a link pasted elsewhere.
		expect(installEntries(ENTRIES, true, null)).toEqual({ kind: 'selection-lost' });
		expect(installEntries(ENTRIES, true, [])).toEqual({ kind: 'selection-lost' });
		// Every selected field was deleted since: nothing of the selection is left to plan.
		expect(installEntries(ENTRIES, true, ['gone'])).toEqual({ kind: 'selection-lost' });
		expect(installEntries([], true, null)).toEqual({ kind: 'selection-lost' });
	});

	it('never alters what it is given', () => {
		const entries = [...ENTRIES];
		const ids = ['e3', 'e1'];
		installEntries(entries, true, ids);
		expect(entries).toEqual(ENTRIES);
		expect(ids).toEqual(['e3', 'e1']);
	});

	it('says so plainly', () => {
		expect(`${SELECTION_LOST.title}. ${SELECTION_LOST.line}`).toBe('The selection was lost. Go back to the set and choose the fields again.');
	});
});
