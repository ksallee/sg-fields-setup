/**
 * Which site the app is connected to, and how the navbar names it.
 *
 * One site at a time (OVR-7). A session is only kept for the site the person named, so the
 * session's site and the named one agree. The dev key's site stands in only while nobody is
 * signed in. With none of the three, there is no site: nothing is picked for the person (B10).
 */
export interface SiteSources {
	/** The site the person named on the connect page, or ''. */
	named: string;
	/** The site of the stored session, if any. */
	sessionSite: string | null;
	/** The site `/live/dev-token` answered for, in `vite dev` only. */
	devSite: string | null;
}

export function connectedSite({ named, sessionSite, devSite }: SiteSources): string {
	return sessionSite ?? devSite ?? named;
}

/** The site as the navbar names it: the studio, without the suffix every Flow PT host carries. */
export function shortHost(siteUrl: string): string {
	try {
		return new URL(siteUrl).hostname.replace(/^www\./, '').replace(/\.(?:shotgrid\.autodesk\.com|shotgunstudio\.com)$/, '');
	} catch {
		return siteUrl;
	}
}
