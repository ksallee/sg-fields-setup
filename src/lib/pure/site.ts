/**
 * Which site the app is connected to. `siteHost` in `site-host.ts` names it.
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
