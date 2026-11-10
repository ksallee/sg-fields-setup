/**
 * A bearer for local work, minted from the script key in `.env.local`.
 *
 * Dev only. It exists so an agent driving the page headless reaches the site
 * without a person clicking approve, and it is compiled out of a production
 * build: `dev` is false there and the endpoint answers 404. The key never
 * leaves the server; what crosses the wire is a 600s bearer
 * (post_auth_access_token). Rows read this way are the script user's: what it
 * has read, what it follows, and what is addressed to it are not a person's.
 */
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { json, type RequestHandler } from '@sveltejs/kit';

function fromEnv(name: string): string | undefined {
	const value = env[name];
	return typeof value === 'string' && value !== '' ? value : undefined;
}

const notFound = (): Response => new Response('Not found', { status: 404 });

export const POST: RequestHandler = async () => {
	if (!dev) return notFound();
	const siteUrl = fromEnv('FPT_API_SITE_URL')?.replace(/\/+$/, '');
	const clientId = fromEnv('FPT_API_SCRIPT_NAME');
	const clientSecret = fromEnv('FPT_API_API_KEY');
	if (!siteUrl || !clientId || !clientSecret) return notFound();

	// Form-encoded is the one content type the token endpoint accepts; JSON is 415.
	const res = await fetch(`${siteUrl}/api/v1/auth/access_token`, {
		method: 'POST',
		headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString()
	});
	const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
	if (!res.ok || !body?.access_token) {
		return json({ message: 'Flow PT refused the script key.' }, { status: res.status === 200 ? 502 : res.status });
	}
	return json({ accessToken: body.access_token, expiresIn: body.expires_in ?? 600, siteUrl });
};
