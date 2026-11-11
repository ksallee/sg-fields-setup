import { describe, expect, it, vi } from 'vitest';
import { COMMON_ENTITY_TYPES } from '$lib/pure/common-entity-types';
import { makeLiveField } from '$lib/testing/make-live-field';
import { bucketFromCsv, type ImportBucket } from '$lib/pure/import-build';
import type { LiveEntityType } from '$lib/pure/live-entity-types';
import type { LiveField } from '$lib/pure/live-field';
import { commonFields, readImportSite } from './import-site';

const TYPES: LiveEntityType[] = [
	{ name: 'Shot', displayName: 'Shot', custom: false },
	{ name: 'Asset', displayName: 'Asset', custom: false },
	{ name: 'Task', displayName: 'Task', custom: false }
];

/** A schema that answers from a table and remembers what it was asked. */
function stub(fields: Record<string, LiveField[]> = {}) {
	const asked: string[] = [];
	return {
		asked,
		entityTypes: vi.fn(async (): Promise<readonly LiveEntityType[]> => TYPES),
		fieldsOrEmpty: vi.fn(async (type: string): Promise<readonly LiveField[]> => {
			asked.push(type);
			return fields[type] ?? [];
		})
	};
}

function bucket(headers: string[], fallback = ''): ImportBucket {
	return { ...bucketFromCsv('shots.csv', { headers, rows: [] }), fallback };
}

describe('commonFields: what the inferred fallback reads (IMP-15, IMP-16)', () => {
	it('IMP-15: the fields of the common types, each asked once, keyed by type', async () => {
		const lens = makeLiveField('Shot', 'sg_lens', { displayName: 'Lens' });
		const schema = stub({ Shot: [lens] });
		const fields = await commonFields(schema);
		expect(schema.asked).toEqual([...COMMON_ENTITY_TYPES]);
		expect([...fields.keys()]).toEqual([...COMMON_ENTITY_TYPES]);
		expect(fields.get('Shot')).toEqual([lens]);
		expect(fields.get('Asset')).toEqual([]);
	});
});

describe('readImportSite: the site as the build takes it (IMP-29)', () => {
	it('IMP-29: only the types the import resolves to are read, each once', async () => {
		const lens = makeLiveField('Shot', 'sg_lens', { displayName: 'Lens' });
		const schema = stub({ Shot: [lens] });
		const site = await readImportSite(schema, 'https://a.shotgrid.autodesk.com', [bucket(['Shot::Lens', 'Asset::Rig', 'Shot::Focal'])], 'automatic', '::');
		expect(schema.asked).toEqual(['Shot', 'Asset']);
		expect(site).toEqual({
			url: 'https://a.shotgrid.autodesk.com',
			entityTypes: TYPES,
			fieldsByType: new Map([
				['Shot', [lens]],
				['Asset', []]
			])
		});
	});

	it('IMP-29: a bucket with no type in its headers reads its fallback\'s fields, and no others', async () => {
		const schema = stub();
		await readImportSite(schema, 'https://a.shotgrid.autodesk.com', [bucket(['Lens', 'Focal'], 'Task')], 'automatic', '::');
		expect(schema.asked).toEqual(['Task']);
	});

	it('IMP-29: columns that resolve to no type read nothing', async () => {
		const schema = stub();
		const site = await readImportSite(schema, 'https://a.shotgrid.autodesk.com', [bucket(['Lens'])], 'automatic', '::');
		expect(schema.asked).toEqual([]);
		expect(site?.fieldsByType.size).toBe(0);
	});

	it('IMP-51: a type list that cannot be read gives null, and no field is read', async () => {
		const schema = stub();
		schema.entityTypes.mockRejectedValueOnce(new Error('503'));
		expect(await readImportSite(schema, 'https://a.shotgrid.autodesk.com', [bucket(['Shot::Lens'])], 'automatic', '::')).toBeNull();
		expect(schema.asked).toEqual([]);
	});
});
