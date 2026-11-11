import { describe, expect, it } from 'vitest';
import listing from './fixtures/live-version-fields.json';
import { readFields, type LiveField } from './live-field';
import type { EntryDefinition } from './model';
import { DIFF_SETTINGS, diffEntry, wantedDefault, wantedEntry, withoutRepeats } from './plan-diff';

function entry(overrides: Partial<EntryDefinition> = {}): EntryDefinition {
	return {
		targetEntityType: 'Version',
		programmaticName: 'sg_lens',
		displayName: 'Lens',
		dataType: 'text',
		validTypes: [],
		validValues: [],
		defaultValue: null,
		description: null,
		uniquePerProject: false,
		...overrides
	};
}

function live(overrides: Partial<LiveField> = {}): LiveField {
	return {
		entityType: 'Version',
		name: 'sg_lens',
		dataType: 'text',
		displayName: 'Lens',
		description: '',
		defaultValue: null,
		validValues: [],
		validTypes: [],
		unique: false,
		hideable: true,
		raw: {},
		...overrides
	};
}

const settings = (e: EntryDefinition, l: LiveField) => diffEntry(e, l).map((difference) => difference.setting);

describe('diffEntry', () => {
	it('PLN-7: finds nothing when every setting agrees', () => {
		expect(diffEntry(entry(), live())).toEqual([]);
	});

	it('lists differences in the fixed order, each with the live and the wanted value', () => {
		const differences = diffEntry(
			entry({
				displayName: 'Lens B',
				description: 'New.',
				dataType: 'list',
				defaultValue: 'b',
				validValues: ['a', 'b'],
				validTypes: [],
				uniquePerProject: false
			}),
			live({
				dataType: 'list',
				description: 'Old.',
				defaultValue: 'a',
				validValues: ['a'],
				validTypes: ['Shot'],
				unique: true
			})
		);
		expect(differences).toEqual([
			{ setting: 'displayName', live: 'Lens', wanted: 'Lens B' },
			{ setting: 'description', live: 'Old.', wanted: 'New.' },
			{ setting: 'defaultValue', live: 'a', wanted: 'b' },
			{ setting: 'validValues', live: ['a'], wanted: ['a', 'b'] },
			{ setting: 'validTypes', live: ['Shot'], wanted: [] },
			{ setting: 'unique', live: true, wanted: false }
		]);
		expect(differences.map((difference) => difference.setting)).toEqual([...DIFF_SETTINGS]);
	});

	describe('display name', () => {
		it('is equal after trimming both', () => {
			expect(diffEntry(entry({ displayName: ' Lens ' }), live({ displayName: 'Lens  ' }))).toEqual([]);
		});

		it('differs by case', () => {
			expect(diffEntry(entry({ displayName: 'lens' }), live())).toEqual([
				{ setting: 'displayName', live: 'Lens', wanted: 'lens' }
			]);
		});
	});

	describe('description', () => {
		it('is equal after trimming both', () => {
			expect(diffEntry(entry({ description: ' Focal. ' }), live({ description: 'Focal.  ' }))).toEqual([]);
		});

		it('none and blank are the same', () => {
			expect(diffEntry(entry({ description: null }), live({ description: '   ' }))).toEqual([]);
			expect(diffEntry(entry({ description: '  ' }), live({ description: '' }))).toEqual([]);
		});

		it('reports none as null', () => {
			expect(diffEntry(entry({ description: null }), live({ description: 'Old.' }))).toEqual([
				{ setting: 'description', live: 'Old.', wanted: null }
			]);
			expect(diffEntry(entry({ description: 'New.' }), live())).toEqual([
				{ setting: 'description', live: null, wanted: 'New.' }
			]);
		});
	});

	describe('default value', () => {
		it('PLN-12: a stray default on a type that carries none is never a difference', () => {
			expect(diffEntry(entry({ dataType: 'text', defaultValue: 'x' }), live({ defaultValue: 'y' }))).toEqual([]);
			expect(diffEntry(entry({ dataType: 'currency' }), live({ dataType: 'currency', defaultValue: 3 }))).toEqual([]);
		});

		it('none, missing and blank are the same on a list', () => {
			const wanted = entry({ dataType: 'list', validValues: ['a'] });
			for (const defaultValue of [null, undefined, '', '  ']) {
				expect(diffEntry(wanted, live({ dataType: 'list', validValues: ['a'], defaultValue }))).toEqual([]);
			}
		});

		it('differs by value on a list and a status list', () => {
			for (const dataType of ['list', 'status_list']) {
				expect(
					diffEntry(
						entry({ dataType, validValues: ['a', 'b'], defaultValue: 'b' }),
						live({ dataType, validValues: ['a', 'b'], defaultValue: 'a' })
					)
				).toEqual([{ setting: 'defaultValue', live: 'a', wanted: 'b' }]);
			}
		});

		it('reports a wanted none against a live default', () => {
			expect(
				diffEntry(entry({ dataType: 'list', validValues: ['a'] }), live({ dataType: 'list', validValues: ['a'], defaultValue: 'a' }))
			).toEqual([{ setting: 'defaultValue', live: 'a', wanted: null }]);
		});

		it('needs the same kind: a checkbox default stored as text differs from the boolean (finding 116)', () => {
			expect(diffEntry(entry({ dataType: 'checkbox', defaultValue: false }), live({ dataType: 'checkbox', defaultValue: 'false' }))).toEqual([
				{ setting: 'defaultValue', live: 'false', wanted: false }
			]);
			expect(diffEntry(entry({ dataType: 'checkbox', defaultValue: true }), live({ dataType: 'checkbox', defaultValue: true }))).toEqual([]);
		});

		it('PLN-13: a checkbox with no default wants false, the value its create sends', () => {
			const none = entry({ dataType: 'checkbox', defaultValue: null });
			expect(wantedDefault(none)).toBe(false);
			expect(diffEntry(none, live({ dataType: 'checkbox', defaultValue: false }))).toEqual([]);
			expect(diffEntry(none, live({ dataType: 'checkbox', defaultValue: null }))).toEqual([]);
			expect(diffEntry(none, live({ dataType: 'checkbox', defaultValue: true }))).toEqual([
				{ setting: 'defaultValue', live: true, wanted: false }
			]);
		});

		it('compares structured values by content', () => {
			const wanted = entry({ dataType: 'list', validValues: ['a'], defaultValue: 'a' });
			expect(settings(wanted, live({ dataType: 'list', validValues: ['a'], defaultValue: { value: 'a' } }))).toEqual(['defaultValue']);
		});

		it('wantedDefault: text for a list, null for none and for a type that carries none', () => {
			expect(wantedDefault(entry({ dataType: 'list', defaultValue: ' b ' }))).toBe('b');
			expect(wantedDefault(entry({ dataType: 'status_list', defaultValue: '  ' }))).toBeNull();
			expect(wantedDefault(entry({ dataType: 'checkbox', defaultValue: true }))).toBe(true);
			expect(wantedDefault(entry({ dataType: 'text', defaultValue: 'x' }))).toBeNull();
		});
	});

	describe('valid values', () => {
		it('list: same values in the same order', () => {
			const wanted = entry({ dataType: 'list', validValues: ['a', 'b'] });
			expect(diffEntry(wanted, live({ dataType: 'list', validValues: ['a', 'b'] }))).toEqual([]);
			expect(diffEntry(wanted, live({ dataType: 'list', validValues: ['b', 'a'] }))).toEqual([
				{ setting: 'validValues', live: ['b', 'a'], wanted: ['a', 'b'] }
			]);
		});

		it('status list: same set, order does not matter', () => {
			const wanted = entry({ dataType: 'status_list', validValues: ['ip', 'fin', 'wtg'] });
			expect(diffEntry(wanted, live({ dataType: 'status_list', validValues: ['wtg', 'ip', 'fin'] }))).toEqual([]);
		});

		it('status list: different sizes differ even with overlap', () => {
			const wanted = entry({ dataType: 'status_list', validValues: ['ip', 'fin'] });
			expect(settings(wanted, live({ dataType: 'status_list', validValues: ['ip', 'fin', 'wtg'] }))).toEqual(['validValues']);
			expect(settings(wanted, live({ dataType: 'status_list', validValues: ['ip'] }))).toEqual(['validValues']);
			expect(settings(wanted, live({ dataType: 'status_list', validValues: ['ip', 'wtg'] }))).toEqual(['validValues']);
		});

		it('any other type: always equal, whatever either side holds', () => {
			expect(diffEntry(entry({ dataType: 'text', validValues: ['a'] }), live({ validValues: ['z', 'y'] }))).toEqual([]);
			expect(diffEntry(entry({ dataType: 'entity', validTypes: ['Shot'] }), live({ dataType: 'entity', validTypes: ['Shot'], validValues: ['z'] }))).toEqual([]);
		});

		it('PLN-11: an empty list and none are the same', () => {
			expect(diffEntry(entry({ dataType: 'list', validValues: [] }), live({ dataType: 'list', validValues: [] }))).toEqual([]);
			expect(diffEntry(entry({ dataType: 'list', validValues: [' ', ''] }), live({ dataType: 'list' }))).toEqual([]);
		});
	});

	describe('valid types', () => {
		it('same types in the same order', () => {
			const wanted = entry({ dataType: 'entity', validTypes: ['Shot', 'Asset'] });
			expect(diffEntry(wanted, live({ dataType: 'entity', validTypes: ['Shot', 'Asset'] }))).toEqual([]);
			expect(diffEntry(wanted, live({ dataType: 'entity', validTypes: ['Asset', 'Shot'] }))).toEqual([
				{ setting: 'validTypes', live: ['Asset', 'Shot'], wanted: ['Shot', 'Asset'] }
			]);
		});

		it('PLN-11: an empty list and none are the same', () => {
			expect(diffEntry(entry(), live({ validTypes: [] }))).toEqual([]);
		});
	});

	describe('finding 121: repeated values', () => {
		it('withoutRepeats: the first occurrence is kept, the order otherwise preserved', () => {
			expect(withoutRepeats(['b', 'a', 'b', 'c', 'a'])).toEqual(['b', 'a', 'c']);
			expect(withoutRepeats([])).toEqual([]);
			expect(withoutRepeats(['Shot', 'shot'])).toEqual(['Shot', 'shot']);
		});

		it('wantedEntry: cleaned, with no repeat in valid values or valid types', () => {
			const wanted = wantedEntry(entry({ dataType: 'list', displayName: ' Lens ', validValues: ['alpha', ' alpha ', 'beta'] }));
			expect(wanted).toMatchObject({ displayName: 'Lens', validValues: ['alpha', 'beta'] });
			expect(wantedEntry(entry({ dataType: 'entity', validTypes: ['Shot', 'Shot', 'Asset'] })).validTypes).toEqual(['Shot', 'Asset']);
			expect(wantedEntry(entry({ dataType: 'status_list', validValues: ['na', 'vwd', 'na'] })).validValues).toEqual(['na', 'vwd']);
		});

		it('PLN-20: a list read back without its repeats matches the entry that holds them', () => {
			// Measured: ["alpha","alpha","beta"] reads back ["alpha","beta"].
			const wanted = entry({ dataType: 'list', validValues: ['alpha', 'alpha', 'beta'] });
			expect(diffEntry(wanted, live({ dataType: 'list', validValues: ['alpha', 'beta'] }))).toEqual([]);
		});

		it('PLN-20: valid types read back without their repeats match the entry that holds them', () => {
			// Measured: ["Shot","Shot","Asset"] reads back ["Shot","Asset"].
			const wanted = entry({ dataType: 'entity', validTypes: ['Shot', 'Shot', 'Asset'] });
			expect(diffEntry(wanted, live({ dataType: 'entity', validTypes: ['Shot', 'Asset'] }))).toEqual([]);
		});

		it('a difference carries the wanted list without repeats: it is what gets written', () => {
			const wanted = entry({ dataType: 'list', validValues: ['alpha', 'alpha', 'beta', 'gamma'] });
			expect(diffEntry(wanted, live({ dataType: 'list', validValues: ['alpha', 'beta'] }))).toEqual([
				{ setting: 'validValues', live: ['alpha', 'beta'], wanted: ['alpha', 'beta', 'gamma'] }
			]);
		});

		it('status list: a code the site stored twice differs from the entry, which never sends a repeat', () => {
			// Measured: a status list keeps a repeated code, ["na","vwd","apr","na"].
			const wanted = entry({ dataType: 'status_list', validValues: ['na', 'vwd', 'apr', 'na'] });
			expect(diffEntry(wanted, live({ dataType: 'status_list', validValues: ['apr', 'na', 'vwd'] }))).toEqual([]);
			expect(diffEntry(wanted, live({ dataType: 'status_list', validValues: ['na', 'vwd', 'apr', 'na'] }))).toEqual([
				{ setting: 'validValues', live: ['na', 'vwd', 'apr', 'na'], wanted: ['na', 'vwd', 'apr'] }
			]);
		});

		it('status list: two lists of the same size are not equal through their repeats', () => {
			const wanted = entry({ dataType: 'status_list', validValues: ['na', 'vwd', 'vwd'] });
			expect(settings(wanted, live({ dataType: 'status_list', validValues: ['na', 'na', 'vwd'] }))).toEqual(['validValues']);
		});
	});

	describe('unique', () => {
		it('same boolean; missing is off', () => {
			expect(diffEntry(entry({ uniquePerProject: true }), live({ unique: true }))).toEqual([]);
			expect(diffEntry(entry({ uniquePerProject: true }), live({ unique: false }))).toEqual([
				{ setting: 'unique', live: false, wanted: true }
			]);
			expect(diffEntry(entry(), live({ unique: true }))).toEqual([{ setting: 'unique', live: true, wanted: false }]);
		});
	});

	it('does not alter the entry or the live field', () => {
		const wanted = entry({ dataType: 'list', validValues: [' a ', 'b'], displayName: ' Lens ' });
		const before = structuredClone(wanted);
		const field = live({ dataType: 'list', validValues: ['b'] });
		const fieldBefore = structuredClone(field);
		diffEntry(wanted, field);
		expect(wanted).toEqual(before);
		expect(field).toEqual(fieldBefore);
	});

	it('reads a field of the live fixture as matching the entry that describes it', () => {
		const fields = readFields('Version', listing.data);
		const type = fields.find((field) => field.name === 'sg_version_type')!;
		expect(
			diffEntry(
				entry({
					programmaticName: 'sg_version_type',
					displayName: 'Type',
					dataType: 'list',
					validValues: ['Type A', 'Type B', 'Type C'],
					defaultValue: 'Type A'
				}),
				type
			)
		).toEqual([]);
		const seed = fields.find((field) => field.name === 'sg_ai_seed')!;
		expect(diffEntry(entry({ programmaticName: 'sg_ai_seed', displayName: 'ai seed', uniquePerProject: true }), seed)).toEqual([]);
	});
});
