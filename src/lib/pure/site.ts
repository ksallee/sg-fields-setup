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

/** What the app holds of its connection, as far as these words need it. `LiveState` of `$lib/live` fits. */
export interface SiteState {
	siteUrl: string;
	session: { login: string } | null;
	devToken: boolean;
	problem: string | null;
}

/** The site can be read: one is named and nothing stands in the way (CMP-3, IMP-52, SET-25). */
export function isConnected(state: Pick<SiteState, 'siteUrl' | 'problem'>): boolean {
	return state.siteUrl !== '' && state.problem === null;
}

/**
 * What to say where a site is needed and none can be read, or null when one can. Sets need no
 * site; comparing and installing do (CMP-3, OVR-7).
 */
export function connectNudge(state: Pick<SiteState, 'siteUrl' | 'problem'>): { title: string; text: string; action: string } | null {
	if (isConnected(state)) return null;
	const text = 'Sets work without a site. Connect to compare a set with your site and install it.';
	return state.siteUrl === '' ? { title: 'No site connected.', text, action: 'Connect a site' } : { title: 'Not signed in.', text, action: 'Sign in' };
}

/** Who reads the site: the signed-in person over the dev key, else the dev key, else nobody. */
export function siteWho(state: Pick<SiteState, 'session' | 'devToken'>): { kind: 'person' | 'dev-key' | 'nobody'; text: string } {
	if (state.session) return { kind: 'person', text: state.session.login };
	return state.devToken ? { kind: 'dev-key', text: 'Dev key' } : { kind: 'nobody', text: 'Not signed in' };
}

/** The hover text of the navbar's site link: the whole address and who reads it, or the way to connect. */
export function siteTitle(state: Pick<SiteState, 'siteUrl' | 'session' | 'devToken'>): string {
	if (state.siteUrl === '') return 'Connect a site';
	const who = siteWho(state);
	return who.kind === 'nobody' ? state.siteUrl : `${state.siteUrl} · ${who.kind === 'person' ? who.text : 'dev key'}`;
}
