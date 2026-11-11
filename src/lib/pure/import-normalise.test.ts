import { describe, expect, it } from 'vitest';
import { normaliseName } from './import-normalise';

describe('normaliseName', () => {
	it('IMP-27: a display name and its programmatic form come out equal', () => {
		expect(normaliseName('Tk Lens Height (Start)')).toBe('tk lens height start');
		expect(normaliseName('tk_lens_height_start')).toBe('tk lens height start');
	});

	it('IMP-27: trims, lowercases and makes each run of other characters one space', () => {
		expect(normaliseName('  Ball & Chart -- Captured!  ')).toBe('ball chart captured');
		expect(normaliseName('sg_ball_and_chart')).toBe('sg ball and chart');
		expect(normaliseName('Lens::Maximum Aperture')).toBe('lens maximum aperture');
	});

	it('IMP-27: keeps digits', () => {
		expect(normaliseName('Slates::Diagram1')).toBe('slates diagram1');
		expect(normaliseName('2nd Unit')).toBe('2nd unit');
	});

	it('IMP-27: a name of only punctuation or blanks normalises to empty', () => {
		expect(normaliseName('')).toBe('');
		expect(normaliseName('  ')).toBe('');
		expect(normaliseName('(--)')).toBe('');
	});

	it('IMP-27: accented letters are letters, so "Durée" and "Dur e" stay apart', () => {
		expect(normaliseName('Durée')).toBe('durée');
		expect(normaliseName('Dur e')).toBe('dur e');
		expect(normaliseName('DURÉE')).toBe('durée');
	});

	it('IMP-27: composed and decomposed accents come out equal', () => {
		expect(normaliseName('Durée')).toBe(normaliseName('Durée'));
	});

	it('IMP-27: letters and digits of any script are kept', () => {
		expect(normaliseName('Длина объектива')).toBe('длина объектива');
		expect(normaliseName('レンズ_番号')).toBe('レンズ 番号');
		expect(normaliseName('दूरी')).toBe('दूरी');
	});
});
