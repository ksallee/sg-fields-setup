/**
 * The security headers on everything the server answers: pages and the `/live/` endpoints
 * (`$lib/pure/security-headers`). A page keeps the Content Security Policy SvelteKit gave it,
 * with its nonce. Anything else gets one that loads nothing and cannot be framed.
 *
 * The shell also gets the head tags for its path (`$lib/pure/seo`): the app renders in the
 * browser only, and a link preview never runs it.
 */
import type { Handle } from '@sveltejs/kit';
import { headFor } from './lib/pure/seo';
import { ENDPOINT_CSP, STATIC_SECURITY_HEADERS } from './lib/pure/security-headers';

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event, { transformPageChunk: ({ html }) => html.replace('%seo.head%', headFor(event.url.pathname)) });
	for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) response.headers.set(name, value);
	if (!response.headers.has('content-security-policy')) response.headers.set('content-security-policy', ENDPOINT_CSP);
	return response;
};
