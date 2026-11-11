import { describe, expect, it } from 'vitest';
import lens from '../../../fixtures/field-sets/camera-report-lens.json?raw';
import slate from '../../../fixtures/field-sets/camera-report-slate.json?raw';
import virtualProduction from '../../../fixtures/field-sets/camera-report-virtual-production.json?raw';
import weekly from '../../../fixtures/field-sets/weekly-status-report.json?raw';
import reviewNotes from '../../../fixtures/field-sets/review-notes.json';
import type { EntryDraft, FieldSet } from './model';
import {
	SET_FILE_FORMAT,
	SET_FILE_VERSION,
	decodeSetFile,
	encodeSetFile,
	refusalMessage,
	setFileName,
	type SetFileRefusal
} from './set-file';

const T0 = '2026-11-10T09:00:00.000Z';

const SET: FieldSet = {
	id: 'set-1',
	name: 'Lens',
	description: 'Lens fields.',
	origin: 'import',
	originDetails: { sourceFiles: 'report.xlsx', importedAt: T0 },
	createdAt: T0,
	changedAt: T0
};

function draft(overrides: Partial<EntryDraft> = {}): EntryDraft {
	return {
		targetEntityType: 'Shot',
		programmaticName: 'sg_lens',
		displayName: 'Lens',
		dataType: 'text',
		validTypes: [],
		validValues: [],
		defaultValue: null,
		description: null,
		uniquePerProject: false,
		snapshot: null,
		snapshotSite: null,
		snapshotTime: null,
		...overrides
	};
}

/** A set file's JSON text, from an object written in the test. */
function file(body: Record<string, unknown>): string {
	return JSON.stringify(body);
}

function minimal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		format: SET_FILE_FORMAT,
		version: SET_FILE_VERSION,
		name: 'Lens',
		description: null,
		origin: 'manual',
		originDetails: null,
		entries: [],
		...overrides
	};
}

function refusal(text: string): SetFileRefusal {
	const result = decodeSetFile(text);
	if (result.ok) throw new Error('expected a refusal');
	return result.refusal;
}

function decoded(text: string) {
	const result = decodeSetFile(text);
	if (!result.ok) throw new Error(refusalMessage(result.refusal));
	return result.set;
}

describe('encodeSetFile', () => {
	it('D1: writes the marker, the version, the set and its entries, and no ids or set times', () => {
		const { text } = encodeSetFile(SET, [draft()]);
		const body = JSON.parse(text);
		expect(Object.keys(body)).toEqual([
			'format',
			'version',
			'name',
			'description',
			'origin',
			'originDetails',
			'entries'
		]);
		expect(body.format).toBe(SET_FILE_FORMAT);
		expect(body.version).toBe(SET_FILE_VERSION);
		expect(Number.isInteger(body.version)).toBe(true);
		expect(body.originDetails).toEqual({ sourceFiles: 'report.xlsx', importedAt: T0 });
		expect(text).not.toContain('set-1');
		expect(text).not.toContain('createdAt');
		expect(text).not.toContain('changedAt');
	});

	it('D1: writes each entry with every definition and snapshot key, in the model order', () => {
		const entry = {
			...draft(),
			id: 'e1',
			setId: 'set-1',
			createdAt: T0,
			changedAt: T0
		};
		const body = JSON.parse(encodeSetFile(SET, [entry]).text);
		expect(Object.keys(body.entries[0])).toEqual([
			'targetEntityType',
			'programmaticName',
			'displayName',
			'dataType',
			'validTypes',
			'validValues',
			'defaultValue',
			'description',
			'uniquePerProject',
			'snapshot',
			'snapshotSite',
			'snapshotTime'
		]);
	});

	it('is pretty-printed with tabs and ends with a newline', () => {
		const { text } = encodeSetFile(SET, [draft()]);
		expect(text.endsWith('}\n')).toBe(true);
		expect(text).toContain('\n\t"format": ');
		expect(text).toContain('\n\t\t{\n\t\t\t"targetEntityType": "Shot",');
	});

	it('keeps the entries in the order given', () => {
		const body = JSON.parse(
			encodeSetFile(SET, [draft({ programmaticName: 'sg_b' }), draft({ programmaticName: 'sg_a' })]).text
		);
		expect(body.entries.map((e: EntryDraft) => e.programmaticName)).toEqual(['sg_b', 'sg_a']);
	});

	it('MOD-7, MOD-9: writes entries cleaned', () => {
		const body = JSON.parse(
			encodeSetFile(SET, [draft({ displayName: ' Lens ', validTypes: ['Shot'], description: ' ' })]).text
		);
		expect(body.entries[0]).toMatchObject({ displayName: 'Lens', validTypes: [], description: null });
	});

	it('writes a snapshot with its keys sorted at every depth, so two exports of one set match', () => {
		const snapshot = { name: { value: 'Lens', editable: true }, data_type: { value: 'text', editable: false } };
		const { text } = encodeSetFile(SET, [draft({ snapshot, snapshotSite: 'https://a.example', snapshotTime: T0 })]);
		const written = JSON.parse(text).entries[0].snapshot;
		expect(Object.keys(written)).toEqual(['data_type', 'name']);
		expect(Object.keys(written.name)).toEqual(['editable', 'value']);
		expect(written).toEqual(snapshot);
	});

	it('suggests a file name from the set name', () => {
		expect(encodeSetFile(SET, []).fileName).toBe('lens.fieldset.json');
	});

	it('gives the same text for the same set', () => {
		expect(encodeSetFile(SET, [draft()]).text).toBe(encodeSetFile({ ...SET }, [draft()]).text);
	});
});

