/**
 * Step one of the App Session Launcher, forwarded.
 *
 * Appends the one fixed launcher path to the site the caller names, forwards
 * `appName` and `machineId`, and answers `{id, url}`
 * (post_internal_api_app_session_request). It takes no credential, keeps
 * nothing, and reads nothing of this app's.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { bodyOf, forwardFailed, launcherBase, siteFromBody } from '../_launcher';

export const POST: RequestHandler = async ({ request }) => {
	const fields = await bodyOf(request);
	if (fields instanceof Response) return fields;
	const site = siteFromBody(fields.siteUrl);
	if (typeof site !== 'string') return site;
	const appName = typeof fields.appName === 'string' && fields.appName ? fields.appName : 'sg-fields-setup';
	const machineId = typeof fields.machineId === 'string' && fields.machineId ? fields.machineId : 'sg-fields-setup';

	let res: Response;
	try {
		res = await fetch(`${site}${launcherBase}`, {
			method: 'POST',
			headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ appName, machineId }).toString()
		});
	} catch (error) {
		return forwardFailed(error);
	}

	const text = await res.text();
	let answer: { sessionRequestId?: string; url?: string; message?: string } | null = null;
	try {
		answer = text ? JSON.parse(text) : null;
	} catch {
		answer = null;
	}
	// The launcher answers `{"message": ...}`, never the `errors[]` envelope of `/api/v1`.
	if (!res.ok || !answer?.sessionRequestId || !answer.url) {
		return json(
			{ message: answer?.message ?? 'Flow PT did not return a session request.' },
			{ status: res.ok ? 502 : res.status }
		);
	}
	return json({ id: answer.sessionRequestId, url: answer.url });
};
