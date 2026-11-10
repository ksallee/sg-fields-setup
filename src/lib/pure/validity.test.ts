import { describe, expect, it } from 'vitest';
import { duplicatedIds, isIncomplete, isValidSetName, validateSet } from './validity';

function entry(id: string, targetEntityType = 'Shot', programmaticName = `sg_${id}`) {
	return { id, targetEntityType, programmaticName, displayName: id, dataType: 'text' };
}

describe('isValidSetName', () => {
	it('MOD-1: a blank or whitespace-only name is refused', () => {
		expect(isValidSetName('')).toBe(false);
		expect(isValidSetName(' \t\n')).toBe(false);
	});

	it('MOD-1: anything left after trimming is a name', () => {
		expect(isValidSetName(' Lens ')).toBe(true);
	});
});

describe('isIncomplete', () => {
	const complete = { targetEntityType: 'Shot', programmaticName: 'sg_lens', displayName: 'Lens', dataType: 'text' };

	it('MOD-6: an entry with its four required attributes is complete', () => {
		expect(isIncomplete(complete)).toBe(false);
	});

	it.each(['targetEntityType', 'programmaticName', 'displayName', 'dataType'] as const)(
		'MOD-6: blank %s makes it incomplete',
		(key) => {
			expect(isIncomplete({ ...complete, [key]: '' })).toBe(true);
			expect(isIncomplete({ ...complete, [key]: '   ' })).toBe(true);
		}
	);

	it('MOD-6, MOD-16: a mirror type counts as a data type', () => {
		expect(isIncomplete({ ...complete, dataType: 'calculated' })).toBe(false);
	});
});

describe('duplicatedIds', () => {
	it('MOD-5: distinct pairs are not duplicates', () => {
		const entries = [entry('a'), entry('b'), entry('c', 'Asset', 'sg_a')];
		expect(duplicatedIds(entries)).toEqual(new Set());
	});

	it('EDT-13: every member of a duplicated pair is reported, not only the later one', () => {
		const entries = [entry('a', 'Shot', 'sg_x'), entry('b'), entry('c', 'Shot', 'sg_x'), entry('d', 'Shot', 'sg_x')];
		expect(duplicatedIds(entries)).toEqual(new Set(['a', 'c', 'd']));
	});

	it('EDT-12: the pair is compared after trimming', () => {
		const entries = [entry('a', 'Shot', 'sg_x'), entry('b', ' Shot ', ' sg_x')];
		expect(duplicatedIds(entries)).toEqual(new Set(['a', 'b']));
	});

	it('MOD-5: the pair is compared as the site spells it, case and all', () => {
		const entries = [entry('a', 'Shot', 'sg_x'), entry('b', 'shot', 'sg_x'), entry('c', 'Shot', 'sg_X')];
		expect(duplicatedIds(entries)).toEqual(new Set());
	});

	it('EDT-12: entries missing either half of the pair are never counted', () => {
		const entries = [
			entry('a', '', 'sg_x'),
			entry('b', '  ', 'sg_x'),
			entry('c', 'Shot', ''),
			entry('d', 'Shot', ' '),
			entry('e', '', ''),
			entry('f', '', '')
		];
		expect(duplicatedIds(entries)).toEqual(new Set());
	});

	it('MOD-5: the type and the name do not run into each other', () => {
		const entries = [entry('a', 'Shot', 'x y'), entry('b', 'Shot x', 'y')];
		expect(duplicatedIds(entries)).toEqual(new Set());
	});
});

describe('validateSet', () => {
	it('EDT-12: a named set of complete, distinct entries is valid', () => {
		expect(validateSet('Lens', [entry('a'), entry('b')])).toEqual({
			valid: true,
			nameMissing: false,
			incompleteIds: [],
			duplicateIds: []
		});
	});

	it('EDT-12: a set with no entries is valid', () => {
		expect(validateSet('Lens', []).valid).toBe(true);
	});

	it('EDT-11, MOD-1: a blank name is reported', () => {
		expect(validateSet('  ', [entry('a')])).toMatchObject({ valid: false, nameMissing: true });
	});

	it('EDT-11, EDT-13: incomplete entries are listed in entry order, for the count and the row marks', () => {
		const entries = [entry('a'), { ...entry('b'), displayName: ' ' }, { ...entry('c'), dataType: '' }];
		expect(validateSet('Lens', entries)).toMatchObject({ valid: false, incompleteIds: ['b', 'c'], duplicateIds: [] });
	});

	it('EDT-11, EDT-13: duplicated entries are listed in entry order', () => {
		const entries = [entry('a', 'Shot', 'sg_x'), entry('b'), entry('c', 'Shot', 'sg_x')];
		expect(validateSet('Lens', entries)).toMatchObject({ valid: false, incompleteIds: [], duplicateIds: ['a', 'c'] });
	});

	it('EDT-13: an entry can be both incomplete and duplicated', () => {
		const entries = [{ ...entry('a', 'Shot', 'sg_x'), displayName: '' }, entry('b', 'Shot', 'sg_x')];
		expect(validateSet('Lens', entries)).toMatchObject({ incompleteIds: ['a'], duplicateIds: ['a', 'b'] });
	});
});
