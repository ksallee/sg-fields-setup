/**
 * Step two of the App Session Launcher, forwarded.
 *
 * The PUT the browser polls while a person approves the request. The launcher's
 * body is passed through as it is: `{"approved": false}` while pending, once
 * `{"approved": true, "sessionToken", "userLogin"}`, then 404 for a request that
 * was spent, denied, forgotten or never existed
 * (put_internal_api_app_session_request_id). The token crosses this endpoint and
 * is not written down anywhere on the way.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { badRequest, bodyOf, forwardFailed, launcherBase, siteFromBody } from '../_launcher';

export const POST: RequestHandler = async ({ request }) => {
	const fields = await bodyOf(request);
	if (fields instanceof Response) return fields;
	const site = siteFromBody(fields.siteUrl);
	if (typeof site !== 'string') return site;
	// The id goes in a path segment, so it may not carry one of its own.
	if (typeof fields.id !== 'string' || !/^[\w-]+$/.test(fields.id)) return badRequest("'id' is required.");

	let res: Response;
	try {
		res = await fetch(`${site}${launcherBase}/${fields.id}`, { method: 'PUT', headers: { Accept: 'application/json' } });
	} catch (error) {
		return forwardFailed(error);
	}

	const text = await res.text();
	let answer: unknown = null;
	try {
		answer = text ? JSON.parse(text) : null;
	} catch {
		answer = { message: 'Flow PT answered with a body that is not JSON.' };
	}
	return json(answer, { status: res.status });
};
