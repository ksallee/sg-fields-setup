/**
 * The security headers, in one place (B2 of the security audit).
 *
 * - `cspDirectives` is the page's Content Security Policy, as SvelteKit's `csp.directives` takes
 *   it (`vite.config.ts`). SvelteKit adds a nonce to `script-src` per response, and the theme
 *   script in `app.html` carries it.
 * - `STATIC_SECURITY_HEADERS` go on every response: `vercel.json` sets them on every path, and
 *   `hooks.server.ts` on what the server answers, so `vite preview` and any other host have them.
 * - `ENDPOINT_CSP` is the policy of an answer that is no page: the `/live/` endpoints.
 */
import { connectSources } from './site-host.ts';

/**
 * The page's policy. `extraSuffixes` is `extraSuffixes(FPT_EXTRA_SITE_SUFFIXES)`: the hosts the
 * browser may call are the hosts the `/live/` endpoints accept.
 *
 * Styles allow `'unsafe-inline'`: bits-ui, sonner, the virtual list and the widgets position
 * themselves with `style` attributes, and SvelteKit's shell has one. Scripts do not.
 * Images allow `https:`: thumbnails and avatars come from the site's storage, on other hosts.
 */
export function cspDirectives(extraSuffixes: readonly string[]): Record<string, string[]> {
	return {
		'default-src': ['self'],
		'script-src': ['self'],
		'style-src': ['self', 'unsafe-inline'],
		'img-src': ['self', 'data:', 'https:'],
		'font-src': ['self'],
		'connect-src': ['self', ...connectSources(extraSuffixes)],
		'object-src': ['none'],
		'base-uri': ['self'],
		'form-action': ['self'],
		'frame-ancestors': ['none']
	};
}

export const STATIC_SECURITY_HEADERS: Readonly<Record<string, string>> = {
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'no-referrer',
	'X-Frame-Options': 'DENY'
};

export const ENDPOINT_CSP = "default-src 'none'; frame-ancestors 'none'";
