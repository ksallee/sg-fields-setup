import { describe, expect, it } from 'vitest';
import { ENTRY_CATEGORIES } from './category';

describe('ENTRY_CATEGORIES', () => {
	it('EDT-36: on site first, then new, then needs attention', () => {
		expect(ENTRY_CATEGORIES).toEqual(['on_site', 'new', 'needs_attention']);
	});
});
