import { describe, expect, it } from 'vitest';
import { compareCodeUnits, nameCollator } from './text-order';

describe('compareCodeUnits', () => {
	it('orders by code unit: capitals first, digits as characters', () => {
		expect(['b', 'B', 'a', '10', '2'].sort(compareCodeUnits)).toEqual(['10', '2', 'B', 'a', 'b']);
		expect(compareCodeUnits('a', 'a')).toBe(0);
	});
});

describe('nameCollator', () => {
	it('ignores case and accents and reads digits by value', () => {
		expect(['shot', 'CustomEntity10', 'CustomEntity2', 'Asset'].sort(nameCollator.compare)).toEqual([
			'Asset',
			'CustomEntity2',
			'CustomEntity10',
			'shot'
		]);
		expect(nameCollator.compare('Lens', 'lens')).toBe(0);
		expect(nameCollator.compare('Café', 'cafe')).toBe(0);
	});
});
