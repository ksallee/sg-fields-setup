import { describe, expect, it } from 'vitest';
import {
	checkboxDefaultChoice,
	checkboxDefaultValue,
	listDefaultText,
	listDefaultValue,
	missingRequired,
	missingText,
	nameWarning,
	rowBadges
} from './editor-row';

const complete = { targetEntityType: 'Shot', programmaticName: 'sg_lens', displayName: 'Lens', dataType: 'text' };

describe('rowBadges (EDT-20, EDT-13, CMP-9)', () => {
	it('EDT-20: nothing to mark, no badge', () => {
		expect(rowBadges({ mirror: false, incomplete: false, duplicated: false, markers: [] })).toEqual([]);
	});

	it('EDT-20, EDT-13: mirror, incomplete and duplicate come first, in that order, then the site markers', () => {
		const badges = rowBadges({ mirror: true, incomplete: true, duplicated: true, markers: ['type_mismatch', 'label_taken'] });
		expect(badges.map((badge) => badge.kind)).toEqual(['mirror', 'incomplete', 'duplicate', 'type_mismatch', 'label_taken']);
		expect(badges.map((badge) => badge.label)).toEqual(['Computed', 'Incomplete', 'Duplicate', 'Type mismatch', 'Label taken']);
	});

	it('CMP-9: on site reads as fine, the others as trouble', () => {
		const tones = Object.fromEntries(
			rowBadges({ mirror: true, incomplete: true, duplicated: true, markers: ['on_site', 'type_mismatch', 'cannot_update', 'label_taken'] }).map(
				(badge) => [badge.kind, badge.tone]
			)
		);
		expect(tones).toEqual({
			mirror: 'neutral',
			incomplete: 'destructive',
			duplicate: 'destructive',
			on_site: 'success',
			type_mismatch: 'warning',
			cannot_update: 'warning',
			label_taken: 'warning'
		});
	});
});

describe('missingRequired (MOD-6)', () => {
	it('MOD-6: names each required value that is blank after trimming, in form order', () => {
		expect(missingRequired(complete)).toEqual([]);
		expect(missingRequired({ targetEntityType: ' ', programmaticName: '', displayName: '', dataType: '' })).toEqual([
			'entity type',
			'display name',
			'programmatic name',
			'data type'
		]);
	});

	it('MOD-6: the sentence lists them', () => {
		expect(missingText(['display name'])).toBe('Missing display name.');
		expect(missingText(['entity type', 'display name'])).toBe('Missing entity type and display name.');
		expect(missingText(['entity type', 'display name', 'programmatic name'])).toBe('Missing entity type, display name and programmatic name.');
	});
});

describe('default value inputs (EDT-29, MOD-10)', () => {
	it('MOD-10: a checkbox default has three states', () => {
		expect(checkboxDefaultChoice(null)).toBe('none');
		expect(checkboxDefaultChoice(true)).toBe('checked');
		expect(checkboxDefaultChoice(false)).toBe('unchecked');
		expect(checkboxDefaultChoice('true')).toBe('none');
		expect(checkboxDefaultValue('none')).toBeNull();
		expect(checkboxDefaultValue('checked')).toBe(true);
		expect(checkboxDefaultValue('unchecked')).toBe(false);
	});

	it('MOD-10: a list default is text as typed, blank is none', () => {
		expect(listDefaultText('35mm')).toBe('35mm');
		expect(listDefaultText(null)).toBe('');
		expect(listDefaultText(true)).toBe('');
		expect(listDefaultValue('35mm ')).toBe('35mm ');
		expect(listDefaultValue('')).toBeNull();
	});
});

describe('nameWarning (EDT-25, B2, Q3)', () => {
	const row = { ...complete, displayName: 'Lens (serial)', programmaticName: 'sg_lens_serial', nameMode: 'manual' as const };

	it('B2: a typed name the site would not derive is called out, with the name it would give', () => {
		expect(nameWarning(row, false)).toBe(
			'The site would name a new field sg_lens__serial_. Install refuses to create it under another name.'
		);
	});

	it('B2: no warning when the name is the derived one, the field is on the site, or there is nothing to compare', () => {
		expect(nameWarning({ ...row, programmaticName: 'sg_lens__serial_' }, false)).toBeNull();
		expect(nameWarning(row, true)).toBeNull();
		expect(nameWarning({ ...row, programmaticName: ' ' }, false)).toBeNull();
		expect(nameWarning({ ...row, displayName: '' }, false)).toBeNull();
	});

	it('MOD-7: the site is sent the trimmed display name, so that is what the name is checked against', () => {
		expect(nameWarning({ ...row, displayName: ' Lens ', programmaticName: 'sg_lens' }, false)).toBeNull();
	});

	it('EDT-32: never on a mirror row', () => {
		expect(nameWarning({ ...row, dataType: 'calculated' }, false)).toBeNull();
	});
});
