import { describe, expect, it } from 'vitest';
import { approvalUrl, checkSite, connectSources, extraSuffixes, KNOWN_SITE_SUFFIXES, siteHost, siteRefusalText, type SiteCheck } from './site-host';

const origin = (check: SiteCheck): string | null => (check.ok ? check.origin : null);
const reason = (check: SiteCheck): string | null => (check.ok ? null : check.reason);

describe('checkSite', () => {
	it('names the two domains Flow PT sites live on', () => {
		expect(KNOWN_SITE_SUFFIXES).toEqual(['.shotgrid.autodesk.com', '.shotgunstudio.com']);
	});

	it('accepts a site on either domain and answers its origin alone', () => {
		expect(origin(checkSite('https://studio.shotgrid.autodesk.com'))).toBe('https://studio.shotgrid.autodesk.com');
		expect(origin(checkSite('  https://Studio.ShotgunStudio.com/page/123?x=1#y  '))).toBe('https://studio.shotgunstudio.com');
		expect(origin(checkSite('https://studio.shotgrid.autodesk.com:443/'))).toBe('https://studio.shotgrid.autodesk.com');
	});

	it('refuses what is no text or empty', () => {
		expect(reason(checkSite(undefined))).toBe('missing');
		expect(reason(checkSite(12))).toBe('missing');
		expect(reason(checkSite('   '))).toBe('missing');
	});

	it('refuses what does not parse', () => {
		expect(reason(checkSite('studio.shotgrid.autodesk.com'))).toBe('not-url');
		expect(reason(checkSite('https://'))).toBe('not-url');
	});

	it('refuses any scheme but https', () => {
		expect(reason(checkSite('http://studio.shotgrid.autodesk.com'))).toBe('not-https');
		expect(reason(checkSite('javascript:alert(1)'))).toBe('not-https');
		expect(reason(checkSite('file:///etc/passwd'))).toBe('not-https');
	});

	it('refuses a user name or a password', () => {
		expect(reason(checkSite('https://user:pw@studio.shotgrid.autodesk.com'))).toBe('userinfo');
		expect(reason(checkSite('https://user@studio.shotgrid.autodesk.com'))).toBe('userinfo');
		// The audit's shape: the real host hides behind the userinfo.
		expect(reason(checkSite('https://studio.shotgrid.autodesk.com@127.0.0.1/x'))).toBe('userinfo');
	});

	it('refuses a port that is not the default', () => {
		expect(reason(checkSite('https://studio.shotgrid.autodesk.com:8443'))).toBe('port');
		expect(reason(checkSite('https://localhost:4702'))).toBe('port');
	});

	it('refuses a host outside the two domains', () => {
		for (const site of [
			'https://localhost',
			'https://127.0.0.1',
			'https://[::1]',
			'https://169.254.169.254',
			'https://example.com',
			'https://shotgrid.autodesk.com',
			'https://shotgunstudio.com',
			'https://evilshotgunstudio.com',
			'https://studio.shotgrid.autodesk.com.evil.example',
			'https://studio.shotgrid.autodesk.com.',
			'https://.shotgunstudio.com'
		]) {
			expect(reason(checkSite(site)), site).toMatch(/^(host|not-url)$/);
		}
	});

	it('accepts a host under an extra suffix, and the suffix itself', () => {
		const extra = ['flow.example.com'];
		expect(origin(checkSite('https://studio.flow.example.com', { extraSuffixes: extra }))).toBe('https://studio.flow.example.com');
		expect(origin(checkSite('https://flow.example.com', { extraSuffixes: extra }))).toBe('https://flow.example.com');
		expect(reason(checkSite('https://notflow.example.com', { extraSuffixes: extra }))).toBe('host');
		expect(reason(checkSite('https://evilflow.example.com', { extraSuffixes: extra }))).toBe('host');
		// Every other rule still holds under an extra suffix.
		expect(reason(checkSite('https://flow.example.com:8443', { extraSuffixes: extra }))).toBe('port');
		expect(reason(checkSite('http://flow.example.com', { extraSuffixes: extra }))).toBe('not-https');
	});

	it('with anyHost keeps every rule but the host one', () => {
		expect(origin(checkSite('https://flow.example.com/x', { anyHost: true }))).toBe('https://flow.example.com');
		expect(reason(checkSite('http://flow.example.com', { anyHost: true }))).toBe('not-https');
		expect(reason(checkSite('https://a:b@flow.example.com', { anyHost: true }))).toBe('userinfo');
		expect(reason(checkSite('https://flow.example.com:9', { anyHost: true }))).toBe('port');
		expect(reason(checkSite('javascript:alert(1)', { anyHost: true }))).toBe('not-https');
	});
});

