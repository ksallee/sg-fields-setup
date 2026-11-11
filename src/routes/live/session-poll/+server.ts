/**
 * Step two of the App Session Launcher, forwarded: the poll while a person approves. The rules
 * are `pollSession`'s (`../_launcher`).
 */
import { env } from '$env/dynamic/private';
import type { RequestHandler } from '@sveltejs/kit';
import { extraSuffixes } from '$lib/pure/site-host';
import { bodyOf, pollSession } from '../_launcher';

export const POST: RequestHandler = async ({ request }) => {
	const fields = await bodyOf(request);
	if (fields instanceof Response) return fields;
	return pollSession(fields, { fetch, extraSuffixes: extraSuffixes(env.FPT_EXTRA_SITE_SUFFIXES) });
};