describe('setFileName', () => {
	it.each([
		['On-set camera report: lens', 'on-set-camera-report-lens.fieldset.json'],
		['  Weekly   status report  ', 'weekly-status-report.fieldset.json'],
		['a/b\\c:d*e?f"g<h>i|j', 'a-b-c-d-e-f-g-h-i-j.fieldset.json'],
		['Équipe caméra', 'équipe-caméra.fieldset.json'],
		['撮影レポート', '撮影レポート.fieldset.json'],
		['...', 'set.fieldset.json'],
		['CON', 'con-set.fieldset.json'],
		['lpt1', 'lpt1-set.fieldset.json']
	])('%s gives %s', (name, expected) => {
		expect(setFileName(name)).toBe(expected);
	});

	it('caps the stem at 80 characters, never ending on a hyphen', () => {
		const stem = setFileName(`${'a'.repeat(79)} b`).replace('.fieldset.json', '');
		expect(stem).toBe('a'.repeat(79));
		expect([...setFileName('é'.repeat(200)).replace('.fieldset.json', '')]).toHaveLength(80);
	});
});

describe('decodeSetFile', () => {
	it('D1: reads back what encodeSetFile wrote', () => {
		const snapshot = { name: { value: 'Lens', editable: true } };
		const entries = [
			draft(),
			draft({
				programmaticName: 'sg_status',
				dataType: 'list',
				validValues: ['a', 'b'],
				defaultValue: 'a',
				description: 'State.',
				snapshot,
				snapshotSite: 'https://a.example',
				snapshotTime: T0
			}),
			draft({ programmaticName: 'sg_done', dataType: 'checkbox', defaultValue: false }),
			draft({ programmaticName: 'sg_code', uniquePerProject: true }),
			draft({ programmaticName: 'sg_shot', dataType: 'multi_entity', validTypes: ['Shot'] })
		];
		expect(decoded(encodeSetFile(SET, entries).text)).toEqual({
			name: 'Lens',
			description: 'Lens fields.',
			origin: 'import',
			originDetails: { sourceFiles: 'report.xlsx', importedAt: T0 },
			entries,
			duplicatesDropped: 0
		});
	});

	it('MOD-1: trims the name and the description; a blank description is none', () => {
		const set = decoded(file(minimal({ name: '  Lens ', description: '  ' })));
		expect(set.name).toBe('Lens');
		expect(set.description).toBeNull();
	});

	it('MOD-7, MOD-9: cleans each entry', () => {
		const set = decoded(
			file(minimal({ entries: [{ ...draft(), displayName: ' Lens ', validValues: ['x'], description: '' }] }))
		);
		expect(set.entries[0]).toEqual(draft());
	});

	it('fills a missing setting or snapshot key with none, so a short hand-written entry opens', () => {
		const set = decoded(
			file(
				minimal({
					entries: [{ targetEntityType: 'Shot', programmaticName: 'sg_lens', displayName: 'Lens', dataType: 'text' }]
				})
			)
		);
		expect(set.entries).toEqual([draft()]);
	});

	it('fills a missing description or origin details with none', () => {
		const body = minimal();
		delete body.description;
		delete body.originDetails;
		const set = decoded(file(body));
		expect(set.description).toBeNull();
		expect(set.originDetails).toBeNull();
	});

	it('ignores unknown keys at the top and in entries, so a newer file with additions still opens', () => {
		const set = decoded(
			file(minimal({ exportedBy: 'someone', entries: [{ ...draft(), colour: 'red' }], version: SET_FILE_VERSION }))
		);
		expect(set.entries).toEqual([draft()]);
		expect(set.entries[0]).not.toHaveProperty('colour');
	});

	it('MOD-6: lets incomplete entries in', () => {
		const set = decoded(file(minimal({ entries: [draft({ displayName: '  ', dataType: '' })] })));
		expect(set.entries).toEqual([draft({ displayName: '', dataType: '' })]);
	});

	it('IMP-48, MOD-5: keeps the first of a duplicated pair and counts the dropped ones', () => {
		const set = decoded(
			file(
				minimal({
					entries: [
						draft({ displayName: 'First' }),
						draft({ programmaticName: 'sg_other' }),
						draft({ programmaticName: ' sg_lens ', displayName: 'Second' }),
						draft({ displayName: 'Third' }),
						draft({ targetEntityType: 'Asset' })
					]
				})
			)
		);
		expect(set.entries.map((e) => [e.targetEntityType, e.programmaticName, e.displayName])).toEqual([
			['Shot', 'sg_lens', 'First'],
			['Shot', 'sg_other', 'Lens'],
			['Asset', 'sg_lens', 'Lens']
		]);
		expect(set.duplicatesDropped).toBe(2);
	});

	it('MOD-5: compares names case-sensitively and never drops an entry missing half its pair', () => {
		const set = decoded(
			file(
				minimal({
					entries: [
						draft({ programmaticName: 'sg_Lens' }),
						draft(),
						draft({ programmaticName: '' }),
						draft({ programmaticName: '' })
					]
				})
			)
		);
		expect(set.entries).toHaveLength(4);
		expect(set.duplicatesDropped).toBe(0);
	});

	it('Q6: keeps every origin, site capture included', () => {
		expect(decoded(file(minimal({ origin: 'site_capture' }))).origin).toBe('site_capture');
	});

	it('drops origin details from a set whose origin is not import', () => {
		const details = { sourceFiles: 'a.csv', importedAt: T0 };
		expect(decoded(file(minimal({ origin: 'manual', originDetails: details }))).originDetails).toBeNull();
	});

	it('reads a file with a byte order mark', () => {
		expect(decoded(`﻿${file(minimal())}`).name).toBe('Lens');
	});

	describe('refuses', () => {
		it.each([[''], ['{'], ['not json'], ['{"a":1,}']])('text that is not JSON: %j', (text) => {
			expect(refusal(text)).toEqual({ kind: 'notJson' });
		});

		it.each([
			['a list', '[]'],
			['a number', '3'],
			['null', 'null'],
			['an object with no marker', file({ name: 'Lens', entries: [] })],
			['another marker', file(minimal({ format: 'something-else' }))],
			['no version', file(minimal({ version: undefined }))],
			['a version as text', file(minimal({ version: '1' }))],
			['a fractional version', file(minimal({ version: 1.5 }))],
			['version 0', file(minimal({ version: 0 }))]
		])('JSON that is not a set file: %s', (_, text) => {
			expect(refusal(text)).toEqual({ kind: 'notSetFile' });
		});

		it('a newer version than this app reads, naming both', () => {
			expect(refusal(file(minimal({ version: SET_FILE_VERSION + 1 })))).toEqual({
				kind: 'newerVersion',
				version: SET_FILE_VERSION + 1,
				known: SET_FILE_VERSION
			});
		});

		it.each([[undefined], [null], [''], ['   ']])('MOD-1: a missing or blank name: %j', (name) => {
			expect(refusal(file(minimal({ name })))).toEqual({ kind: 'nameMissing' });
		});

		it.each([
			['name', 3, 'text', 'number'],
			['description', ['a'], 'textOrNone', 'list'],
			['origin', 'spreadsheet', 'origin', 'text'],
			['origin', null, 'origin', 'none'],
			['originDetails', 'a.csv', 'originDetailsOrNone', 'text'],
			['entries', {}, 'list', 'object'],
			['entries', undefined, 'list', 'missing']
		])('a set key of the wrong kind: %s = %j', (key, value, expected, found) => {
			expect(refusal(file(minimal({ origin: 'import', [key]: value })))).toEqual({
				kind: 'badSetValue',
				key,
				expected,
				found
			});
		});

		it.each([
			[{ importedAt: T0 }, 'originDetails.sourceFiles', 'text', 'missing'],
			[{ sourceFiles: 3, importedAt: T0 }, 'originDetails.sourceFiles', 'text', 'number'],
			[{ sourceFiles: 'a.csv' }, 'originDetails.importedAt', 'time', 'missing'],
			[{ sourceFiles: 'a.csv', importedAt: 'yesterday' }, 'originDetails.importedAt', 'time', 'text'],
			[{ sourceFiles: 'a.csv', importedAt: '2026-11-10' }, 'originDetails.importedAt', 'time', 'text']
		])('origin details of the wrong shape: %j', (details, key, expected, found) => {
			expect(refusal(file(minimal({ origin: 'import', originDetails: details })))).toEqual({
				kind: 'badSetValue',
				key,
				expected,
				found
			});
		});

		it.each([
			['text', 'x', 'text'],
			['a number', 4, 'number'],
			['a list', [], 'list'],
			['null', null, 'none']
		])('an entry that is %s, naming its position', (_, value, found) => {
			expect(refusal(file(minimal({ entries: [draft(), value] })))).toEqual({
				kind: 'entryNotObject',
				entry: 2,
				found
			});
		});

		it.each(['targetEntityType', 'programmaticName', 'displayName', 'dataType'] as const)(
			'MOD-6: an entry without %s',
			(key) => {
				const entry: Record<string, unknown> = { ...draft() };
				delete entry[key];
				expect(refusal(file(minimal({ entries: [entry] })))).toEqual({
					kind: 'entryKeyMissing',
					entry: 1,
					programmaticName: key === 'programmaticName' ? null : 'sg_lens',
					key
				});
			}
		);

		it.each([
			['displayName', 3, 'text', 'number'],
			['dataType', null, 'text', 'none'],
			['validTypes', 'Shot', 'listOfText', 'text'],
			['validValues', ['a', 2], 'listOfText', 'list'],
			['defaultValue', 3, 'defaultValue', 'number'],
			['defaultValue', ['a'], 'defaultValue', 'list'],
			['description', false, 'textOrNone', 'boolean'],
			['uniquePerProject', 'yes', 'boolean', 'text'],
			['uniquePerProject', null, 'boolean', 'none'],
			['snapshot', [], 'objectOrNone', 'list'],
			['snapshot', 'x', 'objectOrNone', 'text'],
			['snapshotSite', 1, 'textOrNone', 'number'],
			['snapshotTime', 'noon', 'timeOrNone', 'text']
		])('an entry key of the wrong kind: %s = %j, naming the entry and the key', (key, value, expected, found) => {
			expect(refusal(file(minimal({ entries: [draft(), draft({ programmaticName: 'sg_b' }), { ...draft(), [key]: value }] })))).toEqual({
				kind: 'badEntryValue',
				entry: 3,
				programmaticName: 'sg_lens',
				key,
				expected,
				found
			});
		});

		it('names an entry by position only when its programmatic name is not usable text', () => {
			expect(refusal(file(minimal({ entries: [{ ...draft(), programmaticName: 7 }] })))).toEqual({
				kind: 'badEntryValue',
				entry: 1,
				programmaticName: null,
				key: 'programmaticName',
				expected: 'text',
				found: 'number'
			});
			expect(refusal(file(minimal({ entries: [{ ...draft(), programmaticName: ' ', displayName: 1 }] })))).toMatchObject({
				programmaticName: null
			});
		});

		it('checks the version before anything else in the file', () => {
			expect(refusal(file(minimal({ version: 99, name: '' })))).toMatchObject({ kind: 'newerVersion' });
		});
	});
});

