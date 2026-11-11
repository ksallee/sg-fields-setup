import { describe, expect, it } from 'vitest';
import {
	formatValue,
	reasonParts,
	reasonText,
	reverseFieldsText,
	settingLabel,
	trashParts,
	type PlanReason,
	type ReasonCode
} from './plan-reason';

function reason(code: ReasonCode, more: Partial<PlanReason> = {}): PlanReason {
	return {
		code,
		entityType: 'Shot',
		programmaticName: 'sg_lens',
		displayName: 'Lens',
		dataType: 'text',
		setting: null,
		live: null,
		wanted: null,
		other: null,
		types: [],
		needsTrash: false,
		trashPageUrl: null,
		...more
	};
}

const ALL: PlanReason[] = [
	reason('type-conflict', { other: 'number' }),
	reason('incomplete'),
	reason('type-not-on-site', { entityType: 'CustomEntity19' }),
	reason('undeclared'),
	reason('no-data-type'),
	reason('non-ascii-name', { displayName: 'Durée', other: 'sg_text' }),
	reason('unreachable-name', { other: 'sg_lens_height' }),
	reason('label-taken', { other: 'sg_lens_1' }),
	reason('status-list-needs-values', { dataType: 'status_list', setting: 'validValues', wanted: [] }),
	reason('entity-needs-valid-types', { dataType: 'entity', setting: 'validTypes', wanted: [] }),
	reason('multi-entity-needs-one-valid-type', { dataType: 'multi_entity', setting: 'validTypes', wanted: ['Shot', 'Asset'] }),
	reason('default-not-in-values', { dataType: 'list', setting: 'defaultValue', live: 'a', wanted: 'zzz' }),
	reason('unique-cannot-change', { setting: 'unique', live: false, wanted: true }),
	reason('multi-entity-valid-types', { dataType: 'multi_entity', setting: 'validTypes', live: ['Shot'], wanted: ['Asset'], needsTrash: true }),
	reason('default-cannot-be-cleared', { dataType: 'list', setting: 'defaultValue', live: 'a', wanted: null }),
	reason('cannot-be-emptied', { setting: 'description', live: 'Old.', wanted: null }),
	reason('status-values-need-default', { dataType: 'status_list', setting: 'validValues', live: ['na', 'rev'], wanted: ['rev'], other: 'na' }),
	reason('valid-type-not-on-site', {
		dataType: 'entity',
		setting: 'validTypes',
		live: ['Shot'],
		wanted: ['Shot', 'asset'],
		types: [{ name: 'asset', meant: 'Asset' }]
	}),
	reason('valid-type-removed', {
		dataType: 'entity',
		setting: 'validTypes',
		live: ['Shot', 'Asset'],
		wanted: ['Shot'],
		types: [{ name: 'Asset', meant: null }]
	})
];

describe('formatValue', () => {
	it('RUN-3: none for an empty value, quotes for text, brackets for a list', () => {
		expect(formatValue(null)).toBe('none');
		expect(formatValue('')).toBe('none');
		expect(formatValue([])).toBe('none');
		expect(formatValue('beta')).toBe('"beta"');
		expect(formatValue(['Shot', 'Asset'])).toBe('[Shot, Asset]');
		expect(formatValue(false)).toBe('false');
		expect(formatValue({ a: 1 })).toBe('{"a":1}');
	});

	it('names each setting', () => {
		expect(settingLabel('displayName')).toBe('display name');
		expect(settingLabel('validTypes')).toBe('valid types');
	});
});

