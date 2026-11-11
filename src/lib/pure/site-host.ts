/**
 * Which address counts as a Flow PT site.
 *
 * The launcher endpoints under `/live/` forward to the site a caller names, with no login in
 * front of them. Held to this rule they reach Flow PT hosts and nothing else. The browser
 * holds the address it stores to the same rule, and the Content Security Policy's
 * `connect-src` is built from the same lists (`vite.config.ts`).
 *
 * A site is an https origin with no user name, no password and no port of its own, on one of
 * the two domains Flow PT sites live on, or under an extra suffix the deployment names in
 * `FPT_EXTRA_SITE_SUFFIXES`.
 */

/** The two domains Flow PT sites live on. A site is a name under one of them. */
export const KNOWN_SITE_SUFFIXES: readonly string[] = ['.shotgrid.autodesk.com', '.shotgunstudio.com'];

export type SiteRefusal = 'missing' | 'not-url' | 'not-https' | 'userinfo' | 'port' | 'host';

export type SiteCheck = { ok: true; origin: string } | { ok: false; reason: SiteRefusal };

export interface SiteCheckOptions {
	/** Extra host suffixes, as `extraSuffixes` reads them. A host may be the suffix or under it. */
	extraSuffixes?: readonly string[];
	/** Skip the host rule alone. For the browser, which leaves that refusal to the server. */
	anyHost?: boolean;
}

const refuse = (reason: SiteRefusal): SiteCheck => ({ ok: false, reason });

function hostAllowed(host: string, extra: readonly string[]): boolean {
	if (KNOWN_SITE_SUFFIXES.some((suffix) => host.length > suffix.length && host.endsWith(suffix))) return true;
	return extra.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** The site's origin, or why the address is refused. */
export function checkSite(value: unknown, options: SiteCheckOptions = {}): SiteCheck {
	if (typeof value !== 'string' || value.trim() === '') return refuse('missing');
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		return refuse('not-url');
	}
	if (url.protocol !== 'https:') return refuse('not-https');
	if (url.username !== '' || url.password !== '') return refuse('userinfo');
	if (url.port !== '') return refuse('port');
	if (url.hostname === '') return refuse('not-url');
	if (!options.anyHost && !hostAllowed(url.hostname, options.extraSuffixes ?? [])) return refuse('host');
	return { ok: true, origin: url.origin };
}

/** One host label: letters, digits and inner hyphens. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * The extra suffixes of `FPT_EXTRA_SITE_SUFFIXES`: comma-separated host names, such as
 * `flow.example.com`. An entry that is no plain host name of two labels or more is dropped,
 * so a typo allows nothing rather than everything.
 */
export function extraSuffixes(raw: string | undefined): string[] {
	if (!raw) return [];
	const found: string[] = [];
	for (const part of raw.split(',')) {
		const entry = part.trim().toLowerCase().replace(/^\./, '');
		const labels = entry.split('.');
		if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) continue;
		// A name whose last label is digits is an address, and an address is no site.
		if (/^\d+$/.test(labels[labels.length - 1])) continue;
		if (!found.includes(entry)) found.push(entry);
	}
	return found;
}

/**
 * The approval page the launcher answered, if it is https on the site itself. Anything else
 * is null: the page is opened in the person's browser, so it is never taken on trust.
 */
export function approvalUrl(url: unknown, siteOrigin: string): string | null {
	if (typeof url !== 'string' || url === '') return null;
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') return null;
	return parsed.origin === siteOrigin ? parsed.href : null;
}

/** The hosts the browser may call, as `connect-src` sources: the same lists `checkSite` reads. */
export function connectSources(extra: readonly string[]): string[] {
	return [
		...KNOWN_SITE_SUFFIXES.map((suffix) => `https://*${suffix}`),
		...extra.flatMap((suffix) => [`https://${suffix}`, `https://*.${suffix}`])
	];
}

const REFUSALS: Record<SiteRefusal, string> = {
	missing: 'Name the site.',
	'not-url': 'That is no site address. Write it as https://studio.shotgrid.autodesk.com.',
	'not-https': 'The site address must start with https://.',
	userinfo: 'The site address must carry no user name and no password.',
	port: 'The site address must carry no port.',
	host: 'Only Flow PT sites are accepted: a name ending .shotgrid.autodesk.com or .shotgunstudio.com.'
};

export function siteRefusalText(reason: SiteRefusal): string {
	return REFUSALS[reason];
}
