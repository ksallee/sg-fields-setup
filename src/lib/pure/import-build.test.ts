import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMMON_ENTITY_TYPES } from '$lib/io/schema';
import { makeLiveField } from './fixtures/make-live-field';
import {
	bucketColumnCount,
	bucketFromCsv,
	bucketsFromWorkbook,
	buildEntries,
	canConfirm,
	defaultSetName,
	importBannerText,
	importFooterText,
	importSuccessText,
	importTotals,
	inferFallback,
	resolvedEntityTypes,
	type ImportBucket,
	type ImportSite
} from './import-build';
import type { LiveField } from './live-field';
import { readXlsx } from './xlsx';

const NOW = '2026-11-10T09:00:00.000Z';
const URL_ = 'https://studio.shotgrid.autodesk.com';

function bucket(headers: string[], rows: string[][] = [], extra: Partial<ImportBucket> = {}): ImportBucket {
	return { label: 'a.csv', fileName: 'a.csv', worksheet: null, table: { headers, rows }, fallback: '', ...extra };
}

describe('buckets (IMP-6, IMP-8)', () => {
	it('IMP-6: a CSV is one bucket, labelled with its file name, no worksheet, no fallback', () => {
		const table = { headers: ['A'], rows: [] };
		expect(bucketFromCsv('shots.csv', table)).toEqual({
			label: 'shots.csv',
			fileName: 'shots.csv',
			worksheet: null,
			table,
			fallback: ''
		});
	});

	it('IMP-6: one bucket per sheet with a header, in workbook order, labelled with file and sheet', () => {
		const sheets = [
			{ name: 'Slates', table: { headers: ['A'], rows: [] } },
			{ name: 'Empty', table: { headers: ['', ' '], rows: [] } },
			{ name: 'Lenses', table: { headers: ['B', 'C'], rows: [] } }
		];
		const buckets = bucketsFromWorkbook('report.xlsx', sheets);
		expect(buckets.map((b) => b.label)).toEqual(['report.xlsx (Slates)', 'report.xlsx (Lenses)']);
		expect(buckets.map((b) => b.worksheet)).toEqual(['Slates', 'Lenses']);
		expect(buckets.every((b) => b.fileName === 'report.xlsx' && b.fallback === '')).toBe(true);
	});
});

describe('column counts and footer (IMP-8, IMP-10)', () => {
	it('IMP-8: a bucket counts its non-blank headers', () => {
		expect(bucketColumnCount(bucket(['A', '', 'B', '  ']))).toBe(2);
	});

	it('IMP-10: totals over all buckets', () => {
		expect(importTotals([bucket(['A', 'B']), bucket(['C'])])).toEqual({ columns: 3, buckets: 2 });
		expect(importTotals([])).toEqual({ columns: 0, buckets: 0 });
	});

	it('IMP-10: the footer gets singular and plural right', () => {
		expect(importFooterText([bucket(['A'])])).toBe('1 column in 1 bucket.');
		expect(importFooterText([bucket(['A', 'B']), bucket(['C'])])).toBe('3 columns in 2 buckets.');
		expect(importFooterText([])).toBe('0 columns in 0 buckets.');
	});
});

const SHOT_FIELDS: LiveField[] = [
	makeLiveField('Shot', 'code', { displayName: 'Shot Code' }),
	makeLiveField('Shot', 'sg_fps', { displayName: 'FPS', dataType: 'float' }),
	makeLiveField('Shot', 'sg_cut_in', { displayName: 'Cut In', dataType: 'number' })
];
const ASSET_FIELDS: LiveField[] = [
	makeLiveField('Asset', 'code', { displayName: 'Asset Name' }),
	makeLiveField('Asset', 'sg_fps', { displayName: 'FPS', dataType: 'float' }),
	makeLiveField('Asset', 'sg_asset_type', { displayName: 'Type', dataType: 'list' })
];

