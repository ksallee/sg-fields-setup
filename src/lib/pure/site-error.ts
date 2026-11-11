/**
 * What a failed site call says, as one sentence to show (docs/design.md, Toasts).
 *
 * The one reader of a thrown site error. A refusal from Flow PT carries its reply: the first
 * error's `detail` says which name is wrong, and its `title` is the short form (corpus
 * `findings/002`, `findings/028`). Those are the site's own words and they show as they are.
 * A thrown value with no reply shows its message. Nothing said gives the fallback.
 *
 * Not for the set store: its errors go through `errorMessage` in `$lib/app/toast`, which never
 * shows a raw error text.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function said(value: unknown): string | null {
	return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function firstError(body: unknown): Record<string, unknown> | null {
	const errors = isRecord(body) ? body['errors'] : null;
	const first: unknown = Array.isArray(errors) ? errors[0] : null;
	return isRecord(first) ? first : null;
}

/** The first error's `detail` in a reply body, or null when it has none. */
export function siteErrorDetail(body: unknown): string | null {
	return said(firstError(body)?.['detail']);
}

/**
 * The sentence for a failed site call: the server's words when the error carries its reply (the
 * first error's `detail`, else its `title`), else the error's own message, else `fallback`.
 */
export function siteErrorMessage(error: unknown, fallback = 'Unknown error.'): string {
	if (isRecord(error)) {
		const first = firstError(error['body']);
		const fromReply = said(first?.['detail']) ?? said(first?.['title']);
		if (fromReply !== null) return fromReply;
		const message = said(error['message']);
		if (message !== null) return message;
	}
	return said(error) ?? fallback;
}
