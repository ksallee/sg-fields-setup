import { describe, expect, it } from 'vitest';
import {
	IMPORT_MODES,
	importModeHint,
	resolveEntityType,
	targetEntityType,
	type SiteEntityType
} from './import-entity-type';

const SITE: SiteEntityType[] = [
	{ name: 'Shot', displayName: 'Shot' },
	{ name: 'Asset', displayName: 'Asset' },
	{ name: 'CustomEntity07', displayName: 'Slate' },
	{ name: 'CustomEntity19', displayName: ' Lens ' },
	{ name: 'Status', displayName: 'Status' }
];

describe('resolveEntityType (IMP-21)', () => {
	it('IMP-21: matches the API name, any case', () => {
		expect(resolveEntityType('Shot', SITE)).toBe('Shot');
		expect(resolveEntityType('shot', SITE)).toBe('Shot');
		expect(resolveEntityType('customentity19', SITE)).toBe('CustomEntity19');
	});

	it('IMP-21: matches the display name, trimmed, and returns the API name', () => {
		expect(resolveEntityType('Lens', SITE)).toBe('CustomEntity19');
		expect(resolveEntityType('SLATE', SITE)).toBe('CustomEntity07');
	});

	it('IMP-21: tolerates a trailing "s" or "es" on the hint', () => {
		expect(resolveEntityType('Slates', SITE)).toBe('CustomEntity07');
		expect(resolveEntityType('Lenses', SITE)).toBe('CustomEntity19');
		expect(resolveEntityType('Shots', SITE)).toBe('Shot');
		expect(resolveEntityType('Statuses', SITE)).toBe('Status');
	});

	it('IMP-21: tolerates a trailing "s" or "es" on the site side', () => {
		const site = [
			{ name: 'CustomEntity01', displayName: 'Takes' },
			{ name: 'CustomEntity02', displayName: 'Boxes' }
		];
		expect(resolveEntityType('Take', site)).toBe('CustomEntity01');
		expect(resolveEntityType('box', site)).toBe('CustomEntity02');
	});

	it('IMP-21: the hint is trimmed', () => {
		expect(resolveEntityType('  Slates ', SITE)).toBe('CustomEntity07');
	});

	it('IMP-21: no match, a blank hint or no types resolves to nothing', () => {
		expect(resolveEntityType('Camera', SITE)).toBeNull();
		expect(resolveEntityType('Shotss', SITE)).toBeNull();
		expect(resolveEntityType('Sho', SITE)).toBeNull();
		expect(resolveEntityType('', SITE)).toBeNull();
		expect(resolveEntityType('   ', SITE)).toBeNull();
		expect(resolveEntityType('s', [{ name: 'X', displayName: '' }])).toBeNull();
		expect(resolveEntityType('Shot', [])).toBeNull();
	});

	it('IMP-21: an exact match beats a plural-tolerant one, wherever it sits in the list', () => {
		const site = [
			{ name: 'Shot', displayName: 'Shot' },
			{ name: 'CustomEntity03', displayName: 'Shots' }
		];
		expect(resolveEntityType('Shots', site)).toBe('CustomEntity03');
		expect(resolveEntityType('Shot', site)).toBe('Shot');
	});

	it('IMP-21: among exact matches, the API name beats the display name', () => {
		const site = [
			{ name: 'CustomEntity04', displayName: 'Asset' },
			{ name: 'Asset', displayName: 'Asset' }
		];
		expect(resolveEntityType('asset', site)).toBe('Asset');
	});

	it('IMP-21: among plural-tolerant matches, the API name beats the display name', () => {
		const site = [
			{ name: 'CustomEntity04', displayName: 'Asset' },
			{ name: 'Asset', displayName: 'Assets' }
		];
		expect(resolveEntityType('assetes', site)).toBe('Asset');
	});

	it("IMP-21: otherwise the list's order decides", () => {
		const site = [
			{ name: 'CustomEntity05', displayName: 'Camera' },
			{ name: 'CustomEntity06', displayName: 'Camera' }
		];
		expect(resolveEntityType('Cameras', site)).toBe('CustomEntity05');
	});
});

