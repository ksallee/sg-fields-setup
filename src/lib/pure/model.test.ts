import { describe, expect, it } from 'vitest';
import lens from '../../../fixtures/field-sets/camera-report-lens.json';
import slate from '../../../fixtures/field-sets/camera-report-slate.json';
import virtualProduction from '../../../fixtures/field-sets/camera-report-virtual-production.json';
import weekly from '../../../fixtures/field-sets/weekly-status-report.json';
import { cleanEntry } from './clean';
import { ORIGINS, type Entry, type FieldSet } from './model';
import { validateSet } from './validity';

const NOW = '2026-11-10T09:00:00.000Z';

/** A hand-built set file (`set-file.ts`), read only as far as this test needs. */
interface FixtureEntry {
	targetEntityType: string;
	programmaticName: string;
	displayName: string;
	dataType: string;
	validTypes: string[];
}
interface Fixture {
	name: string;
	description: string;
	origin: string;
	originDetails: { sourceFiles: string; importedAt: string };
	entries: FixtureEntry[];
}

/** A hand-built fixture as the model holds it. The ids and the time are the caller's. */
function fromFixture(fixture: Fixture, setId: string): { set: FieldSet; entries: Entry[] } {
	const set: FieldSet = {
		id: setId,
		name: fixture.name,
		description: fixture.description,
		origin: 'import',
		originDetails: fixture.originDetails,
		createdAt: NOW,
		changedAt: NOW
	};
	const entries = fixture.entries.map(
		(e, i): Entry => ({
			id: `${setId}-${i}`,
			setId,
			targetEntityType: e.targetEntityType,
			programmaticName: e.programmaticName,
			displayName: e.displayName,
			dataType: e.dataType,
			validTypes: e.validTypes,
			validValues: [],
			defaultValue: null,
			description: null,
			uniquePerProject: false,
			snapshot: null,
			snapshotSite: null,
			snapshotTime: null,
			createdAt: NOW,
			changedAt: NOW
		})
	);
	return { set, entries };
}

describe('ORIGINS', () => {
	it('Q6: lists the three origins, site capture reserved', () => {
		expect(ORIGINS).toEqual(['import', 'manual', 'site_capture']);
	});
});

describe('the model holds the hand-built sets', () => {
	it.each([
		['camera-report-lens', lens],
		['camera-report-slate', slate],
		['camera-report-virtual-production', virtualProduction],
		['weekly-status-report', weekly]
	])('MOD-5, MOD-6, MOD-9: %s is valid and already clean', (slug, fixture) => {
		const { set, entries } = fromFixture(fixture, slug);
		expect(fixture.origin).toBe(set.origin);
		expect(entries.length).toBeGreaterThan(0);
		expect(validateSet(set.name, entries)).toMatchObject({ valid: true });
		expect(entries.map(cleanEntry)).toEqual(entries);
	});
});
