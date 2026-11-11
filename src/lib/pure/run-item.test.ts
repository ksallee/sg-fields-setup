import { describe, expect, it } from 'vitest';
import { createFakeSite, type FakeSite } from './fixtures/fake-site';
import { planEntry, type PlanEntry, type PlanItem, type PlanSite } from './plan';
import { applyItem, type ItemContext } from './run-item';
import type { FieldEffect } from './run';

function entry(overrides: Partial<PlanEntry> = {}): PlanEntry {
	return {
		id: 'link',
		targetEntityType: 'Version',
		programmaticName: 'sg_link',
		displayName: 'Link',
		dataType: 'entity',
		validTypes: ['Shot'],
		validValues: [],
		defaultValue: null,
		description: null,
		uniquePerProject: false,
		...overrides
	};
}

async function context(site: FakeSite): Promise<{ ctx: ItemContext; planSite: PlanSite; effects: FieldEffect[] }> {
	const reader = site.reader();
	const planSite: PlanSite = {
		siteUrl: site.siteUrl,
		trashPageUrl: null,
		entityTypes: await reader.entityTypes(),
		fieldsByType: new Map([['Version', await reader.fields('Version')]])
	};
	const effects: FieldEffect[] = [];
	return { ctx: { port: site, reader, site: planSite, onEffect: (effect) => effects.push(effect) }, planSite, effects };
}

/** An item as a planner that let the valid types through would hand it over. */
function item(wanted: PlanEntry, more: Partial<PlanItem>): PlanItem {
	return {
		entryId: wanted.id,
		entityType: wanted.targetEntityType,
		programmaticName: wanted.programmaticName,
		displayName: wanted.displayName,
		dataType: wanted.dataType,
		class: 'create',
		refusal: null,
		liveDataType: null,
		differences: [],
		blocked: [],
		reasons: [],
		create: null,
		update: null,
		reverseFieldTypes: [],
		...more
	};
}

describe('the valid types guard (corpus finding 121)', () => {
	it.each([
		['in the wrong case', ['shot'], ['shot']],
		['unknown to the site', ['Shot', 'ZzNoSuchType'], ['ZzNoSuchType']]
	])('fails a create whose valid type is %s, and sends nothing', async (_, validTypes, names) => {
		const site = createFakeSite();
		const wanted = entry({ validTypes });
		const { ctx } = await context(site);
		const before = site.calls.length;
		const result = await applyItem(
			ctx,
			wanted,
			item(wanted, {
				create: {
					data_type: 'entity',
					properties: [
						{ property_name: 'name', value: 'Link' },
						{ property_name: 'valid_types', value: validTypes }
					]
				}
			})
		);
		expect(result).toEqual({ state: 'failed', note: { code: 'unknown-valid-types', names }, visibility: null, abort: null });
		expect(site.calls).toHaveLength(before);
	});

	it('fails an update whose valid type is in the wrong case before any call: the field is not lost', async () => {
		const site = createFakeSite().seed('Version', 'sg_link', { displayName: 'Link', dataType: 'entity', validTypes: ['Asset'] });
		const wanted = entry({ validTypes: ['shot'] });
		const { ctx } = await context(site);
		const before = site.calls.length;
		const result = await applyItem(
			ctx,
			wanted,
			item(wanted, { class: 'update', update: { requests: [{ properties: [{ property_name: 'valid_types', value: ['shot'] }] }] } })
		);
		expect(result).toMatchObject({ state: 'failed', note: { code: 'unknown-valid-types', names: ['shot'] } });
		expect(site.calls).toHaveLength(before);
		expect(site.get('Version', 'sg_link')).toMatchObject({ retired: false, broken: false, validTypes: ['Asset'] });
	});

	it('matches against the entity types the run read: a type the site has lost fails the update before any call', async () => {
		const site = createFakeSite().seed('Version', 'sg_link', { displayName: 'Link', dataType: 'entity', validTypes: ['Shot'] });
		const wanted = entry({ validTypes: ['Shot', 'Asset'] });
		const { ctx, planSite } = await context(site);
		const planned = planEntry(wanted, await ctx.reader.field('Version', 'sg_link'), planSite) as PlanItem;
		expect(planned.class).toBe('update');
		const narrowed: ItemContext = { ...ctx, site: { ...planSite, entityTypes: planSite.entityTypes.filter((type) => type.name !== 'Asset') } };
		const before = site.calls.length;
		const result = await applyItem(narrowed, wanted, planned);
		expect(result.note).toEqual({ code: 'unknown-valid-types', names: ['Asset'] });
		expect(site.calls).toHaveLength(before);
	});

	it('marks the effect of a write that carried valid types', async () => {
		const site = createFakeSite();
		const wanted = entry({ validTypes: ['Shot', 'Asset'] });
		const { ctx, planSite, effects } = await context(site);
		const planned = planEntry(wanted, await ctx.reader.field('Version', 'sg_link'), planSite) as PlanItem;
		expect((await applyItem(ctx, wanted, planned)).state).toBe('done');
		expect(effects).toEqual([{ kind: 'created', name: 'sg_link', reverseFieldTypes: ['Shot', 'Asset'] }]);
	});
});

describe('applyItem', () => {
	it('never rejects: what breaks inside comes back as a failed item that stops the run', async () => {
		const site = createFakeSite();
		const wanted = entry();
		const { ctx } = await context(site);
		const broken: ItemContext = {
			...ctx,
			reader: {
				...ctx.reader,
				field: () => {
					throw new Error('Broken reader.');
				}
			}
		};
		const result = await applyItem(broken, wanted, item(wanted, {}));
		expect(result).toMatchObject({ state: 'failed', abort: 'Broken reader.' });
		expect(site.writes()).toEqual([]);
	});
});
