/**
 * The security headers on everything the server answers: pages and the `/live/` endpoints
 * (`$lib/pure/security-headers`). A page keeps the Content Security Policy SvelteKit gave it,
 * with its nonce. Anything else gets one that loads nothing and cannot be framed.
 */
import type { Handle } from '@sveltejs/kit';
import { ENDPOINT_CSP, STATIC_SECURITY_HEADERS } from './lib/pure/security-headers';

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) response.headers.set(name, value);
	if (!response.headers.has('content-security-policy')) response.headers.set('content-security-policy', ENDPOINT_CSP);
	return response;
};
