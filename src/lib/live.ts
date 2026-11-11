/**
 * The site this app reads, and the person reading it.
 *
 * There is no mock: the page reads a real Flow PT site or it says why it
 * cannot. The browser calls `/api/v1` itself, since every path there answers a
 * preflight with the request origin echoed and credentials allowed (probe 062),
 * and a request header outside `authorization,content-type` drops every CORS
 * header, so browser calls carry nothing but what `RestClient` already sends.
 *
 * The bearer comes from one of two places. A session token the person approved
 * through the App Session Launcher (probe 052), kept in `localStorage`, is the
 * first choice: it is a credential for that person and never leaves this browser,
 * since the launcher's two calls go through this app's own endpoints under
 * `/live/`, which hold nothing. Failing that, in `vite dev`, `/live/dev-token`
 * mints one from the script key in `.env.local`, so local QA needs no login; that
 * endpoint is 404 in a production build. A person can sign in over the dev key,
 * and everything they write is then theirs, not the script's.
 *
 * One site at a time (OVR-7). The site is the one the person named on the
 * connect page, or in `vite dev` the one `.env.local` names. The build's
 * `PUBLIC_FPT_SITE_URL` only fills the connect form; it never becomes the site on
 * its own (B10).
 *
 * Adapted from sg-task-templates' `src/lib/live.ts`, without the project pick.
 */
import { dev } from '$app/environment';
import { env } from '$env/dynamic/public';
import { coreSchemaSource } from '$lib/io/core-schema-source';
import { createLiveSchema, type LiveSchema } from '$lib/io/schema';
import { connectedSite } from '$lib/pure/site';
import { createSessionTokenAuth, createSgContext, RestClient, type EntityRow, type RestClientOptions, type SgContext } from 'sg-widgets-core';

const KEYS = {
	site: 'sg-fields-setup:site',
	session: 'sg-fields-setup:session'
} as const;

/** A person's approved session. `token` is a credential: it stays in this browser. */
export interface Session {
	siteUrl: string;
	token: string;
	login: string;
}

/** What the header shows and what the context was built from. */
export interface LiveState {
	siteUrl: string;
	session: Session | null;
	/** True when `/live/dev-token` answered, so the page reads without a login. */
	devToken: boolean;
	/** Why the page cannot read the site, when it cannot. */
	problem: string | null;
}

/* Storage. Blocked storage is a fallback, never a throw. */