describe('targetEntityType', () => {
	const base = { hint: 'Slates', worksheet: 'Lenses', fallback: 'Shot', types: SITE };

	it('IMP-17: three modes, automatic first as the default', () => {
		expect(IMPORT_MODES).toEqual(['automatic', 'worksheet', 'header_prefix']);
	});

	it('IMP-22: automatic uses the prefix first', () => {
		expect(targetEntityType({ ...base, mode: 'automatic' })).toBe('CustomEntity07');
	});

	it('IMP-22: automatic falls to the worksheet name, then the fallback', () => {
		expect(targetEntityType({ ...base, mode: 'automatic', hint: '' })).toBe('CustomEntity19');
		expect(targetEntityType({ ...base, mode: 'automatic', hint: 'Camera' })).toBe('CustomEntity19');
		expect(targetEntityType({ ...base, mode: 'automatic', hint: '', worksheet: 'Sheet1' })).toBe('Shot');
		expect(targetEntityType({ ...base, mode: 'automatic', hint: '', worksheet: undefined })).toBe('Shot');
	});

	it('IMP-23: worksheet mode ignores the prefix', () => {
		expect(targetEntityType({ ...base, mode: 'worksheet' })).toBe('CustomEntity19');
		expect(targetEntityType({ ...base, mode: 'worksheet', worksheet: 'Sheet1' })).toBe('Shot');
	});

	it('IMP-23: worksheet mode on a CSV uses the fallback', () => {
		expect(targetEntityType({ ...base, mode: 'worksheet', worksheet: undefined })).toBe('Shot');
	});

	it('IMP-24: header prefix mode ignores the worksheet name', () => {
		expect(targetEntityType({ ...base, mode: 'header_prefix' })).toBe('CustomEntity07');
		expect(targetEntityType({ ...base, mode: 'header_prefix', hint: '' })).toBe('Shot');
		expect(targetEntityType({ ...base, mode: 'header_prefix', hint: 'Camera' })).toBe('Shot');
	});

	it('IMP-25: nothing resolved and no fallback is an empty target type', () => {
		for (const mode of IMPORT_MODES) {
			expect(targetEntityType({ mode, hint: 'Camera', worksheet: 'Sheet1', fallback: '', types: SITE })).toBe('');
			expect(targetEntityType({ mode, hint: '', fallback: '  ', types: SITE })).toBe('');
		}
	});

	it('IMP-25: the fallback is trimmed', () => {
		expect(targetEntityType({ mode: 'automatic', hint: '', fallback: ' Shot ', types: SITE })).toBe('Shot');
	});

	it('IMP-52: without a site nothing resolves and the typed fallback is used as is', () => {
		for (const mode of IMPORT_MODES) {
			expect(targetEntityType({ mode, hint: 'Shot', worksheet: 'Shot', fallback: 'CustomEntity07' })).toBe(
				'CustomEntity07'
			);
			expect(targetEntityType({ mode, hint: 'Shot', worksheet: 'Shot', fallback: '' })).toBe('');
		}
	});
});

describe('importModeHint (IMP-26)', () => {
	it('IMP-26: one plain line per mode', () => {
		expect(importModeHint('automatic')).toBe(
			'Each column takes its type from its header prefix, else its sheet name, else the fallback.'
		);
		expect(importModeHint('worksheet')).toBe(
			'Each column takes its type from its sheet name, else the fallback. Prefixes are still cut from names.'
		);
		expect(importModeHint('header_prefix')).toBe(
			'Each column takes its type from its header prefix, else the fallback. Sheet names are ignored.'
		);
	});

	it('IMP-26: each hint is one line', () => {
		for (const mode of IMPORT_MODES) expect(importModeHint(mode)).not.toMatch(/\n/);
	});
});