describe('inferFallback (IMP-15)', () => {
	const fieldsByType = new Map([
		['Shot', SHOT_FIELDS],
		['Asset', ASSET_FIELDS]
	]);

	it('IMP-15: the common type whose fields match the most headers', () => {
		expect(inferFallback(bucket(['Asset Name', 'Type', 'Cut In']), fieldsByType, COMMON_ENTITY_TYPES)).toBe('Asset');
		expect(inferFallback(bucket(['Shot Code', 'Cut In', 'Type']), fieldsByType, COMMON_ENTITY_TYPES)).toBe('Shot');
	});

	it('IMP-15: matches on the field name, the prefix cut', () => {
		expect(inferFallback(bucket(['X::Asset Name', 'X::Type']), fieldsByType, COMMON_ENTITY_TYPES)).toBe('Asset');
		expect(inferFallback(bucket(['X|Asset Name']), fieldsByType, COMMON_ENTITY_TYPES, '|')).toBe('Asset');
	});

	it('IMP-15: a tie goes to the earlier type in the common order', () => {
		expect(inferFallback(bucket(['FPS']), fieldsByType, COMMON_ENTITY_TYPES)).toBe('Shot');
		expect(inferFallback(bucket(['FPS']), fieldsByType, ['Asset', 'Shot'])).toBe('Asset');
	});

	it('IMP-15: zero matches, or no listings, gives nothing', () => {
		expect(inferFallback(bucket(['Nothing here']), fieldsByType, COMMON_ENTITY_TYPES)).toBeNull();
		expect(inferFallback(bucket(['FPS']), new Map(), COMMON_ENTITY_TYPES)).toBeNull();
		expect(inferFallback(bucket([]), fieldsByType, COMMON_ENTITY_TYPES)).toBeNull();
	});

	it('IMP-15: only the common types count, whatever else the lookup holds', () => {
		const withCustom = new Map([...fieldsByType, ['CustomEntity19', [makeLiveField('CustomEntity19', 'sg_a', { displayName: 'A' })]]]);
		expect(inferFallback(bucket(['A']), withCustom, COMMON_ENTITY_TYPES)).toBeNull();
	});
});

const TYPES = [
	{ name: 'Shot', displayName: 'Shot' },
	{ name: 'Asset', displayName: 'Asset' },
	{ name: 'CustomEntity19', displayName: 'Lens' }
];

describe('resolvedEntityTypes (IMP-29)', () => {
	const buckets = [
		bucket(['Lenses::Serial', 'Plain', 'Asset::Name'], [], { fallback: 'Shot' }),
		bucket(['Other', 'Lens::Mount'], [], { worksheet: 'Assets', fallback: '' })
	];

	it('IMP-29: the distinct target types, first seen first, none empty', () => {
		expect(resolvedEntityTypes(buckets, 'automatic', '::', TYPES)).toEqual(['CustomEntity19', 'Shot', 'Asset']);
	});

	it('IMP-29: follows the mode', () => {
		expect(resolvedEntityTypes(buckets, 'worksheet', '::', TYPES)).toEqual(['Shot', 'Asset']);
		expect(resolvedEntityTypes(buckets, 'header_prefix', '::', TYPES)).toEqual(['CustomEntity19', 'Shot', 'Asset']);
	});

	it('IMP-29: blank and prefix-only headers resolve nothing', () => {
		expect(resolvedEntityTypes([bucket(['', 'Asset::'], [], { fallback: 'Shot' })], 'automatic', '::', TYPES)).toEqual([]);
	});

	it('IMP-52: without a site there is nothing to read', () => {
		expect(resolvedEntityTypes(buckets, 'automatic', '::', null)).toEqual([]);
	});
});

