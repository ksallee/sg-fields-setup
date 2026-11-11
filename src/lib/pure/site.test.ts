import { describe, expect, it } from 'vitest';
import { connectedSite, connectNudge, isConnected, siteTitle, siteWho } from './site';

describe('connectedSite (OVR-7, B10)', () => {
	it('is empty until a site is named', () => {
		expect(connectedSite({ named: '', sessionSite: null, devSite: null })).toBe('');
	});

	it('is the named site when nobody is signed in', () => {
		expect(connectedSite({ named: 'https://a.shotgrid.autodesk.com', sessionSite: null, devSite: null })).toBe(
			'https://a.shotgrid.autodesk.com'
		);
	});

	it('is the signed-in site over the dev key', () => {
		expect(
			connectedSite({
				named: 'https://a.shotgrid.autodesk.com',
				sessionSite: 'https://a.shotgrid.autodesk.com',
				devSite: 'https://dev.shotgrid.autodesk.com'
			})
		).toBe('https://a.shotgrid.autodesk.com');
	});

	it('is the dev key site when nobody is signed in', () => {
		expect(connectedSite({ named: '', sessionSite: null, devSite: 'https://dev.shotgrid.autodesk.com' })).toBe(
			'https://dev.shotgrid.autodesk.com'
		);
	});
});

describe('isConnected: the site can be read (CMP-3, IMP-52, SET-25)', () => {
	it('needs a site and no problem', () => {
		expect(isConnected({ siteUrl: 'https://a.shotgrid.autodesk.com', problem: null })).toBe(true);
		expect(isConnected({ siteUrl: '', problem: null })).toBe(false);
		expect(isConnected({ siteUrl: 'https://a.shotgrid.autodesk.com', problem: 'Sign in again.' })).toBe(false);
		expect(isConnected({ siteUrl: '', problem: 'Name a site.' })).toBe(false);
	});
});

describe('the navbar\'s site link (OVR-7, B10)', () => {
	const site = 'https://a.shotgrid.autodesk.com';

	it('its title is the site and who reads it', () => {
		expect(siteTitle({ siteUrl: site, session: { login: 'kevin' }, devToken: false })).toBe(`${site} · kevin`);
		expect(siteTitle({ siteUrl: site, session: null, devToken: true })).toBe(`${site} · dev key`);
		expect(siteTitle({ siteUrl: site, session: null, devToken: false })).toBe(site);
		// A sign-in over the dev key reads as the person.
		expect(siteTitle({ siteUrl: site, session: { login: 'kevin' }, devToken: true })).toBe(`${site} · kevin`);
	});

	it('B10: with no site its title invites connecting one', () => {
		expect(siteTitle({ siteUrl: '', session: null, devToken: false })).toBe('Connect a site');
	});

	it('who reads the site: the person, the dev key, or nobody signed in', () => {
		expect(siteWho({ session: { login: 'kevin' }, devToken: true })).toEqual({ kind: 'person', text: 'kevin' });
		expect(siteWho({ session: null, devToken: true })).toEqual({ kind: 'dev-key', text: 'Dev key' });
		expect(siteWho({ session: null, devToken: false })).toEqual({ kind: 'nobody', text: 'Not signed in' });
	});
});

describe('connectNudge (OVR-7, CMP-3)', () => {
	it('says nothing when the site can be read', () => {
		expect(connectNudge({ siteUrl: 'https://a.shotgrid.autodesk.com', problem: null })).toBeNull();
	});

	it('asks for a site when none is named', () => {
		expect(connectNudge({ siteUrl: '', problem: 'Name the site.' })).toMatchObject({ title: 'No site connected.', action: 'Connect a site' });
	});

	it('asks for a sign-in when the site is named and cannot be read', () => {
		expect(connectNudge({ siteUrl: 'https://a.shotgrid.autodesk.com', problem: 'Sign in to read Flow PT.' })).toMatchObject({
			title: 'Not signed in.',
			action: 'Sign in'
		});
	});
});