describe('refusalMessage', () => {
	it.each<[SetFileRefusal, string]>([
		[{ kind: 'notJson' }, 'This file is not valid JSON.'],
		[{ kind: 'notSetFile' }, 'This file is not a set file.'],
		[
			{ kind: 'newerVersion', version: 3, known: 1 },
			'This set file is version 3. This app reads up to version 1. Reload the app to update it.'
		],
		[{ kind: 'nameMissing' }, 'The set has no name.'],
		[
			{ kind: 'badSetValue', key: 'description', expected: 'textOrNone', found: 'list' },
			'"description" is a list. It should be text or null.'
		],
		[
			{ kind: 'badSetValue', key: 'entries', expected: 'list', found: 'missing' },
			'The file has no "entries".'
		],
		[
			{ kind: 'badSetValue', key: 'origin', expected: 'origin', found: 'text' },
			'"origin" should be import, manual or site_capture.'
		],
		[
			{ kind: 'badSetValue', key: 'originDetails.importedAt', expected: 'time', found: 'number' },
			'"originDetails.importedAt" is a number. It should be a time like 2026-11-10T09:00:00.000Z.'
		],
		[
			{ kind: 'badEntryValue', entry: 5, programmaticName: 'sg_x', key: 'uniquePerProject', expected: 'boolean', found: 'none' },
			'Entry 5 (sg_x): "uniquePerProject" is null. It should be true or false.'
		],
		[{ kind: 'entryNotObject', entry: 4, found: 'text' }, 'Entry 4 is text. It should be an object.'],
		[
			{ kind: 'entryKeyMissing', entry: 2, programmaticName: 'sg_lens', key: 'displayName' },
			'Entry 2 (sg_lens) has no "displayName".'
		],
		[
			{ kind: 'entryKeyMissing', entry: 2, programmaticName: null, key: 'programmaticName' },
			'Entry 2 has no "programmaticName".'
		],
		[
			{
				kind: 'badEntryValue',
				entry: 3,
				programmaticName: 'sg_lens',
				key: 'displayName',
				expected: 'text',
				found: 'number'
			},
			'Entry 3 (sg_lens): "displayName" is a number. It should be text.'
		],
		[
			{
				kind: 'badEntryValue',
				entry: 1,
				programmaticName: null,
				key: 'defaultValue',
				expected: 'defaultValue',
				found: 'list'
			},
			'Entry 1: "defaultValue" is a list. It should be true, false, text or null.'
		],
		[
			{
				kind: 'badEntryValue',
				entry: 1,
				programmaticName: null,
				key: 'snapshotTime',
				expected: 'timeOrNone',
				found: 'text'
			},
			'Entry 1: "snapshotTime" should be a time like 2026-11-10T09:00:00.000Z, or null.'
		]
	])('%j', (refused, message) => {
		expect(refusalMessage(refused)).toBe(message);
	});
});

describe('the hand-built sets are set files', () => {
	it.each([
		['camera-report-lens', lens],
		['camera-report-slate', slate],
		['camera-report-virtual-production', virtualProduction],
		['weekly-status-report', weekly]
	])('D1: %s decodes and encodes back to the same bytes', (_, text) => {
		const set = decoded(text);
		expect(set.entries.length).toBeGreaterThan(0);
		expect(set.duplicatesDropped).toBe(0);
		expect(encodeSetFile(set, set.entries).text).toBe(text);
	});

	it.each([
		['camera-report-lens.json', lens],
		['camera-report-slate.json', slate],
		['camera-report-virtual-production.json', virtualProduction],
		['weekly-status-report.json', weekly]
	] as const)('%s has review notes for exactly its entries, in order', (fileName, text) => {
		const notes = reviewNotes[fileName].entries.map((note) => note.programmaticName);
		expect(notes).toEqual(decoded(text).entries.map((e) => e.programmaticName));
	});
});