describe('buildEntries (IMP-30 to IMP-32, IMP-48, IMP-52)', () => {
	const site: ImportSite = {
		url: URL_,
		entityTypes: TYPES,
		fieldsByType: new Map([['Shot', SHOT_FIELDS]])
	};

	it('IMP-30: a matched column mirrors the live field, with snapshot and site', () => {
		const { entries } = buildEntries({ buckets: [bucket(['fps'], [['x']], { fallback: 'Shot' })], mode: 'automatic', delimiter: '::', site, importedAt: NOW });
		expect(entries).toEqual([
			{
				targetEntityType: 'Shot',
				programmaticName: 'sg_fps',
				displayName: 'FPS',
				dataType: 'float',
				validTypes: [],
				validValues: [],
				defaultValue: null,
				description: null,
				uniquePerProject: false,
				snapshot: SHOT_FIELDS[1].raw,
				snapshotSite: URL_,
				snapshotTime: null
			}
		]);
	});

	it('IMP-31: an unmatched column gets the predicted name and the guessed type, nothing else', () => {
		const { entries } = buildEntries({
			buckets: [bucket(['Lens::Focal (mm)'], [['50'], ['35.5']], { fallback: 'Shot' })],
			mode: 'automatic',
			delimiter: '::',
			site,
			importedAt: NOW
		});
		expect(entries).toEqual([
			{
				targetEntityType: 'CustomEntity19',
				programmaticName: 'sg_focal__mm_',
				displayName: 'Focal (mm)',
				dataType: 'float',
				validTypes: [],
				validValues: [],
				defaultValue: null,
				description: null,
				uniquePerProject: false,
				snapshot: null,
				snapshotSite: null,
				snapshotTime: null
			}
		]);
	});

	it('IMP-31: guesses from its own column, values read by position', () => {
		const { entries } = buildEntries({
			buckets: [bucket(['', 'Done', 'When'], [['x', 'yes', '2026-01-02'], ['y', 'no']], { fallback: 'Shot' })],
			mode: 'automatic',
			delimiter: '::',
			site: null,
			importedAt: NOW
		});
		expect(entries.map((e) => e.dataType)).toEqual(['checkbox', 'date']);
	});

	it('IMP-32: blank and prefix-only headers make no entry', () => {
		const { entries } = buildEntries({
			buckets: [bucket(['', '  ', 'Shot::', 'Name'], [], { fallback: 'Shot' })],
			mode: 'automatic',
			delimiter: '::',
			site: null,
			importedAt: NOW
		});
		expect(entries.map((e) => e.displayName)).toEqual(['Name']);
	});

	it('IMP-25: nothing resolves and no fallback leaves the target type empty', () => {
		const { entries } = buildEntries({ buckets: [bucket(['Name'])], mode: 'automatic', delimiter: '::', site, importedAt: NOW });
		expect(entries[0].targetEntityType).toBe('');
		expect(entries[0].snapshot).toBeNull();
	});

	it('IMP-48: concatenates in bucket order and drops later duplicates on (type, name), counting them', () => {
		const { entries, dropped } = buildEntries({
			buckets: [
				bucket(['Name', 'FPS', 'Name'], [], { fallback: 'Shot' }),
				bucket(['sg_fps', 'Name', 'Asset::Name'], [], { fallback: 'Shot', fileName: 'b.csv', label: 'b.csv' })
			],
			mode: 'automatic',
			delimiter: '::',
			site,
			importedAt: NOW
		});
		expect(entries.map((e) => `${e.targetEntityType}.${e.programmaticName}`)).toEqual(['Shot.sg_name', 'Shot.sg_fps', 'Asset.sg_name']);
		expect(dropped).toBe(3);
	});

	it('IMP-48: the first occurrence wins, matched or not', () => {
		const { entries } = buildEntries({
			buckets: [bucket(['sg fps', 'FPS'], [['x']], { fallback: 'Shot' })],
			mode: 'automatic',
			delimiter: '::',
			site: { ...site, fieldsByType: new Map() },
			importedAt: NOW
		});
		// No live fields: "sg fps" predicts sg_sg_fps, "FPS" predicts sg_fps. Both stay.
		expect(entries.map((e) => e.programmaticName)).toEqual(['sg_sg_fps', 'sg_fps']);
	});

	it('MOD-5, EDT-12: entries with an empty target type are never duplicates', () => {
		const { entries, dropped } = buildEntries({ buckets: [bucket(['Name', 'Name'])], mode: 'automatic', delimiter: '::', site: null, importedAt: NOW });
		expect(entries).toHaveLength(2);
		expect(dropped).toBe(0);
	});

	it('IMP-49: origin details: distinct file names in bucket order, the time given', () => {
		const { originDetails } = buildEntries({
			buckets: [
				bucket(['A'], [], { fileName: 'r.xlsx' }),
				bucket(['B'], [], { fileName: 'shots.csv' }),
				bucket(['C'], [], { fileName: 'r.xlsx' })
			],
			mode: 'automatic',
			delimiter: '::',
			site: null,
			importedAt: NOW
		});
		expect(originDetails).toEqual({ sourceFiles: 'r.xlsx, shots.csv', importedAt: NOW });
	});

	it('IMP-52: without a site, prefixes do not resolve and the fallback is used as typed', () => {
		const { entries } = buildEntries({
			buckets: [bucket(['Lens::FPS'], [['24']], { fallback: ' shot ' })],
			mode: 'automatic',
			delimiter: '::',
			site: null,
			importedAt: NOW
		});
		expect(entries[0]).toMatchObject({ targetEntityType: 'shot', programmaticName: 'sg_fps', displayName: 'FPS', dataType: 'number', snapshot: null });
	});

	it('G11, IMP-48: non-ASCII headers get no predicted name, so two of them are both kept', () => {
		const { entries, dropped } = buildEntries({
			buckets: [bucket(['Durée', 'Début'], [['a', 'b']], { fallback: 'Shot' })],
			mode: 'automatic',
			delimiter: '::',
			site: null,
			importedAt: NOW
		});
		expect(dropped).toBe(0);
		expect(entries.map((one) => [one.displayName, one.programmaticName])).toEqual([
			['Durée', ''],
			['Début', '']
		]);
	});

	it('no buckets builds nothing', () => {
		expect(buildEntries({ buckets: [], mode: 'automatic', delimiter: '::', site: null, importedAt: NOW })).toEqual({
			entries: [],
			dropped: 0,
			originDetails: { sourceFiles: '', importedAt: NOW }
		});
	});
});

