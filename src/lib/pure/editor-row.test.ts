import { describe, expect, it } from 'vitest';
import {
	checkboxDefaultChoice,
	checkboxDefaultValue,
	listDefaultText,
	listDefaultValue,
	missingRequired,
	missingText,
	nonAsciiNameWarning,
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

	it('PLN-15, PLN-16: a create the plan would refuse reads "Cannot create"', () => {
		expect(rowBadges({ mirror: false, incomplete: false, duplicated: false, markers: ['cannot_create'] })).toEqual([
			{ kind: 'cannot_create', label: 'Cannot create', tone: 'warning' }
		]);
	});

	it('CMP-9: on site reads as fine, the others as trouble', () => {
		const tones = Object.fromEntries(
			rowBadges({ mirror: true, incomplete: true, duplicated: true, markers: ['on_site', 'type_mismatch', 'cannot_update', 'cannot_create', 'label_taken'] }).map(
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
			cannot_create: 'warning',
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

/*
 * Was `nameWarning`, which also judged a typed name against the name the site would derive (B2,
 * PLN-15). That check is the planner's: with a site, the comparison asks it and the open row
 * shows its reason (compare.test.ts, `unreachable-name` and `non-ascii-name`). What stays here is
 * the one hint that needs no site.
 */
describe('nonAsciiNameWarning (EDT-25, G11): where the planner has no say', () => {
	const row = { ...complete, displayName: 'Durée', programmaticName: 'sg_text', nameMode: 'derived' as const };

	it('G11, PLN-15: a non-ASCII display name on a derived name says why, with the name the site would give', () => {
		expect(nonAsciiNameWarning(row)).toBe(
			'The display name holds a character outside ASCII. The site would name a new field sg_text. Install refuses to create it. Use an ASCII display name.'
		);
		expect(nonAsciiNameWarning({ ...row, dataType: '' })).toBe(
			'The display name holds a character outside ASCII. The site would name a new field after its data type. Install refuses to create it. Use an ASCII display name.'
		);
	});

	it('says nothing of an ASCII display name', () => {
		expect(nonAsciiNameWarning({ ...row, displayName: ' Lens ' })).toBeNull();
		expect(nonAsciiNameWarning({ ...row, displayName: '' })).toBeNull();
	});

	it('says nothing of a typed name: without the site\'s fields it may be a field that exists', () => {
		expect(nonAsciiNameWarning({ ...row, nameMode: 'manual' })).toBeNull();
	});

	it('EDT-32: never on a mirror row', () => {
		expect(nonAsciiNameWarning({ ...row, dataType: 'calculated' })).toBeNull();
	});
});

describe('nameWarningFor: when the form says it (audit finding 6)', () => {
	const row = { ...complete, displayName: 'Durée', programmaticName: 'sg_text', nameMode: 'derived' as const };

	it('G11: where the planner has not judged the row, the form warns', async () => {
		const { nameWarningFor } = await import('./editor-row');
		expect(nameWarningFor(row, null)).toBe(nonAsciiNameWarning(row));
		expect(nameWarningFor(row, undefined)).toBe(nonAsciiNameWarning(row));
	});

	it('PLN-15: where the planner has judged it, its reason is among the notes and the form adds nothing', async () => {
		const { nameWarningFor } = await import('./editor-row');
		expect(nameWarningFor(row, 'refused')).toBeNull();
		expect(nameWarningFor(row, 'create')).toBeNull();
	});
});
