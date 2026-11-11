/**
 * Deleting a set, from the list and from the editor (SET-22 to SET-24, EDT-8): the question, the
 * "do not ask again" preference, the delete, what the screen is told. One flow for both screens,
 * so they cannot differ.
 *
 *     const deleting = new DeleteSet((target) => leave(HOME_PATH));
 *     void deleting.loadPreference();
 *     deleting.ask({ id, name, entryCount });       // the dialog, or the delete at once
 *     <ConfirmDialog bind:open={deleting.open} message={deleting.question} busy={deleting.busy}
 *         error={deleting.error} onconfirm={({ remember }) => deleting.confirm(remember)} … />
 *
 * Order, the same on every path: the set is deleted; the dialog closes; the preference is
 * stored, only now that the delete has succeeded; the toast; `ondeleted`. A failed delete stores
 * nothing and announces nothing.
 */
import { errorMessage, notify } from '$lib/app/toast';
import { sharedSetStore } from '$lib/io/set-store';
import { deletedText, deleteQuestion, failedTitle } from '$lib/pure/set-text';

/** The set to delete, as the question names it. */
export interface DeleteTarget {
	id: string;
	name: string;
	entryCount: number;
}

export class DeleteSet<T extends DeleteTarget = DeleteTarget> {
	/** "Do not ask again" is remembered: a delete goes at once (SET-22). */
	skipConfirm = $state(false);
	/** The confirmation is showing. */
	open = $state(false);
	/** A confirmed delete is on its way: the dialog cannot be dismissed or confirmed again. */
	busy = $state(false);
	/** Why the confirmed delete failed, for the dialog. */
	error = $state<string | null>(null);
	/** The set the dialog is about. */
	target = $state.raw<T | null>(null);
	/** The sets being deleted right now, by id: a row's actions wait, and a second click does nothing. */
	inFlight = $state.raw<ReadonlySet<string>>(new Set());

	readonly question: string = $derived(this.target ? deleteQuestion(this.target.name, this.target.entryCount) : '');

	readonly #ondeleted: (target: T) => void | Promise<void>;

	/** `ondeleted` runs once the set is gone: the list drops the row, the editor leaves. */
	constructor(ondeleted: (target: T) => void | Promise<void>) {
		this.#ondeleted = ondeleted;
	}

	/** Reads the remembered preference. A store that cannot answer leaves it off: the screen asks. */
	async loadPreference(): Promise<void> {
		try {
			this.skipConfirm = (await (await sharedSetStore()).getPreferences()).skipDeleteSetConfirm;
		} catch {
			/* Asking once more is the safe side. */
		}
	}

	/** Delete was clicked: the question, or the delete at once when the person said not to ask. */
	async ask(target: T): Promise<void> {
		if (this.inFlight.has(target.id)) return;
		if (!this.skipConfirm) {
			this.target = target;
			this.error = null;
			this.open = true;
			return;
		}
		try {
			await this.#remove(target, false);
		} catch (error) {
			notify.error(error, failedTitle('delete'));
		}
	}

	/** The dialog's confirm. A failure shows in the dialog, which stays open. */
	async confirm(remember: boolean): Promise<void> {
		const target = this.target;
		if (!target || this.busy) return;
		this.busy = true;
		this.error = null;
		try {
			await this.#remove(target, remember);
		} catch (error) {
			this.error = errorMessage(error);
		} finally {
			this.busy = false;
		}
	}

	async #remove(target: T, remember: boolean): Promise<void> {
		if (this.inFlight.has(target.id)) return;
		this.inFlight = new Set(this.inFlight).add(target.id);
		try {
			const store = await sharedSetStore();
			await store.deleteSet(target.id);
			this.open = false;
			if (remember) {
				this.skipConfirm = true;
				// The set is gone either way; a preference that did not stick only means one more question.
				await store.setPreference('skipDeleteSetConfirm', true).catch(() => {});
			}
			notify.success(deletedText(target.name));
			await this.#ondeleted(target);
		} finally {
			const next = new Set(this.inFlight);
			next.delete(target.id);
			this.inFlight = next;
		}
	}
}
