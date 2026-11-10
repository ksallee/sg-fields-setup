/**
 * Shared bits of the two launcher endpoints. Neither holds state.
 *
 * `/api/v1` answers an OPTIONS preflight with the request origin echoed and
 * credentials allowed, so the browser calls the REST API itself. The App
 * Session Launcher lives outside `/api/v1` and answers no CORS headers at all
 * (probe 062), so its two calls are the only ones that need this server.
 */
import { json } from '@sveltejs/kit';

/** The one path either endpoint appends to the site a caller names. */
export const launcherBase = '/internal_api/app_session_request';

export function badRequest(message: string): Response {
	return json({ message }, { status: 400 });
}

export function forwardFailed(error: unknown): Response {
	return json({ message: error instanceof Error ? error.message : String(error) }, { status: 502 });
}

/**
 * The site root to forward to, or the 400 to answer instead. Https only: the
 * session token the launcher hands back is a credential for the person who
 * approved.
 */
export function siteFromBody(value: unknown): string | Response {
	if (typeof value !== 'string' || value.trim() === '') return badRequest("'siteUrl' is required.");
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		return badRequest("'siteUrl' must be a URL.");
	}
	if (url.protocol !== 'https:') return badRequest("'siteUrl' must be https.");
	return url.origin;
}

export async function bodyOf(request: Request): Promise<Record<string, unknown> | Response> {
	try {
		const body: unknown = await request.json();
		return (body ?? {}) as Record<string, unknown>;
	} catch {
		return badRequest('Body must be a JSON object.');
	}
}
