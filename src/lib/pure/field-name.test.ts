import { describe, expect, it } from 'vitest';
import { CUSTOM_FIELD_PREFIX, predictFieldName } from './field-name';

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
});
