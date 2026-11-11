import { describe, expect, it } from 'vitest';
import { CUSTOM_FIELD_PREFIX, hasNonAscii, predictFieldName } from './field-name';

// The cases are the ones the corpus measured (findings/019_create_fields).
describe('predictFieldName', () => {
	it('MOD-17: the prefix, then lowercase with one underscore per non-alphanumeric character', () => {
		expect(CUSTOM_FIELD_PREFIX).toBe('sg_');
		expect(predictFieldName('zzprobe 019 With (Parens)')).toBe('sg_zzprobe_019_with__parens_');
	});

	it('MOD-18: a display name that starts with the prefix gets it twice', () => {
		expect(predictFieldName('sg_zzprobe_019_already_prefixed')).toBe('sg_sg_zzprobe_019_already_prefixed');
	});

	it('MOD-19: a blank display name predicts nothing', () => {
		expect(predictFieldName('')).toBeNull();
		expect(predictFieldName('   ')).toBeNull();
	});

	it('MOD-20, B1: runs are not collapsed and underscores at the ends are kept', () => {
		expect(predictFieldName('Lens -- Height (Start)')).toBe('sg_lens____height__start_');
	});

	it('MOD-17: follows the ASCII rule measured by finding 117', () => {
		expect(predictFieldName('zzprobe 117 a--b..c!!d  e_f', 'currency')).toBe('sg_zzprobe_117_a__b__c__d__e_f');
		expect(predictFieldName('117 zzprobe digit', 'currency')).toBe('sg_117_zzprobe_digit');
		expect(predictFieldName('zzprobe 117 MiXed CASE', 'currency')).toBe('sg_zzprobe_117_mixed_case');
	});

	it('G11: any non-ASCII character gives sg_<data_type>, and nothing without a data type (finding 117)', () => {
		expect(predictFieldName('zzprobe 117 Durée Écran ñ', 'currency')).toBe('sg_currency');
		expect(predictFieldName('zzprobe 117 日本語 поле', 'currency')).toBe('sg_currency');
		expect(predictFieldName('Durée', 'text')).toBe('sg_text');
		expect(predictFieldName('Durée')).toBeNull();
	});

	it('hasNonAscii: true for an accent, a non-Latin letter or an emoji; false for ASCII punctuation', () => {
		for (const text of ['é', 'Lens ñ', '日本語', 'поле', 'a😀', 'a\u00a0b']) expect(hasNonAscii(text)).toBe(true);
		for (const text of ['', 'Lens -- Height (Start)', 'a\tb', '~!@#$%^&*()_+']) expect(hasNonAscii(text)).toBe(false);
	});
});