describe('canConfirm (IMP-11)', () => {
	const ready = { saving: false, setName: 'Camera report', buckets: [bucket(['A'], [], { fallback: 'Shot' })] };

	it('IMP-11: enabled when nothing is saving, the name is set, and every bucket has a fallback', () => {
		expect(canConfirm(ready)).toBe(true);
	});

	it('IMP-11: disabled otherwise', () => {
		expect(canConfirm({ ...ready, saving: true })).toBe(false);
		expect(canConfirm({ ...ready, setName: '   ' })).toBe(false);
		expect(canConfirm({ ...ready, buckets: [] })).toBe(false);
		expect(canConfirm({ ...ready, buckets: [...ready.buckets, bucket(['B'], [], { fallback: ' ' })] })).toBe(false);
	});
});

describe('defaultSetName (IMP-9)', () => {
	it('IMP-9: the file name without its extension, when the name box is empty', () => {
		expect(defaultSetName('', 'FlowStudioDemo.xlsx')).toBe('FlowStudioDemo');
		expect(defaultSetName('  ', 'camera.report.CSV')).toBe('camera.report');
	});

	it('IMP-9: a name already typed is kept', () => {
		expect(defaultSetName('Mine', 'FlowStudioDemo.xlsx')).toBe('Mine');
	});

	it('a name with no extension, or only one, is kept whole', () => {
		expect(defaultSetName('', 'report')).toBe('report');
		expect(defaultSetName('', '.csv')).toBe('.csv');
	});
});

describe('success texts (IMP-50)', () => {
	it('IMP-50: imported count, with skipped duplicates only when there are any', () => {
		expect(importSuccessText(1, 0)).toBe('Imported 1 field.');
		expect(importSuccessText(69, 0)).toBe('Imported 69 fields.');
		expect(importSuccessText(69, 1)).toBe('Imported 69 fields. Skipped 1 duplicate column.');
		expect(importSuccessText(69, 3)).toBe('Imported 69 fields. Skipped 3 duplicate columns.');
	});

	it('IMP-50: the editor banner asks for a review of entity type and data type', () => {
		expect(importBannerText(1)).toBe('Imported 1 field. Check its entity type and data type.');
		expect(importBannerText(69)).toBe('Imported 69 fields. Check each entity type and data type.');
	});
});

