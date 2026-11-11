import { describe, expect, it } from 'vitest';
import listing from '../pure/fixtures/live-schema.json';
import versionFields from '../pure/fixtures/live-version-fields.json';
import { createLiveSchema, type SchemaSource } from './schema';
import { afterSiteWrite, freshFieldsOrEmpty, recheckEntityTypes, type WidgetCaches } from './site-cache';

/** A source that counts its reads and can be told to fail a type. */
function source() {
	const calls: string[] = [];
	const failing = new Set<string>();
	let types: unknown = listing.data;
	const reads: SchemaSource = {
		async readRawEntityTypes() {
			calls.push('types');
			if (failing.has('types')) throw new TypeError('Failed to fetch');
			return types;
		},
		async readRawFields(entityType) {
			calls.push(`fields ${entityType}`);
			if (failing.has(entityType)) throw new TypeError('Failed to fetch');
			return versionFields.data;
		},
		async readField() {
			return { status: 'missing', message: '' };
		}
	};
	return { calls, failing, reads, setTypes: (next: unknown) => (types = next) };
}

/** The widgets' context, as far as the cache is concerned. */
function widgets() {
	const context = { invalidated: 0, schema: { entityTypes: async () => [] }, statuses: { list: async () => [] }, siteUrl: 'https://example.shotgrid.autodesk.com', invalidate: () => void (context.invalidated += 1) };
	return context;
}

type Widgets = ReturnType<typeof widgets>;

/** The stub as the context the function takes. It keeps its own fields, so a test can read them back. */
function caches(context: Widgets): WidgetCaches & Widgets {
	return context as unknown as WidgetCaches & Widgets;
}

describe('afterSiteWrite', () => {
	it('drops what the app holds of the schema, so the next read hits the site (RUN-26, CMP-2)', async () => {
		const site = source();
		const schema = createLiveSchema(site.reads);
		await schema.entityTypes();
		await schema.fields('Version');
		expect(schema.cachedFields('Version')).not.toBeNull();

		afterSiteWrite({ schema, context: widgets() });
		expect(schema.cachedFields('Version')).toBeNull();

		site.calls.length = 0;
		await schema.fieldsOrEmpty('Version');
		await schema.entityTypes();
		expect(site.calls).toEqual(['fields Version', 'types']);
	});

	it('invalidates the widgets\' context, as core asks after a write', () => {
		const context = widgets();
		afterSiteWrite({ schema: createLiveSchema(source().reads), context });
		expect(context.invalidated).toBe(1);
	});

	it('works with no widget context: the fake site has none to drop', () => {
		const schema = createLiveSchema(source().reads);
		expect(() => afterSiteWrite({ schema, context: null })).not.toThrow();
	});
});

describe('freshFieldsOrEmpty', () => {
	it('EDT-42: a re-sync reads past a warm cache, and keeps the new listing', async () => {
		const site = source();
		const schema = createLiveSchema(site.reads);
		await schema.fields('Version');
		await schema.fields('Shot');
		site.calls.length = 0;

		const fields = await freshFieldsOrEmpty(schema, ['Version', 'Shot']);
		expect(site.calls).toEqual(['fields Version', 'fields Shot']);
		expect([...fields.keys()]).toEqual(['Version', 'Shot']);
		expect(fields.get('Version')).toBe(schema.cachedFields('Version'));
		expect(fields.get('Version')?.length).toBeGreaterThan(0);
	});

	it('counts a type that cannot be read as having no fields, as fieldsOrEmpty does (CMP-2)', async () => {
		const site = source();
		const schema = createLiveSchema(site.reads);
		site.failing.add('Shot');
		const fields = await freshFieldsOrEmpty(schema, ['Version', 'Shot']);
		expect(fields.get('Shot')).toEqual([]);
		expect(fields.get('Version')?.length).toBeGreaterThan(0);
	});
});

describe('recheckEntityTypes', () => {
	it('CMP-10: reads the type list again and invalidates the widgets, so a type just enabled shows in the pickers', async () => {
		const site = source();
		const schema = createLiveSchema(site.reads);
		const before = await schema.entityTypes();
		const context = widgets();
		site.setTypes({ ...listing.data, CustomEntity30: { name: { value: 'Rig', editable: false }, visible: { value: true, editable: false } } });
		site.calls.length = 0;

		const answer = await recheckEntityTypes({ schema, context: caches(context) });
		expect(site.calls).toEqual(['types']);
		expect(answer.entityTypes.length).toBe(before.length + 1);
		expect(context.invalidated).toBe(1);
	});

	it('hands the context back under a new identity, so a mounted picker reads its list again', async () => {
		const context = widgets();
		const answer = await recheckEntityTypes({ schema: createLiveSchema(source().reads), context: caches(context) });
		expect(answer.context).not.toBe(context);
		expect(answer.context?.schema).not.toBe(context.schema);
		expect(answer.context?.schema.entityTypes).toBe(context.schema.entityTypes);
		expect(answer.context?.statuses).not.toBe(context.statuses);
		expect(answer.context?.siteUrl).toBe(context.siteUrl);
	});

	it('keeps the field listings: the comparison still has them (CMP-11)', async () => {
		const schema = createLiveSchema(source().reads);
		await schema.fields('Version');
		await recheckEntityTypes({ schema, context: null });
		expect(schema.cachedFields('Version')).not.toBeNull();
	});

	it('rejects when the read fails, and invalidates nothing', async () => {
		const site = source();
		const schema = createLiveSchema(site.reads);
		const context = widgets();
		site.failing.add('types');
		await expect(recheckEntityTypes({ schema, context: caches(context) })).rejects.toThrow('Failed to fetch');
		expect(context.invalidated).toBe(0);
	});
});