describe('extraSuffixes', () => {
	it('is empty for nothing', () => {
		expect(extraSuffixes(undefined)).toEqual([]);
		expect(extraSuffixes('')).toEqual([]);
		expect(extraSuffixes(' , ,')).toEqual([]);
	});

	it('splits on commas, trims, lowercases and drops a leading dot', () => {
		expect(extraSuffixes(' .Flow.Example.com , sg.studio.example ')).toEqual(['flow.example.com', 'sg.studio.example']);
	});

	it('drops what is no host suffix: a scheme, a port, a path, a wildcard, a bare label', () => {
		expect(extraSuffixes('https://a.example.com, a.example.com:8443, a.example.com/x, *.example.com, localhost, com, a..b, -a.example.com')).toEqual([]);
	});

	it('drops an address in digits', () => {
		expect(extraSuffixes('127.0.0.1, 0.1')).toEqual([]);
	});
});

describe('approvalUrl', () => {
	const site = 'https://studio.shotgrid.autodesk.com';

	it('is the url when it is https on the site itself', () => {
		expect(approvalUrl(`${site}/app_session_request/abc`, site)).toBe(`${site}/app_session_request/abc`);
	});

	it('is null for anything else', () => {
		expect(approvalUrl('javascript:alert(document.domain)', site)).toBeNull();
		expect(approvalUrl('https://evil.example/app_session_request/abc', site)).toBeNull();
		expect(approvalUrl('http://studio.shotgrid.autodesk.com/x', site)).toBeNull();
		expect(approvalUrl('https://studio.shotgrid.autodesk.com:8443/x', site)).toBeNull();
		expect(approvalUrl('https://user@studio.shotgrid.autodesk.com/x', site)).toBeNull();
		expect(approvalUrl('/app_session_request/abc', site)).toBeNull();
		expect(approvalUrl('', site)).toBeNull();
		expect(approvalUrl(undefined, site)).toBeNull();
		expect(approvalUrl({ href: site }, site)).toBeNull();
	});
});

describe('connectSources', () => {
	it('is the two domains by default', () => {
		expect(connectSources([])).toEqual(['https://*.shotgrid.autodesk.com', 'https://*.shotgunstudio.com']);
	});

	it('adds each extra suffix, bare and with its subdomains', () => {
		expect(connectSources(['flow.example.com'])).toEqual([
			'https://*.shotgrid.autodesk.com',
			'https://*.shotgunstudio.com',
			'https://flow.example.com',
			'https://*.flow.example.com'
		]);
	});
});

describe('siteRefusalText', () => {
	it('has a plain line for every reason', () => {
		for (const each of ['missing', 'not-url', 'not-https', 'userinfo', 'port', 'host'] as const) {
			const text = siteRefusalText(each);
			expect(text).toMatch(/\.$/);
			expect(text).not.toMatch(/[—–]/);
		}
		expect(siteRefusalText('host')).toContain('.shotgrid.autodesk.com');
		expect(siteRefusalText('host')).toContain('.shotgunstudio.com');
	});
});

describe('siteHost', () => {
	it('is the whole host, the suffix included', () => {
		expect(siteHost('https://studio.shotgrid.autodesk.com')).toBe('studio.shotgrid.autodesk.com');
		expect(siteHost('https://www.old.shotgunstudio.com/')).toBe('www.old.shotgunstudio.com');
	});

	it('keeps any other host whole', () => {
		expect(siteHost('https://fpt.example.com')).toBe('fpt.example.com');
	});

	it('gives back what is not a URL', () => {
		expect(siteHost('not a url')).toBe('not a url');
	});
});
