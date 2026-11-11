/**
 * Notifications (docs/design.md). One place, so every screen words and times them the same way.
 * The `<Toaster>` is in the root layout.
 *
 *     notify.success('Created "Lens".');
 *     notify.error(error);                       // a thrown SetStoreError, or any message
 *     notify.error('This file is not a set file.', 'Could not import lens.json');
 */
import { toast } from 'svelte-sonner';
import { SetStoreError } from '$lib/io/set-store';

const FALLBACK = 'Something went wrong. Try again.';

/**
 * The sentence to show for a failure: a text as it is, a `SetStoreError`'s own message (already
 * plain). Any other error is logged and shown as a plain fallback, never raw (MOD-2).
 */
export function errorMessage(error: unknown, fallback = FALLBACK): string {
	if (typeof error === 'string') return error;
	if (error instanceof SetStoreError) return error.message;
	console.error(error);
	return fallback;
}

/** Where a toast shows when it is not the layout's bottom right: a screen with a footer bar keeps its actions clear. */
export interface NotifyOptions {
	position?: 'top-right';
}

export const notify = {
	/** A thing was done. Past tense, the same verb as the button. */
	success(message: string, description?: string, options: NotifyOptions = {}): void {
		toast.success(message, { description, ...options });
	},
	/** A thing failed. Stays longer, so it can be read. `title` goes over the message. */
	error(error: unknown, title?: string, options: NotifyOptions = {}): void {
		const message = errorMessage(error);
		if (title) toast.error(title, { description: message, duration: 10_000, ...options });
		else toast.error(message, { duration: 10_000, ...options });
	},
	/** A thing was done and found nothing, or only part of it. Stays as long as a failure. */
	warning(message: string, description?: string, options: NotifyOptions = {}): void {
		toast.warning(message, { description, duration: 10_000, ...options });
	},
	/** Something to know that is neither. */
	info(message: string, description?: string, options: NotifyOptions = {}): void {
		toast(message, { description, ...options });
	}
};
