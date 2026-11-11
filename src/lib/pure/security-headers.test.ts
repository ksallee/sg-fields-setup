import { describe, expect, it } from 'vitest';
import vercel from '../../../vercel.json';
import { handle } from '../../hooks.server';
import { cspDirectives, ENDPOINT_CSP, STATIC_SECURITY_HEADERS } from './security-headers';

describe('cspDirectives (B2 of the security audit)', () => {
	const csp = cspDirectives([]);

	it('lets scripts come from the app alone: no inline, no eval, the nonce is SvelteKit\'s', () => {
		expect(csp['script-src']).toEqual(['self']);
		expect(csp['default-src']).toEqual(['self']);
		expect(csp['object-src']).toEqual(['none']);
		expect(csp['base-uri']).toEqual(['self']);
		expect(csp['form-action']).toEqual(['self']);
	});

	it('lets no page frame the app', () => {
		expect(csp['frame-ancestors']).toEqual(['none']);
	});

	it('lets the page call itself and the two Flow PT domains, nothing else', () => {
		expect(csp['connect-src']).toEqual(['self', 'https://*.shotgrid.autodesk.com', 'https://*.shotgunstudio.com']);
	});

	it('adds the hosts of FPT_EXTRA_SITE_SUFFIXES, from the list the endpoints read', () => {
		expect(cspDirectives(['flow.example.com'])['connect-src']).toEqual([
			'self',
			'https://*.shotgrid.autodesk.com',
			'https://*.shotgunstudio.com',
			'https://flow.example.com',
			'https://*.flow.example.com'
		]);
	});

	it('allows inline styles, which the component libraries set, and no style from elsewhere', () => {
		expect(csp['style-src']).toEqual(['self', 'unsafe-inline']);
	});

	it('takes images from the app, data and https, and fonts from the app', () => {
		expect(csp['img-src']).toEqual(['self', 'data:', 'https:']);
		expect(csp['font-src']).toEqual(['self']);
	});
});

describe('the static headers', () => {
	it('are the three', () => {
		expect(STATIC_SECURITY_HEADERS).toEqual({
			'X-Content-Type-Options': 'nosniff',
			'Referrer-Policy': 'no-referrer',
			'X-Frame-Options': 'DENY'
		});
	});

	it('are set by vercel.json on every path, so static files carry them too', () => {
		const rules: { source: string; headers: { key: string; value: string }[] }[] = vercel.headers;
		const all = rules.find((rule) => rule.source === '/(.*)');
		expect(all).toBeDefined();
		expect(Object.fromEntries(all!.headers.map((header) => [header.key, header.value]))).toEqual(STATIC_SECURITY_HEADERS);
	});
});

describe('the handle hook', () => {
	type Input = Parameters<typeof handle>[0];
	const run = (response: Response): Promise<Response> =>
		Promise.resolve(handle({ event: {} as Input['event'], resolve: async () => response } as Input));

	it('sets the three on an endpoint answer, and a policy that frames and loads nothing', async () => {
		const answer = await run(new Response('{}', { status: 400, headers: { 'content-type': 'application/json' } }));
		for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) expect(answer.headers.get(name)).toBe(value);
		expect(answer.headers.get('content-security-policy')).toBe(ENDPOINT_CSP);
		expect(ENDPOINT_CSP).toBe("default-src 'none'; frame-ancestors 'none'");
		expect(answer.status).toBe(400);
	});

	it("sets the three on a page and keeps the page's own policy", async () => {
		const page = "default-src 'self'; script-src 'self' 'nonce-abc'";
		const answer = await run(new Response('<html>', { headers: { 'content-type': 'text/html', 'content-security-policy': page } }));
		for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) expect(answer.headers.get(name)).toBe(value);
		expect(answer.headers.get('content-security-policy')).toBe(page);
	});
});
