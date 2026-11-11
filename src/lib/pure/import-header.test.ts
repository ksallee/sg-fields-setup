import { describe, expect, it } from 'vitest';
import { DEFAULT_DELIMITER, splitHeader } from './import-header';

describe('splitHeader', () => {
	it('IMP-19: the default delimiter is two colons', () => {
		expect(DEFAULT_DELIMITER).toBe('::');
		expect(splitHeader('Slates::Shoot Date')).toEqual({ hint: 'Slates', fieldName: 'Shoot Date' });
	});

	it('IMP-18: both parts are trimmed', () => {
		expect(splitHeader('  Lens :: Maximum Aperture  ')).toEqual({ hint: 'Lens', fieldName: 'Maximum Aperture' });
	});

	it('IMP-18: splits at the last delimiter', () => {
		expect(splitHeader('Db::Slates::Slate')).toEqual({ hint: 'Db::Slates', fieldName: 'Slate' });
	});

	it('IMP-18: with three colons in a row, the last two are the delimiter', () => {
		expect(splitHeader('Slates:::Slate')).toEqual({ hint: 'Slates:', fieldName: 'Slate' });
	});

	it('IMP-18: no delimiter means no hint and the whole trimmed header is the field name', () => {
		expect(splitHeader(' Tk Take ')).toEqual({ hint: '', fieldName: 'Tk Take' });
		expect(splitHeader('Ratio: 1:2')).toEqual({ hint: '', fieldName: 'Ratio: 1:2' });
	});

	it('IMP-18: a blank left part is no hint', () => {
		expect(splitHeader('::Slate')).toEqual({ hint: '', fieldName: 'Slate' });
		expect(splitHeader('   :: Slate')).toEqual({ hint: '', fieldName: 'Slate' });
	});

	it('IMP-19: the user can change the delimiter', () => {
		expect(splitHeader('Lens.Closed Focus', '.')).toEqual({ hint: 'Lens', fieldName: 'Closed Focus' });
		expect(splitHeader('Slates::Slate', '.')).toEqual({ hint: '', fieldName: 'Slates::Slate' });
	});

	it('IMP-19: the delimiter is used as typed, spaces included', () => {
		expect(splitHeader('Tk Lens Height', ' ')).toEqual({ hint: 'Tk Lens', fieldName: 'Height' });
		expect(splitHeader('Slates::Slate', ' :: ')).toEqual({ hint: '', fieldName: 'Slates::Slate' });
	});

	it('IMP-19: an empty delimiter means no delimiter', () => {
		expect(splitHeader('Slates::Slate', '')).toEqual({ hint: '', fieldName: 'Slates::Slate' });
	});

	it('IMP-32: a blank header is no entry', () => {
		expect(splitHeader('')).toBeNull();
		expect(splitHeader('   ')).toBeNull();
		expect(splitHeader('', '')).toBeNull();
	});

	it('IMP-32: a header that is only a prefix is no entry', () => {
		expect(splitHeader('Slates::')).toBeNull();
		expect(splitHeader('Slates::   ')).toBeNull();
		expect(splitHeader('::')).toBeNull();
		expect(splitHeader('A::B::')).toBeNull();
	});
});