describe('reasonText', () => {
	it('RUN-21: every reason names the field by display and programmatic name', () => {
		for (const one of ALL) {
			expect(reasonText(one), one.code).toContain(`"${one.displayName}" (${one.entityType}.sg_lens)`);
		}
	});

	it('RUN-21: a reason about a setting names the setting, the live value and the wanted value', () => {
		expect(reasonText(ALL.find((one) => one.code === 'unique-cannot-change')!)).toBe(
			'"Lens" (Shot.sg_lens), unique: off on the site, on in the set. The API cannot change it. Change it by hand in Flow PT: open a Shot page, configure the field\'s column and turn the unique option on. Or turn it off in the set.'
		);
		expect(reasonText(ALL.find((one) => one.code === 'default-cannot-be-cleared')!)).toBe(
			'"Lens" (Shot.sg_lens), default value: "a" on the site, none in the set. The API cannot clear a default. It can only change it to another value. Clear it by hand in Flow PT, or give the field a default.'
		);
		expect(reasonText(ALL.find((one) => one.code === 'status-values-need-default')!)).toContain(
			'valid values: [na, rev] on the site, [rev] in the set. A status list\'s valid values must include its default, "na".'
		);
	});

	it('RUN-3: a type conflict shows both data types by their labels', () => {
		expect(reasonText(ALL[0])).toBe(
			'"Lens" (Shot.sg_lens) is a Number field on the site. The set wants Text. A field\'s data type cannot be changed. Install skips it. Change the field\'s data type to Number, or give the field another name.'
		);
	});

	it('PLN-14: a missing entity type says how to enable it', () => {
		expect(reasonText(ALL[2])).toBe(
			'"Lens" (CustomEntity19.sg_lens) is skipped. This site has no CustomEntity19 entity. Enable it in Flow PT\'s admin screens, then refresh.'
		);
	});

	it('PLN-15: an unreachable name shows both names', () => {
		const text = reasonText(ALL.find((one) => one.code === 'unreachable-name')!);
		expect(text).toContain('Shot.sg_lens');
		expect(text).toContain('sg_lens_height');
		expect(reasonText(ALL.find((one) => one.code === 'non-ascii-name')!)).toContain('calls the field sg_text');
	});

	it('PLN-16: a taken label names the live field', () => {
		expect(reasonText(ALL.find((one) => one.code === 'label-taken')!)).toContain('Shot.sg_lens_1 already has the display name "Lens"');
	});

	it('a multi-entity link says how many valid types the entry has', () => {
		expect(reasonText(ALL.find((one) => one.code === 'multi-entity-needs-one-valid-type')!)).toContain('The field has 2. Keep one.');
		expect(reasonText(reason('multi-entity-needs-one-valid-type', { setting: 'validTypes', wanted: [] }))).toContain('The field has none. Add one.');
	});

	it('finding 121: a valid type the site lacks, on an update, names the value, the API name meant and the hazard', () => {
		expect(reasonText(ALL.find((one) => one.code === 'valid-type-not-on-site')!)).toBe(
			'"Lens" (Shot.sg_lens), valid types: [Shot] on the site, [Shot, asset] in the set. This site has no entity type named "asset". "asset" is probably Asset. A valid type is the API name of an entity type, case included. On a field that exists, the site answers a name in the wrong case with a server error and retires the field. Install sends nothing. Correct the field.'
		);
	});

	it('finding 121: a valid type the site lacks, on a create, names every value and guesses only where it can', () => {
		const text = reasonText(
			reason('valid-type-not-on-site', {
				dataType: 'entity',
				setting: 'validTypes',
				wanted: ['shot', 'Camera Rig', 'ZzNoSuchType'],
				types: [
					{ name: 'shot', meant: 'Shot' },
					{ name: 'Camera Rig', meant: 'CustomEntity66' },
					{ name: 'ZzNoSuchType', meant: null }
				]
			})
		);
		expect(text).toBe(
			'"Lens" (Shot.sg_lens) cannot be created. Its valid types are [shot, Camera Rig, ZzNoSuchType]. This site has no entity type named "shot", "Camera Rig" or "ZzNoSuchType". "shot" is probably Shot. "Camera Rig" is probably CustomEntity66. A valid type is the API name of an entity type, case included. Correct the field.'
		);
		// The retirement was measured on an update only.
		expect(text).not.toContain('retires');
	});

	it('finding 121: a removed valid type says what the removal does, and only what was measured', () => {
		const removed = ALL.find((one) => one.code === 'valid-type-removed')!;
		expect(reasonText(removed)).toBe(
			'"Lens" (Shot.sg_lens), valid types: [Shot, Asset] on the site, [Shot] in the set. Removing Asset retires the reverse field of this link on Asset. A retired field keeps its name, so the name stays taken, and adding the type back makes a new field under a new name. Install skips the field. Keep Asset in the field, or remove it by hand in Flow PT.'
		);
		expect(
			reasonText({
				...removed,
				wanted: ['Task'],
				types: [
					{ name: 'Shot', meant: null },
					{ name: 'Asset', meant: null }
				]
			})
		).toMatch(/Removing Shot and Asset retires the reverse field of this link on each of them\..* Keep Shot and Asset in the field, or remove them by hand in Flow PT\.$/);
	});

	it('Copy: no HTML, no dash used as punctuation, in any reason', () => {
		for (const one of ALL) {
			const text = reasonText({ ...one, trashPageUrl: one.needsTrash ? 'https://studio.example/page/1234' : null });
			expect(text, one.code).not.toMatch(/[<>]/);
			expect(text, one.code).not.toMatch(/[—–]| - /);
		}
	});
});

describe('reverseFieldsText', () => {
	it('finding 121: says which types gain a reverse field', () => {
		expect(reverseFieldsText(['Shot'])).toBe('Also makes a reverse field on Shot. It takes a field name there for good.');
		expect(reverseFieldsText(['Shot', 'Asset'])).toBe('Also makes a reverse field on Shot and Asset. Each takes a field name there for good.');
		expect(reverseFieldsText(['Shot', 'Asset', 'Sequence'])).toBe(
			'Also makes a reverse field on Shot, Asset and Sequence. Each takes a field name there for good.'
		);
	});

	it('nothing to say when no reverse field is made', () => {
		expect(reverseFieldsText([])).toBeNull();
	});
});

describe('trash page', () => {
	const blocked = ALL.find((one) => one.code === 'multi-entity-valid-types')!;

	it('PLN-18, RUN-21: links to the trash page when the site has one', () => {
		const parts = reasonParts({ ...blocked, trashPageUrl: 'https://studio.example/page/1234' });
		expect(parts.map((part) => part.kind)).toEqual(['text', 'link', 'text']);
		expect(parts[1]).toEqual({ kind: 'link', text: 'the trash page for fields', href: 'https://studio.example/page/1234' });
		expect(reasonText({ ...blocked, trashPageUrl: 'https://studio.example/page/1234' })).toMatch(
			/delete it for good from the trash page for fields \(https:\/\/studio\.example\/page\/1234\)\.$/
		);
	});

	it('G10: gives the menu path in words when the site has no such page', () => {
		const parts = reasonParts(blocked);
		expect(parts).toHaveLength(1);
		expect(reasonText(blocked)).toMatch(/delete it for good from the trash for fields\. In Flow PT, open the admin menu, then Trash, then Fields\.$/);
	});

	it('trashParts: usable on its own by a run message', () => {
		expect(trashParts(null)).toHaveLength(1);
		expect(trashParts('https://studio.example/page/9')[0]).toMatchObject({ kind: 'link', href: 'https://studio.example/page/9' });
	});

	it('a reason that needs no trash has no link', () => {
		for (const one of ALL.filter((candidate) => !candidate.needsTrash)) {
			expect(reasonParts({ ...one, trashPageUrl: 'https://studio.example/page/1234' }).every((part) => part.kind === 'text'), one.code).toBe(true);
		}
	});
});