describe('FlowStudioDemo.xlsx end to end', () => {
	const bytes = new Uint8Array(readFileSync(new URL('../../../fixtures/source/FlowStudioDemo.xlsx', import.meta.url)));
	const workbook = readXlsx(bytes);
	if (!workbook.ok) throw new Error(workbook.reason);
	const buckets = bucketsFromWorkbook('FlowStudioDemo.xlsx', workbook.sheets).map((b) => ({ ...b, fallback: 'Shot' }));

	it('reads one bucket of 72 columns', () => {
		expect(buckets.map((b) => b.label)).toEqual(['FlowStudioDemo.xlsx (Sheet1)']);
		expect(importFooterText(buckets)).toBe('72 columns in 1 bucket.');
		expect(defaultSetName('', 'FlowStudioDemo.xlsx')).toBe('FlowStudioDemo');
	});

	it('IMP-52: with no site, every column lands on the fallback, three repeated headers dropped', () => {
		const result = buildEntries({ buckets, mode: 'automatic', delimiter: '::', site: null, importedAt: NOW });
		expect(result.entries).toHaveLength(69);
		expect(result.dropped).toBe(3);
		expect(result.entries.every((e) => e.targetEntityType === 'Shot' && e.snapshot === null)).toBe(true);
		expect(result.originDetails.sourceFiles).toBe('FlowStudioDemo.xlsx');
		const lens = result.entries.find((e) => e.displayName === 'Anamorphic Desqueeze Ratio');
		expect(lens).toMatchObject({ programmaticName: 'sg_anamorphic_desqueeze_ratio', dataType: 'text' });
		expect(importSuccessText(result.entries.length, result.dropped)).toBe('Imported 69 fields. Skipped 3 duplicate columns.');
	});

	describe('with a small site', () => {
		const tkFps = makeLiveField('Shot', 'tk_fps', { displayName: 'TK frame rate', dataType: 'float' });
		const shotFields = [
			tkFps,
			makeLiveField('Shot', 'sg_shoot_day', { displayName: 'shoot_day', dataType: 'text' }),
			makeLiveField('Shot', 'sg_unit', { displayName: 'Unit', dataType: 'list', validValues: ['Main Unit', '2nd Unit'], defaultValue: 'Main Unit' })
		];
		const aperture = makeLiveField('CustomEntity19', 'sg_max_aperture', { displayName: 'Maximum Aperture ', dataType: 'calculated' });
		const site: ImportSite = {
			url: URL_,
			entityTypes: [
				{ name: 'Shot', displayName: 'Shot' },
				{ name: 'CustomEntity19', displayName: 'Lens' }
			],
			fieldsByType: new Map([
				['Shot', shotFields],
				['CustomEntity19', [aperture]]
			])
		};
		const unfallen = bucketsFromWorkbook('FlowStudioDemo.xlsx', workbook.sheets);

		it('IMP-15: infers Shot as the fallback', () => {
			expect(inferFallback(unfallen[0], site.fieldsByType, COMMON_ENTITY_TYPES)).toBe('Shot');
		});

		it('IMP-29: reads fields for Lens and the fallback only', () => {
			expect(resolvedEntityTypes(buckets, 'automatic', '::', site.entityTypes)).toEqual(['Shot', 'CustomEntity19']);
		});

		it('builds: Lens:: columns on the custom entity, matches mirrored, others predicted', () => {
			const result = buildEntries({ buckets, mode: 'automatic', delimiter: '::', site, importedAt: NOW });
			expect(result.entries).toHaveLength(69);
			expect(result.dropped).toBe(3);

			const lensEntries = result.entries.filter((e) => e.targetEntityType === 'CustomEntity19');
			expect(lensEntries.map((e) => e.programmaticName)).toEqual([
				'sg_anamorphic_desqueeze_ratio',
				'sg_max_aperture',
				'sg_closed_focus',
				'sg_grid_date'
			]);
			expect(lensEntries[1]).toMatchObject({ displayName: 'Maximum Aperture', dataType: 'calculated', snapshot: aperture.raw, snapshotSite: URL_ });

			// Matched on the programmatic name: the site's display name and type win (Q8).
			expect(result.entries.find((e) => e.programmaticName === 'tk_fps')).toMatchObject({
				displayName: 'TK frame rate',
				dataType: 'float',
				snapshot: tkFps.raw
			});
			// Matched on the display name.
			expect(result.entries.find((e) => e.programmaticName === 'sg_unit')).toMatchObject({
				displayName: 'Unit',
				dataType: 'list',
				validValues: ['Main Unit', '2nd Unit'],
				defaultValue: 'Main Unit'
			});
			expect(result.entries.find((e) => e.programmaticName === 'sg_shoot_day')?.snapshot).not.toBeNull();
			// Unmatched: predicted name, guessed type, no snapshot.
			expect(result.entries.find((e) => e.displayName === 'Tk Shutter Angle')).toMatchObject({
				targetEntityType: 'Shot',
				programmaticName: 'sg_tk_shutter_angle',
				dataType: 'float',
				snapshot: null
			});
		});
	});
});
