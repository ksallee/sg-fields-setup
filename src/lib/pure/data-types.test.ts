import { describe, expect, it } from 'vitest';
import { CREATABLE_DATA_TYPES, carries, dataTypeLabel, isCreatable, isMirror, settingsOf } from './data-types';

describe('creatable data types', () => {
	it('MOD-13: is the set the corpus measured as created (findings/019_create_fields)', () => {
		expect([...CREATABLE_DATA_TYPES].sort()).toEqual(
			[
				'text',
				'float',
				'number',
				'date',
				'date_time',
				'list',
				'url',
				'duration',
				'percent',
				'footage',
				'checkbox',
				'entity',
				'multi_entity'
			].sort()
		);
	});

	it('MOD-13, B9: leaves out color (refused) and what probe G3 has not measured', () => {
		for (const type of ['color', 'image', 'calculated', 'currency', 'status_list', 'timecode']) {
			expect(isCreatable(type)).toBe(false);
		}
	});

	it('MOD-13: matches the name exactly as FPT spells it', () => {
		expect(isCreatable('text')).toBe(true);
		expect(isCreatable('Text')).toBe(false);
		expect(isCreatable(' text')).toBe(false);
		expect(isCreatable('')).toBe(false);
	});
});

describe('isMirror', () => {
	it('MOD-14: any type read from a site that is not creatable is a mirror', () => {
		for (const dataType of ['calculated', 'summary', 'status_list', 'color', 'pivot_column']) {
			expect(isMirror({ dataType })).toBe(true);
		}
	});

	it('MOD-16: a type the tool has never heard of is a mirror, not "no type"', () => {
		expect(isMirror({ dataType: 'brand_new_type' })).toBe(true);
	});

	it('MOD-16: only an empty type is no type', () => {
		expect(isMirror({ dataType: '' })).toBe(false);
		expect(isMirror({ dataType: '  ' })).toBe(false);
	});

	it('MOD-13: a creatable type is not a mirror', () => {
		for (const dataType of CREATABLE_DATA_TYPES) expect(isMirror({ dataType })).toBe(false);
	});
});

describe('dataTypeLabel', () => {
	it('MOD-13: every creatable type has a label of its own', () => {
		const labels = CREATABLE_DATA_TYPES.map(dataTypeLabel);
		expect(new Set(labels).size).toBe(CREATABLE_DATA_TYPES.length);
		for (const type of CREATABLE_DATA_TYPES) expect(dataTypeLabel(type)).not.toBe(type);
		expect(dataTypeLabel('date_time')).toBe('Date and time');
		expect(dataTypeLabel('multi_entity')).toBe('Multi-entity link');
	});

	it('MOD-14: names the mirror types it knows', () => {
		expect(dataTypeLabel('status_list')).toBe('Status list');
		expect(dataTypeLabel('calculated')).toBe('Calculated');
	});

	it('MOD-16: shows an unknown type exactly as read', () => {
		expect(dataTypeLabel('brand_new_type')).toBe('brand_new_type');
	});
});

describe('settings a data type carries', () => {
	it('MOD-9: follows the table under "Type-specific settings"', () => {
		expect(settingsOf('entity')).toEqual(['validTypes']);
		expect(settingsOf('multi_entity')).toEqual(['validTypes']);
		expect(settingsOf('list')).toEqual(['validValues', 'defaultValue']);
		expect(settingsOf('status_list')).toEqual(['validValues', 'defaultValue']);
		expect(settingsOf('text')).toEqual(['uniquePerProject']);
		expect(settingsOf('number')).toEqual(['uniquePerProject']);
		expect(settingsOf('checkbox')).toEqual(['defaultValue']);
	});

	it('MOD-9: every other type carries none, known or not', () => {
		for (const type of ['float', 'date', 'date_time', 'url', 'duration', 'percent', 'footage', 'calculated', 'x', '']) {
			expect(settingsOf(type)).toEqual([]);
		}
	});

	it('MOD-9: carries answers for one setting', () => {
		expect(carries('list', 'validValues')).toBe(true);
		expect(carries('list', 'validTypes')).toBe(false);
		expect(carries('date', 'defaultValue')).toBe(false);
	});
});
