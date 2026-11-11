/**
 * Step one of the App Session Launcher, forwarded. It takes no credential, keeps nothing, and
 * reads nothing of this app's but the list of extra site hosts. The rules are `requestSession`'s
 * (`../_launcher`).
 */
import { env } from '$env/dynamic/private';
import type { RequestHandler } from '@sveltejs/kit';
import { extraSuffixes } from '$lib/pure/site-host';
import { bodyOf, requestSession } from '../_launcher';

export const POST: RequestHandler = async ({ request }) => {
	const fields = await bodyOf(request);
	if (fields instanceof Response) return fields;
	return requestSession(fields, { fetch, extraSuffixes: extraSuffixes(env.FPT_EXTRA_SITE_SUFFIXES) });
};
