/**
 * The two launcher endpoints: what each does, with the site call and the allowlist handed in.
 * Neither holds state. The `+server.ts` files beside this one only read the request.
 *
 * `/api/v1` answers an OPTIONS preflight with the request origin echoed and
 * credentials allowed, so the browser calls the REST API itself. The App
 * Session Launcher lives outside `/api/v1` and answers no CORS headers at all
 * (probe 062), so its two calls are the only ones that need this server.
 *
 * Anyone can call these, so they are held tight. The site must pass `checkSite`
 * (`$lib/pure/site-host`): https, a Flow PT host, no user name, no port. The call follows no
 * redirect and waits ten seconds. The answer is built here field by field; the site's body is
 * never passed through.
 */
import { json } from '@sveltejs/kit';
import { approvalUrl, checkSite, siteRefusalText } from '../../lib/pure/site-host';

/** The one path either endpoint appends to the site a caller names. */
export const launcherBase = '/internal_api/app_session_request';

/** How long the site gets to answer one call. */
export const LAUNCHER_TIMEOUT_MS = 10_000;

/** The longest refusal of the site's that is passed on. */
const MESSAGE_LIMIT = 300;

const REQUEST_ID = /^[\w-]+$/;

export interface LauncherDeps {
	fetch: (input: string, init?: RequestInit) => Promise<Response>;
	/** `extraSuffixes(env.FPT_EXTRA_SITE_SUFFIXES)`: the hosts allowed beside the two Flow PT domains. */
	extraSuffixes: readonly string[];
}

export function badRequest(message: string): Response {
	return json({ message }, { status: 400 });
}

/** A call that did not come back. The cause stays here: it can name hosts inside the network. */
function forwardFailed(error: unknown): Response {
	const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
	return json({ message: timedOut ? 'The site took too long to answer.' : 'Could not reach the site.' }, { status: 502 });
}

/** The site's origin, or the 400 to answer instead. */
function siteFromBody(value: unknown, deps: LauncherDeps): string | Response {
	const check = checkSite(value, { extraSuffixes: deps.extraSuffixes });
	return check.ok ? check.origin : badRequest(siteRefusalText(check.reason));
}

export async function bodyOf(request: Request): Promise<Record<string, unknown> | Response> {
	try {
		const body: unknown = await request.json();
		if (body === null || typeof body !== 'object' || Array.isArray(body)) return badRequest('Body must be a JSON object.');
		return body as Record<string, unknown>;
	} catch {
		return badRequest('Body must be a JSON object.');
	}
}

/** The site's JSON object, or null for anything else. */
async function objectOf(res: Response): Promise<Record<string, unknown> | null> {
	try {
		const parsed: unknown = JSON.parse(await res.text());
		return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

function call(deps: LauncherDeps, url: string, init: RequestInit): Promise<Response> {
	return deps.fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(LAUNCHER_TIMEOUT_MS) });
}

/**
 * Step one of the App Session Launcher, forwarded: `appName` and `machineId` go to the one fixed
 * launcher path of the site, and the answer is `{id, url}`
 * (post_internal_api_app_session_request). The approval page is answered only when it is https
 * on the site itself.
 */
export async function requestSession(fields: Record<string, unknown>, deps: LauncherDeps): Promise<Response> {
	const site = siteFromBody(fields.siteUrl, deps);
	if (typeof site !== 'string') return site;
	const appName = typeof fields.appName === 'string' && fields.appName ? fields.appName : 'sg-fields-setup';
	const machineId = typeof fields.machineId === 'string' && fields.machineId ? fields.machineId : 'sg-fields-setup';

	let res: Response;
	let answer: Record<string, unknown> | null;
	try {
		res = await call(deps, `${site}${launcherBase}`, {
			method: 'POST',
			headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ appName, machineId }).toString()
		});
		answer = await objectOf(res);
	} catch (error) {
		return forwardFailed(error);
	}

	const id = answer?.sessionRequestId;
	// The launcher answers `{"message": ...}`, never the `errors[]` envelope of `/api/v1`.
	if (!res.ok || typeof id !== 'string' || !REQUEST_ID.test(id) || !answer?.url) {
		const message = typeof answer?.message === 'string' && answer.message ? answer.message.slice(0, MESSAGE_LIMIT) : 'Flow PT did not return a session request.';
		return json({ message }, { status: res.ok ? 502 : res.status });
	}
	const url = approvalUrl(answer.url, site);
	if (url === null) return json({ message: 'Flow PT offered an approval page on another address.' }, { status: 502 });
	return json({ id, url });
}

/**
 * Step two, forwarded: the PUT the browser polls while a person approves. `{approved: false}`
 * while pending, once `{approved: true, sessionToken, userLogin}`, then 404 for a request that
 * was spent, denied, forgotten or never existed (put_internal_api_app_session_request_id). The
 * token crosses this endpoint and is not written down anywhere on the way.
 */
export async function pollSession(fields: Record<string, unknown>, deps: LauncherDeps): Promise<Response> {
	const site = siteFromBody(fields.siteUrl, deps);
	if (typeof site !== 'string') return site;
	// The id goes in a path segment, so it may not carry one of its own.
	if (typeof fields.id !== 'string' || !REQUEST_ID.test(fields.id)) return badRequest("'id' is required.");

	let res: Response;
	let answer: Record<string, unknown> | null;
	try {
		res = await call(deps, `${site}${launcherBase}/${fields.id}`, { method: 'PUT', headers: { Accept: 'application/json' } });
		answer = await objectOf(res);
	} catch (error) {
		return forwardFailed(error);
	}

	if (res.status === 404) return json({ message: 'The session request is gone.' }, { status: 404 });
	if (res.status !== 200) return json({ message: 'Flow PT stopped answering during sign-in.' }, { status: 502 });
	if (answer?.approved === true && typeof answer.sessionToken === 'string' && typeof answer.userLogin === 'string') {
		return json({ approved: true, sessionToken: answer.sessionToken, userLogin: answer.userLogin });
	}
	return json({ approved: false });
}
