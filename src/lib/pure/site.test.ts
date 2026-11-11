import { describe, expect, it } from 'vitest';
import { connectedSite } from './site';

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
