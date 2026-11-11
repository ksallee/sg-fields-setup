import { describe, expect, it } from 'vitest';
import { CONFIRM_CHANGED_TEXT, mintConfirmation, redeemConfirmation, type ConfirmSubject } from './install-confirm';

function subject(more: Partial<ConfirmSubject> = {}): ConfirmSubject {
	return {
		planSerial: 1,
		entryIds: ['a', 'b'],
		scope: { kind: 'all-eligible', projectIds: [70, 71] },
		text: { title: 'Install on example.shotgrid.autodesk.com?', lines: ['This creates 2 fields on https://example.shotgrid.autodesk.com.', 'There is no undo.'], confirmLabel: 'Install 2 fields' },
		...more
	};
}

describe('the proof that the person confirmed (RUN-5, audit finding 15)', () => {
	it('carries the words the dialog shows', () => {
		const confirmation = mintConfirmation(subject());
		expect(confirmation.text).toEqual(subject().text);
	});

	it('holds for the plan, the rows and the scope it was given for', () => {
		const confirmation = mintConfirmation(subject());
		expect(redeemConfirmation(confirmation, confirmation, subject())).toBe('confirmed');
	});

	it('is needed: no proof, no install', () => {
		const confirmation = mintConfirmation(subject());
		expect(redeemConfirmation(confirmation, null, subject())).toBe('missing');
		expect(redeemConfirmation(null, null, subject())).toBe('missing');
	});

	it('must be the one the dialog was last opened with: an older or a made-up one does not count', () => {
		const older = mintConfirmation(subject());
		const current = mintConfirmation(subject());
		expect(redeemConfirmation(current, older, subject())).toBe('not-current');
		expect(redeemConfirmation(null, older, subject())).toBe('not-current');
		// The same content is not the same proof: a caller cannot build one.
		expect(redeemConfirmation(current, { ...current }, subject())).toBe('not-current');
	});

	it('a refresh between asking and confirming invalidates it, even when the new plan reads the same', () => {
		const confirmation = mintConfirmation(subject());
		expect(redeemConfirmation(confirmation, confirmation, subject({ planSerial: 2 }))).toBe('changed');
	});

	it('a change of the ticked rows invalidates it', () => {
		const confirmation = mintConfirmation(subject());
		expect(redeemConfirmation(confirmation, confirmation, subject({ entryIds: ['a'] }))).toBe('changed');
		expect(redeemConfirmation(confirmation, confirmation, subject({ entryIds: ['a', 'c'] }))).toBe('changed');
		expect(redeemConfirmation(confirmation, confirmation, subject({ entryIds: ['b', 'a'] }))).toBe('changed');
	});

	it('a change of the visibility scope invalidates it', () => {
		const confirmation = mintConfirmation(subject());
		expect(redeemConfirmation(confirmation, confirmation, subject({ scope: { kind: 'chosen', projectIds: [70, 71] } }))).toBe('changed');
		expect(redeemConfirmation(confirmation, confirmation, subject({ scope: { kind: 'all-eligible', projectIds: [70] } }))).toBe('changed');
	});

	it('a change of what the dialog would say invalidates it: the person confirmed other words', () => {
		const confirmation = mintConfirmation(subject());
		const text = { ...subject().text, lines: ['This creates 2 fields on https://example.shotgrid.autodesk.com.', 'Visibility: 12 visibility changes.', 'There is no undo.'] };
		expect(redeemConfirmation(confirmation, confirmation, subject({ text }))).toBe('changed');
	});

	it('is not fooled by ids that run into each other', () => {
		const confirmation = mintConfirmation(subject({ entryIds: ['a', 'b'] }));
		expect(redeemConfirmation(confirmation, confirmation, subject({ entryIds: ['a,b'] }))).toBe('changed');
		expect(redeemConfirmation(confirmation, confirmation, subject({ entryIds: ['a"', 'b'] }))).toBe('changed');
	});

	it('does not follow the subject it was made from when that is changed later', () => {
		const given = subject();
		const confirmation = mintConfirmation(given);
		(given.entryIds as string[]).push('c');
		expect(redeemConfirmation(confirmation, confirmation, subject())).toBe('confirmed');
		expect(confirmation.text.lines).toEqual(subject().text.lines);
	});

	it('has words for a confirmation that no longer holds', () => {
		expect(CONFIRM_CHANGED_TEXT).toBe('The plan changed after you were asked. Nothing was installed. Check the plan, then install again.');
	});
});
