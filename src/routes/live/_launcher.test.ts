/**
 * The two launcher endpoints, with the site faked. A1 of the security audit: they reach Flow PT
 * hosts alone, follow no redirect, wait ten seconds at most, and answer only what the page reads.
 */
import { describe, expect, it } from 'vitest';
import { pollSession, requestSession, type LauncherDeps } from './_launcher';

const SITE = 'https://studio.shotgrid.autodesk.com';

interface Call {
	url: string;
	init: RequestInit;
}

function fake(answer: (call: Call) => Response | Promise<Response>): LauncherDeps & { calls: Call[] } {
	const calls: Call[] = [];
	return {
		calls,
		extraSuffixes: [],
		fetch: async (input, init) => {
			const call = { url: String(input), init: init ?? {} };
			calls.push(call);
			return answer(call);
		}
	};
}

const jsonAnswer = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function read(response: Response): Promise<{ status: number; body: Record<string, unknown> }> {
	return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const HOSTILE = [
	'https://localhost:4702',
	'https://127.0.0.1',
	'https://user:pw@127.0.0.1:4702/x?y',
	'https://studio.shotgrid.autodesk.com@127.0.0.1',
	'http://studio.shotgrid.autodesk.com',
	'https://attacker.example',
	'https://studio.shotgrid.autodesk.com.attacker.example',
	'https://studio.shotgrid.autodesk.com:8443',
	''
];

describe('requestSession (A1)', () => {
	it('forwards a sign-in to the site and answers the id and the approval page', async () => {
		const deps = fake(() => jsonAnswer({ sessionRequestId: 'abc', url: `${SITE}/app_session_request/abc` }));
		const answer = await read(await requestSession({ siteUrl: `${SITE}/`, appName: 'sg-fields-setup', machineId: 'sg-fields-setup' }, deps));
		expect(answer).toEqual({ status: 200, body: { id: 'abc', url: `${SITE}/app_session_request/abc` } });
		expect(deps.calls).toHaveLength(1);
		expect(deps.calls[0].url).toBe(`${SITE}/internal_api/app_session_request`);
		expect(deps.calls[0].init.method).toBe('POST');
		expect(deps.calls[0].init.body).toBe('appName=sg-fields-setup&machineId=sg-fields-setup');
	});

	it('follows no redirect and gives the site ten seconds', async () => {
		const deps = fake(() => jsonAnswer({ sessionRequestId: 'abc', url: `${SITE}/x` }));
		await requestSession({ siteUrl: SITE }, deps);
		expect(deps.calls[0].init.redirect).toBe('error');
		expect(deps.calls[0].init.signal).toBeInstanceOf(AbortSignal);
	});

	it.each(HOSTILE)('refuses %j with 400 and calls nothing', async (siteUrl) => {
		const deps = fake(() => jsonAnswer({}));
		const answer = await read(await requestSession({ siteUrl }, deps));
		expect(answer.status).toBe(400);
		expect(typeof answer.body.message).toBe('string');
		expect(deps.calls).toHaveLength(0);
	});

	it('reaches a host under an extra suffix when the deployment names one', async () => {
		const deps = { ...fake(() => jsonAnswer({ sessionRequestId: 'abc', url: 'https://sg.flow.example.com/x' })), extraSuffixes: ['flow.example.com'] };
		const answer = await read(await requestSession({ siteUrl: 'https://sg.flow.example.com' }, deps));
		expect(answer.status).toBe(200);
	});

	it.each(['javascript:alert(document.domain)', 'https://attacker.example/approve', 'http://studio.shotgrid.autodesk.com/x', 42])(
		'answers 502 and no url when the approval page is %j',
		async (url) => {
			const deps = fake(() => jsonAnswer({ sessionRequestId: 'abc', url }));
			const answer = await read(await requestSession({ siteUrl: SITE }, deps));
			expect(answer.status).toBe(502);
			expect(answer.body).toEqual({ message: 'Flow PT offered an approval page on another address.' });
		}
	);

	it('answers 502 when the request id is no plain id', async () => {
		const deps = fake(() => jsonAnswer({ sessionRequestId: '../x', url: `${SITE}/x` }));
		expect((await requestSession({ siteUrl: SITE }, deps)).status).toBe(502);
	});

	it("passes the site's own refusal on, as text of bounded length", async () => {
		const deps = fake(() => jsonAnswer({ message: 'x'.repeat(5000), other: 'never forwarded' }, 403));
		const answer = await read(await requestSession({ siteUrl: SITE }, deps));
		expect(answer.status).toBe(403);
		expect(Object.keys(answer.body)).toEqual(['message']);
		expect((answer.body.message as string).length).toBeLessThanOrEqual(300);
	});

	it('answers 502 with a plain line when the site redirects, times out or cannot be reached', async () => {
		const failing = fake(() => {
			throw new TypeError('fetch failed: connect ECONNREFUSED 10.0.0.7:443');
		});
		const failed = await read(await requestSession({ siteUrl: SITE }, failing));
		expect(failed).toEqual({ status: 502, body: { message: 'Could not reach the site.' } });

		const slow = fake(() => {
			throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
		});
		const timedOut = await read(await requestSession({ siteUrl: SITE }, slow));
		expect(timedOut).toEqual({ status: 502, body: { message: 'The site took too long to answer.' } });
	});

	it('answers 502 for a body that is not JSON', async () => {
		const deps = fake(() => new Response('<html>', { status: 200 }));
		expect((await requestSession({ siteUrl: SITE }, deps)).status).toBe(502);
	});
});

describe('pollSession (A1)', () => {
	it('puts to the request on the site and follows no redirect', async () => {
		const deps = fake(() => jsonAnswer({ approved: false }));
		const answer = await read(await pollSession({ siteUrl: SITE, id: 'abc-1_2' }, deps));
		expect(answer).toEqual({ status: 200, body: { approved: false } });
		expect(deps.calls[0].url).toBe(`${SITE}/internal_api/app_session_request/abc-1_2`);
		expect(deps.calls[0].init.method).toBe('PUT');
		expect(deps.calls[0].init.redirect).toBe('error');
		expect(deps.calls[0].init.signal).toBeInstanceOf(AbortSignal);
	});

	it('answers the three fields the page reads and nothing else', async () => {
		const deps = fake(() => jsonAnswer({ approved: true, sessionToken: 'tok', userLogin: 'kevin', internalSecret: 'S3CR3T', extra: { a: 1 } }));
		const answer = await read(await pollSession({ siteUrl: SITE, id: 'abc' }, deps));
		expect(answer).toEqual({ status: 200, body: { approved: true, sessionToken: 'tok', userLogin: 'kevin' } });
	});

	it('answers approved false for any body that does not carry an approval', async () => {
		for (const body of [{ internalSecret: 'S3CR3T', method: 'GET', path: '/admin/secrets' }, { approved: 'yes', sessionToken: 'x', userLogin: 'y' }, { approved: true, sessionToken: 7, userLogin: 'y' }, [1, 2], null, 'text']) {
			const deps = fake(() => jsonAnswer(body));
			const answer = await read(await pollSession({ siteUrl: SITE, id: 'abc' }, deps));
			expect(answer).toEqual({ status: 200, body: { approved: false } });
		}
	});

	it.each(HOSTILE)('refuses %j with 400 and calls nothing', async (siteUrl) => {
		const deps = fake(() => jsonAnswer({}));
		const answer = await read(await pollSession({ siteUrl, id: 'abc' }, deps));
		expect(answer.status).toBe(400);
		expect(deps.calls).toHaveLength(0);
	});

	it.each(['', 'a/b', '../x', 'a?b', 7, undefined])('refuses the id %j', async (id) => {
		const deps = fake(() => jsonAnswer({}));
		expect((await pollSession({ siteUrl: SITE, id }, deps)).status).toBe(400);
		expect(deps.calls).toHaveLength(0);
	});

	it('answers 404 for a request that is spent, with a line of its own', async () => {
		const deps = fake(() => jsonAnswer({ message: 'gone', leak: 'x' }, 404));
		const answer = await read(await pollSession({ siteUrl: SITE, id: 'abc' }, deps));
		expect(answer).toEqual({ status: 404, body: { message: 'The session request is gone.' } });
	});

	it('answers 502 for any other status, and for a failed call', async () => {
		const refused = fake(() => jsonAnswer({ secret: 'x' }, 500));
		expect(await read(await pollSession({ siteUrl: SITE, id: 'abc' }, refused))).toEqual({
			status: 502,
			body: { message: 'Flow PT stopped answering during sign-in.' }
		});
		const failing = fake(() => {
			throw new TypeError('fetch failed');
		});
		expect(await read(await pollSession({ siteUrl: SITE, id: 'abc' }, failing))).toEqual({
			status: 502,
			body: { message: 'Could not reach the site.' }
		});
	});
});
