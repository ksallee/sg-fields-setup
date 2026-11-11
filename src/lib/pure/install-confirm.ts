/**
 * The proof that the person confirmed an install (docs/design.md, "First write"; audit finding
 * 15). An install writes to a site and cannot be undone, so the session does not start one on a
 * caller's word: it asks for the proof it handed out when the dialog opened.
 *
 * The rule, all of it:
 *
 * 1. Opening the dialog mints one confirmation for a subject: which plan (its serial, which moves
 *    with every plan read from the site), which rows are ticked, in plan order, the visibility
 *    scope, and the words the dialog shows. The dialog shows the words the confirmation carries.
 * 2. Starting the run redeems it. It must be the very object last minted, so an older one, a copy
 *    or one built by hand does not count. And the subject must still be what it was minted for: a
 *    refresh, a tick, a pick in the project picker or an analysis that lands and changes the
 *    counts all make it `changed`. Confirming one plan never applies another.
 * 3. Redeeming spends it, whatever the verdict. The caller drops the pending one.
 *
 * Retry and resume ask for none: they run the rows and the scope already confirmed, which are
 * locked from the first run until a refresh (RUN-25).
 */
import type { ConfirmText } from './install-text';

/** What a confirmation is given for. */
export interface ConfirmSubject {
	/** Which plan: a number that moves every time a plan is read from the site. */
	planSerial: number;
	/** The ticked rows, in plan order: what the run will take. */
	entryIds: readonly string[];
	/** The visibility scope as it stands (VIS-2). */
	scope: { kind: 'all-eligible' | 'chosen'; projectIds: readonly number[] };
	/** What the dialog says. */
	text: ConfirmText;
}

/** The proof. Made by `mintConfirmation` only: its identity is what counts. */
export interface Confirmation {
	/** The words to show in the dialog: the ones this confirmation is for. */
	readonly text: ConfirmText;
	/** The subject, as one text. Compared, never parsed. */
	readonly fingerprint: string;
}

export type Redeemed =
	/** The proof is the pending one and the subject is the same: start the run. */
	| 'confirmed'
	/** No proof was offered. */
	| 'missing'
	/** A proof was offered and it is not the pending one. */
	| 'not-current'
	/** The plan, the ticks, the scope or the words changed after the dialog opened. */
	| 'changed';

/** Said when the confirmation no longer holds. */
export const CONFIRM_CHANGED_TEXT = 'The plan changed after you were asked. Nothing was installed. Check the plan, then install again.';

function fingerprint(subject: ConfirmSubject): string {
	return JSON.stringify([
		subject.planSerial,
		[...subject.entryIds],
		subject.scope.kind,
		[...subject.scope.projectIds],
		subject.text.title,
		[...subject.text.lines],
		subject.text.confirmLabel
	]);
}

/** A confirmation for this subject. Call when the dialog opens. */
export function mintConfirmation(subject: ConfirmSubject): Confirmation {
	const text: ConfirmText = { title: subject.text.title, lines: [...subject.text.lines], confirmLabel: subject.text.confirmLabel };
	return Object.freeze({ text, fingerprint: fingerprint(subject) });
}

/**
 * Whether `offered` lets a run start now. `pending` is the confirmation last minted and not yet
 * spent, or null. `subject` is the plan, ticks, scope and words as they stand at this moment.
 */
export function redeemConfirmation(pending: Confirmation | null, offered: Confirmation | null, subject: ConfirmSubject): Redeemed {
	if (offered === null) return 'missing';
	if (pending === null || offered !== pending) return 'not-current';
	return offered.fingerprint === fingerprint(subject) ? 'confirmed' : 'changed';
}