function raw(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function json<T>(key: string): T | null {
	const value = raw(key);
	if (value === null) return null;
	try {
		const parsed: unknown = JSON.parse(value);
		return parsed !== null && typeof parsed === 'object' ? (parsed as T) : null;
	} catch {
		return null;
	}
}

function write(key: string, value: string | null): void {
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch {
		/* Persisting the pick is a convenience, not a requirement. */
	}
}

/** The connected site: the one the person named last. Empty until they name one. */
export function siteUrl(): string {
	return raw(KEYS.site) ?? '';
}

/** What the connect form offers before a site is named. Never the site by itself. */
export function suggestedSiteUrl(): string {
	return env.PUBLIC_FPT_SITE_URL ?? '';
}

/** Name the site. A session for another site is dropped: one site at a time. */
export function setSiteUrl(value: string): void {
	const next = value.trim().replace(/\/+$/, '');
	if (session()?.siteUrl !== next) setSession(null);
	write(KEYS.site, next);
}

export function session(): Session | null {
	const stored = json<Session>(KEYS.session);
	return stored?.siteUrl && stored.token && stored.login ? stored : null;
}

function setSession(value: Session | null): void {
	write(KEYS.session, value === null ? null : JSON.stringify(value));
}

/* Auth. */

interface DevToken {
	accessToken: string;
	expiresIn: number;
	siteUrl: string;
}

async function mintDevToken(): Promise<DevToken | null> {
	if (!dev) return null;
	try {
		const res = await fetch('/live/dev-token', {
			method: 'POST',
			headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
			body: '{}'
		});
		if (!res.ok) return null;
		const body = (await res.json()) as DevToken;
		return body.accessToken && body.siteUrl ? body : null;
	} catch {
		return null;
	}
}

/** A bearer a minute before the old one dies, the rule `createSessionTokenAuth` follows. */
const EXPIRY_SKEW_MS = 60_000;

function devTokenAuth(first: DevToken): () => Promise<string> {
	let token = first.accessToken;
	let expiresAt = Date.now() + Math.max(first.expiresIn * 1000 - EXPIRY_SKEW_MS, 0);
	return async () => {
		if (Date.now() < expiresAt) return token;
		const next = await mintDevToken();
		if (!next) throw new Error('The dev token endpoint stopped answering.');
		token = next.accessToken;
		expiresAt = Date.now() + Math.max(next.expiresIn * 1000 - EXPIRY_SKEW_MS, 0);
		return token;
	};
}

/* The context, built once per page load. */

let state: LiveState = { siteUrl: '', session: null, devToken: false, problem: null };
let context: SgContext | null = null;
let writer: RestClient | null = null;
let schema: LiveSchema | null = null;
let clientOptions: RestClientOptions | null = null;
let ready: Promise<LiveState> | null = null;

async function resolve(): Promise<LiveState> {
	const stored = session();
	// A person's own session wins; the dev key only stands in while nobody is signed in.
	const devToken = stored ? null : await mintDevToken();
	// The dev endpoint knows its own site, and it is the one its key opens.
	const site = connectedSite({ named: siteUrl(), sessionSite: stored?.siteUrl ?? null, devSite: devToken?.siteUrl ?? null });
	if (devToken) setSiteUrl(devToken.siteUrl);

	let token: (() => Promise<string>) | null = null;
	if (stored && stored.siteUrl === site) token = createSessionTokenAuth({ siteUrl: site, sessionToken: stored.token });
	else if (devToken) token = devTokenAuth(devToken);

	// Never silently answer with nothing: with no site or no login every read fails,
	// and the widgets show the error state they show for any refusal.
	const problem = !site ? 'Name the site.' : token ? null : 'Sign in to read Flow PT.';
	const refuse = (): Promise<string> => Promise.reject(new Error(problem ?? 'Not connected to Flow PT.'));
	clientOptions = { siteUrl: site, token: token ?? refuse };
	writer = new RestClient(clientOptions);
	// One schema cache per connected site, for the life of the page (D6).
	schema = createLiveSchema(coreSchemaSource(clientOptions));
	context = createSgContext({ client: writer, siteUrl: site });
	return { siteUrl: site, session: stored, devToken: devToken !== null, problem };
}

/** Settle the site and its auth. The connect screen and the rest of the app both wait on this. */
export function prepareLive(): Promise<LiveState> {
	ready ??= resolve().then((next) => {
		state = next;
		return next;
	});
	return ready;
}

export function liveState(): LiveState {
	return state;
}

/** The one context every widget on the page shares, so two widgets cost one read. */
export function liveContext(): SgContext {
	if (!context) throw new Error('Not connected to Flow PT. Await prepareLive() first.');
	return context;
}

/** The bare client, for schema reads and writes: the install run goes through this. */
export function liveWriter(): RestClient {
	if (!writer) throw new Error('Not connected to Flow PT. Await prepareLive() first.');
	return writer;
}

/** The site's schema for this session: entity types and fields, read once and kept (`$lib/io/schema`). */
export function liveSchema(): LiveSchema {
	if (!schema) throw new Error('Not connected to Flow PT. Await prepareLive() first.');
	return schema;
}

/**
 * The site's address and the bearer, for a client built outside this module: the schema writes
 * and the visibility reads of the install screen (`$lib/io/install-site`). The token is asked for
 * per request and stays in this browser.
 */
export function liveClientOptions(): RestClientOptions {
	if (!clientOptions) throw new Error('Not connected to Flow PT. Await prepareLive() first.');
	return clientOptions;
}

/** The person behind the session: their HumanUser row, by login, read once. */
let me: Promise<EntityRow | null> | null = null;
export function whoAmI(): Promise<EntityRow | null> {
	me ??= (async () => {
		const login = state.session?.login;
		if (!login || !context) return null;
		const result = await context.client.search('HumanUser', {
			filters: { logical_operator: 'and', conditions: [['login', 'is', login]] },
			fields: ['name', 'image', 'login'],
			page: { size: 1, number: 1 }
		});
		return result.data[0] ?? null;
	})();
	return me;
}

/* The App Session Launcher, through this app's endpoints. */

async function launcher<T>(path: string, body: Record<string, unknown>): Promise<{ status: number; body: T }> {
	const res = await fetch(path, {
		method: 'POST',
		headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	const answer = (await res.json().catch(() => null)) as T;
	return { status: res.status, body: answer };
}

/** Opens the approval page and resolves when the person has approved it. */
export async function signIn(site: string, open: (url: string) => void): Promise<Session> {
	const origin = site.replace(/\/+$/, '');
	const created = await launcher<{ id?: string; url?: string; message?: string }>('/live/session-request', {
		siteUrl: origin,
		appName: 'sg-fields-setup',
		machineId: 'sg-fields-setup'
	});
	if (created.status !== 200 || !created.body?.id || !created.body.url) {
		throw new Error(created.body?.message ?? 'Flow PT did not offer an approval page.');
	}
	open(created.body.url);

	// A pending request lives about five minutes, then the poll turns 404 (probe 052).
	const deadline = Date.now() + 300_000;
	for (;;) {
		await new Promise((done) => setTimeout(done, 2000));
		const polled = await launcher<{ approved?: boolean; sessionToken?: string; userLogin?: string }>('/live/session-poll', {
			siteUrl: origin,
			id: created.body.id
		});
		if (polled.status === 404) throw new Error('The approval page expired or was refused. Sign in again.');
		if (polled.status !== 200) throw new Error('Flow PT stopped answering during sign-in.');
		if (polled.body?.approved && polled.body.sessionToken && polled.body.userLogin) {
			const approved: Session = { siteUrl: origin, token: polled.body.sessionToken, login: polled.body.userLogin };
			setSession(approved);
			setSiteUrl(origin);
			return approved;
		}
		if (Date.now() > deadline) throw new Error('Nobody approved the request. Sign in again.');
	}
}

export function signOut(): void {
	setSession(null);
}
