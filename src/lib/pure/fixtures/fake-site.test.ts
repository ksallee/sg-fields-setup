import { describe, expect, it } from 'vitest';
import { asRefusal, isRetiredNameRefusal, readRevive, retiredNameIn } from '../run-port';
import { createFakeSite, DEFAULT_STATUSES, FakeSiteError } from './fake-site';

/** The refusal a call rejects with. */
async function refusalOf(call: Promise<unknown>): Promise<FakeSiteError> {
	try {
		await call;
	} catch (error) {
		if (error instanceof FakeSiteError) return error;
		throw error;
	}
	throw new Error('the call was not refused');
}

const text = (name: string) => ({ data_type: 'text', properties: [{ property_name: 'name' as const, value: name }] });

describe('the fake site: create (corpus findings 019, 116, 117, 118)', () => {
	it('names the field from the display name and answers the name in the self link only', async () => {
		const site = createFakeSite();
		const created = await site.createField('Version', text('Lens Serial (mm)'));
		expect(created).toEqual({ name: 'sg_lens_serial__mm_', self: '/api/v1/schema/Version/fields/sg_lens_serial__mm_' });
		expect(site.get('Version', 'sg_lens_serial__mm_')).toMatchObject({ dataType: 'text', displayName: 'Lens Serial (mm)', retired: false });
	});

	it('spells the type in snake case in the self link of another type', async () => {
		const site = createFakeSite({ entityTypes: ['CustomEntity03', 'Tag'] });
		expect((await site.createField('CustomEntity03', text('Lens'))).self).toBe('/api/v1/schema/custom_entity03/fields/sg_lens');
		expect((await site.createField('Tag', text('Lens'))).self).toBe('/api/v1/schema/tag/fields/sg_lens');
	});

	it('suffixes the name when a live field has it, with no error', async () => {
		const site = createFakeSite().seed('Version', 'sg_lens', { displayName: 'Lens' });
		expect((await site.createField('Version', text('Lens'))).name).toBe('sg_lens_1');
		expect((await site.createField('Version', text('Lens'))).name).toBe('sg_lens_2');
		expect(site.liveNames('Version')).toEqual(['sg_lens', 'sg_lens_1', 'sg_lens_2']);
	});

	it('refuses a name a retired field holds: 400 code 105 with source.field_name', async () => {
		const site = createFakeSite().seedRetired('Version', 'sg_lens', { dataType: 'number' });
		const refusal = await refusalOf(site.createField('Version', text('Lens')));
		expect(refusal.status).toBe(400);
		expect(refusal.code).toBe(105);
		expect(refusal.title).toBe(
			'API schema_field_create() failed, there is a retired field with the same field_name: sg_lens. Delete the retired field forever from the Trash Page in Shotgun and try again.'
		);
		expect(refusal.source).toEqual({ field_name: 'there is a retired field with the same field_name: sg_lens' });
		const read = asRefusal(refusal)!;
		expect(isRetiredNameRefusal(read)).toBe(true);
		expect(retiredNameIn(read)).toBe('sg_lens');
		expect(site.liveNames('Version')).toEqual([]);
	});

	it('calls a field with a non-ASCII display name sg_<data_type>', async () => {
		const site = createFakeSite();
		expect((await site.createField('Version', { data_type: 'currency', properties: [{ property_name: 'name', value: 'Coût' }] })).name).toBe(
			'sg_currency'
		);
	});

	it('takes every setting in the one request', async () => {
		const site = createFakeSite();
		await site.createField('Version', {
			data_type: 'list',
			properties: [
				{ property_name: 'name', value: 'Grade' },
				{ property_name: 'description', value: 'The grade.' },
				{ property_name: 'valid_values', value: ['alpha', 'beta'] },
				{ property_name: 'default_value', value: 'beta' }
			]
		});
		await site.createField('Version', {
			data_type: 'text',
			properties: [
				{ property_name: 'name', value: 'Code' },
				{ property_name: 'unique', value: true }
			]
		});
		expect(site.get('Version', 'sg_grade')).toMatchObject({ description: 'The grade.', validValues: ['alpha', 'beta'], defaultValue: 'beta' });
		expect(site.get('Version', 'sg_code')).toMatchObject({ unique: true });
	});

	it('refuses what the site refuses at creation', async () => {
		const site = createFakeSite();
		const name = { property_name: 'name' as const, value: 'X' };
		expect((await refusalOf(site.createField('Version', { data_type: 'status_list', properties: [name] }))).message).toContain(
			`missing required 'properties' ["valid_values"]`
		);
		expect((await refusalOf(site.createField('Version', { data_type: 'checkbox', properties: [name] }))).status).toBe(500);
		expect((await refusalOf(site.createField('Version', { data_type: 'entity', properties: [name] }))).status).toBe(400);
		expect(
			(
				await refusalOf(
					site.createField('Version', { data_type: 'multi_entity', properties: [name, { property_name: 'valid_types', value: ['Shot', 'Asset'] }] })
				)
			).message
		).toContain("'valid_types' value expected Array with one element");
		expect((await refusalOf(site.createField('Version', { data_type: 'color', properties: [name] }))).message).toContain('data_type is not valid');
		expect((await refusalOf(site.createField('Nope', text('X')))).message).toBe("Entity type 'Nope' does not exist.");
		expect(site.liveNames('Version')).toEqual([]);
	});
});

describe('the fake site: read', () => {
	it('answers found with a wrapped record, missing for a retired or unused name, undeclared for a name the schema leaves out', async () => {
		const site = createFakeSite()
			.seed('Version', 'sg_lens', { displayName: 'Lens', dataType: 'list', validValues: ['a'], defaultValue: 'a' })
			.seedRetired('Version', 'sg_old')
			.seedUndeclared('Version', 'read_by_current_user');
		const found = await site.readField('Version', 'sg_lens');
		expect(found).toMatchObject({
			status: 'found',
			raw: {
				name: { value: 'Lens', editable: true },
				data_type: { value: 'list', editable: false },
				unique: { value: false, editable: false },
				visible: { value: true, editable: true },
				properties: { default_value: { value: 'a', editable: true }, valid_values: { value: ['a'], editable: true } }
			}
		});
		expect(await site.readField('Version', 'sg_old')).toEqual({ status: 'missing', message: "Field 'Version.sg_old' does not exist." });
		expect(await site.readField('Version', 'sg_never')).toEqual({ status: 'missing', message: "Field 'Version.sg_never' does not exist." });
		expect(await site.readField('Version', 'read_by_current_user')).toEqual({ status: 'undeclared' });
		expect((await refusalOf(site.readField('Nope', 'sg_lens'))).status).toBe(404);
	});

	it('lists the live fields only, and its reader parses them as the app does', async () => {
		const site = createFakeSite().seed('Version', 'sg_lens', { displayName: 'Lens' }).seedRetired('Version', 'sg_old');
		expect(Object.keys(await site.readRawFields('Version'))).toEqual(['sg_lens']);
		const reader = site.reader();
		expect((await reader.entityTypes()).map((type) => type.name)).toEqual(['Version', 'Shot', 'Asset', 'Task']);
		expect((await reader.fields('Version')).map((field) => field.name)).toEqual(['sg_lens']);
		expect(await reader.field('Version', 'sg_lens')).toMatchObject({ kind: 'present', field: { displayName: 'Lens', dataType: 'text' } });
		expect(await reader.field('Version', 'sg_old')).toMatchObject({ kind: 'absent', reason: 'does-not-exist' });
	});
});

describe('the fake site: update (corpus finding 116)', () => {
	it('applies a name, a description, list values and a default', async () => {
		const site = createFakeSite().seed('Version', 'sg_grade', { dataType: 'list', displayName: 'Grade', validValues: ['a'] });
		await site.updateField('Version', 'sg_grade', [{ property_name: 'name', value: 'Grading' }]);
		await site.updateField('Version', 'sg_grade', [{ property_name: 'description', value: 'New.' }]);
		await site.updateField('Version', 'sg_grade', [{ property_name: 'valid_values', value: ['a', 'b'] }]);
		await site.updateField('Version', 'sg_grade', [{ property_name: 'default_value', value: 'b' }]);
		expect(site.get('Version', 'sg_grade')).toMatchObject({ displayName: 'Grading', description: 'New.', validValues: ['a', 'b'], defaultValue: 'b' });
	});

	it('refuses unique: 500 on a text field, 400 on another', async () => {
		const site = createFakeSite().seed('Version', 'sg_code', { unique: true }).seed('Version', 'sg_grade', { dataType: 'list' });
		const onText = await refusalOf(site.updateField('Version', 'sg_code', [{ property_name: 'unique', value: false }]));
		expect([onText.status, onText.message]).toEqual([500, "API schema_field_update() does not support updating 'unique'."]);
		const onList = await refusalOf(site.updateField('Version', 'sg_grade', [{ property_name: 'unique', value: true }]));
		expect(onList.status).toBe(400);
		expect(onList.message).toContain("invalid property 'unique'");
		expect(site.get('Version', 'sg_code')?.unique).toBe(true);
	});

	it('refuses valid types on a multi-entity link and takes them on an entity link', async () => {
		const site = createFakeSite()
			.seed('Version', 'sg_links', { dataType: 'multi_entity', validTypes: ['Shot'] })
			.seed('Version', 'sg_link', { dataType: 'entity', validTypes: ['Shot'] });
		const refusal = await refusalOf(site.updateField('Version', 'sg_links', [{ property_name: 'valid_types', value: ['Shot'] }]));
		expect(refusal.message).toContain("can't update 'valid_types' on this field");
		await site.updateField('Version', 'sg_link', [{ property_name: 'valid_types', value: ['Shot', 'Asset'] }]);
		expect(site.get('Version', 'sg_link')?.validTypes).toEqual(['Shot', 'Asset']);
	});

	it('refuses to clear a value: null, blank and an empty list', async () => {
		const site = createFakeSite().seed('Version', 'sg_grade', { dataType: 'list', validValues: ['a'], defaultValue: 'a', description: 'Kept.' });
		for (const write of [
			{ property_name: 'default_value', value: null },
			{ property_name: 'default_value', value: '' },
			{ property_name: 'valid_values', value: [] },
			{ property_name: 'description', value: '' }
		]) {
			const refusal = await refusalOf(site.updateField('Version', 'sg_grade', [write]));
			expect([refusal.status, refusal.title]).toEqual([400, 'Request Parameters invalid.']);
			expect(JSON.stringify(refusal.source)).toContain('value must be filled');
		}
		expect(site.get('Version', 'sg_grade')).toMatchObject({ defaultValue: 'a', validValues: ['a'], description: 'Kept.' });
	});

	it('refuses a default outside the valid values', async () => {
		const site = createFakeSite().seed('Version', 'sg_grade', { dataType: 'list', validValues: ['a'] });
		const refusal = await refusalOf(site.updateField('Version', 'sg_grade', [{ property_name: 'default_value', value: 'zzz' }]));
		expect(refusal.message).toContain("'default_value' not in valid_values");
	});

	it("refuses a status list's values that leave out its default, and lets a list keep a default outside its values", async () => {
		const site = createFakeSite()
			.seed('Version', 'sg_state', { dataType: 'status_list', validValues: ['na', 'rev'], defaultValue: 'na' })
			.seed('Version', 'sg_grade', { dataType: 'list', validValues: ['alpha', 'beta'], defaultValue: 'alpha' });
		const refusal = await refusalOf(site.updateField('Version', 'sg_state', [{ property_name: 'valid_values', value: ['rev'] }]));
		expect(refusal.message).toBe(`API schema_field_update() 'valid_values' ["rev"] must include the 'default_value' 'na'`);
		await site.updateField('Version', 'sg_grade', [{ property_name: 'valid_values', value: ['beta'] }]);
		expect(site.get('Version', 'sg_grade')).toMatchObject({ validValues: ['beta'], defaultValue: 'alpha' });
	});

	it('stores a checkbox default as sent, a string included', async () => {
		const site = createFakeSite().seed('Version', 'sg_flag', { dataType: 'checkbox', defaultValue: true });
		await site.updateField('Version', 'sg_flag', [{ property_name: 'default_value', value: 'false' }]);
		expect(site.get('Version', 'sg_flag')?.defaultValue).toBe('false');
	});

	it('answers 404 on a retired field and on a name never used', async () => {
		const site = createFakeSite().seedRetired('Version', 'sg_old');
		for (const name of ['sg_old', 'sg_never']) {
			const refusal = await refusalOf(site.updateField('Version', name, [{ property_name: 'description', value: 'x' }]));
			expect([refusal.status, refusal.message]).toEqual([404, `Field 'Version.${name}' does not exist.`]);
		}
	});
});

describe('the fake site: retire and revive (corpus findings 040, 115, 119)', () => {
	it('retires a live field and keeps its name taken', async () => {
		const site = createFakeSite().seed('Version', 'sg_lens', { displayName: 'Lens' });
		await site.retireField('Version', 'sg_lens');
		expect(site.get('Version', 'sg_lens')?.retired).toBe(true);
		expect((await refusalOf(site.retireField('Version', 'sg_lens'))).status).toBe(404);
		expect((await refusalOf(site.createField('Version', text('Lens')))).code).toBe(105);
	});

	it('answers the three measured revives', async () => {
		const site = createFakeSite()
			.seedRetired('Version', 'sg_old', { dataType: 'number', displayName: 'Old', description: 'As it was.' })
			.seed('Version', 'sg_live');
		const never = await site.reviveField('Version', 'sg_never');
		expect(never).toEqual({ revived: false, status: 404, message: 'Retired field Version.sg_never does not exist.' });
		expect(readRevive(never, 'sg_never')).toBe('nothing-retired');
		const live = await site.reviveField('Version', 'sg_live');
		expect(live).toEqual({ revived: false, status: 400, message: 'Field Version.sg_live is not retired.' });
		expect(readRevive(live, 'sg_live')).toBe('already-live');
		expect(await site.reviveField('Version', 'sg_old')).toEqual({ revived: true });
		expect(site.get('Version', 'sg_old')).toMatchObject({ retired: false, dataType: 'number', displayName: 'Old', description: 'As it was.' });
	});

	it('reads and writes visible per project, and a revive makes the field visible everywhere', async () => {
		const site = createFakeSite({ projects: [70, 71] }).seed('Version', 'sg_lens');
		const noProject = await refusalOf(site.updateField('Version', 'sg_lens', [{ property_name: 'visible', value: false }]));
		expect([noProject.status, noProject.code]).toEqual([400, 104]);
		const noSuchProject = await refusalOf(site.updateField('Version', 'sg_lens', [{ property_name: 'visible', value: false }], 999));
		expect([noSuchProject.status, noSuchProject.code]).toEqual([400, 105]);

		await site.updateField('Version', 'sg_lens', [{ property_name: 'visible', value: false }], 70);
		const visibleAt = async (projectId?: number) => {
			const reply = await site.readField('Version', 'sg_lens', projectId);
			return reply.status === 'found' ? (reply.raw as { visible: { value: boolean } }).visible.value : null;
		};
		expect([await visibleAt(), await visibleAt(70), await visibleAt(71), await visibleAt(999)]).toEqual([true, false, true, true]);

		await site.retireField('Version', 'sg_lens');
		await site.reviveField('Version', 'sg_lens');
		expect(await visibleAt(70)).toBe(true);
	});
});

describe('the fake site: faults, hooks and the log', () => {
	it('refuses the next call with the status and message given, once, and changes nothing', async () => {
		const site = createFakeSite().failNext('createField', { status: 403, message: 'You are not allowed to edit the schema.' });
		const refusal = await refusalOf(site.createField('Version', text('Lens')));
		expect(asRefusal(refusal)).toMatchObject({ status: 403, message: 'You are not allowed to edit the schema.' });
		expect(site.liveNames('Version')).toEqual([]);
		expect((await site.createField('Version', text('Lens'))).name).toBe('sg_lens');
	});

	it('answers an injected revive refusal as the client does: 403 rejects, another 4xx comes back', async () => {
		const site = createFakeSite().seedRetired('Version', 'sg_old');
		site.failNext('reviveField', { status: 403, message: 'Forbidden.' });
		expect((await refusalOf(site.reviveField('Version', 'sg_old'))).status).toBe(403);
		site.failNext('reviveField', { status: 409, message: 'Busy.' });
		const answer = await site.reviveField('Version', 'sg_old');
		expect(answer).toEqual({ revived: false, status: 409, message: 'Busy.' });
		expect(readRevive(answer, 'sg_old')).toBe('unknown');
		expect(site.get('Version', 'sg_old')?.retired).toBe(true);
	});

	it('drops the connection before or after the call is applied', async () => {
		const site = createFakeSite();
		site.dropNext('createField');
		await expect(site.createField('Version', text('Lens'))).rejects.toBeInstanceOf(TypeError);
		expect(site.liveNames('Version')).toEqual([]);
		site.dropNext('createField', 'after');
		const dropped = await site.createField('Version', text('Lens')).catch((error: unknown) => error);
		expect(asRefusal(dropped)).toBeNull();
		expect(site.liveNames('Version')).toEqual(['sg_lens']);
	});

	it('answers success to an ignored write and changes nothing', async () => {
		const site = createFakeSite().seed('Version', 'sg_lens', { description: 'Old.' });
		site.ignoreNext('updateField');
		await site.updateField('Version', 'sg_lens', [{ property_name: 'description', value: 'New.' }]);
		expect(site.get('Version', 'sg_lens')?.description).toBe('Old.');
		expect(site.calls.at(-1)?.outcome).toBe('ignored');
	});

	it('runs a hook once, before the next call of that kind', async () => {
		const site = createFakeSite();
		site.beforeNext('readField', () => site.seed('Version', 'sg_lens'));
		expect((await site.readField('Version', 'sg_lens')).status).toBe('found');
		site.deleteForGood('Version', 'sg_lens');
		expect((await site.readField('Version', 'sg_lens')).status).toBe('missing');
	});

	it('logs every call, tells the writes from the reads and sees two writes in flight at once', async () => {
		const site = createFakeSite().seed('Version', 'sg_lens');
		await site.readField('Version', 'sg_lens');
		await site.updateField('Version', 'sg_lens', [{ property_name: 'description', value: 'One.' }]);
		await site.retireField('Version', 'sg_lens').then(() => site.reviveField('Version', 'sg_lens'));
		expect(site.calls.map((call) => [call.seq, call.op, call.write, call.outcome])).toEqual([
			[1, 'readField', false, 'ok'],
			[2, 'updateField', true, 'ok'],
			[3, 'retireField', true, 'ok'],
			[4, 'reviveField', true, 'ok']
		]);
		expect(site.writeLog()).toEqual(['updateField Version.sg_lens', 'retireField Version.sg_lens', 'reviveField Version.sg_lens']);
		expect(site.calls[1].body).toEqual([{ property_name: 'description', value: 'One.' }]);
		expect(site.writesOverlapped()).toBe(false);

		await Promise.all([
			site.updateField('Version', 'sg_lens', [{ property_name: 'description', value: 'Two.' }]),
			site.createField('Version', text('Other'))
		]);
		expect(site.writesOverlapped()).toBe(true);
		expect(site.calls.at(-1)).toMatchObject({ op: 'createField', created: 'sg_other', overlapped: true });
	});
});

describe('the fake site: one request, checked whole (corpus finding 121)', () => {
	const grade = () => createFakeSite().seed('Version', 'sg_grade', { dataType: 'list', validValues: ['a', 'b'], defaultValue: 'a', description: 'Kept.' });

	it('takes new values and a default only they hold, in either order', async () => {
		const site = grade();
		await site.updateField('Version', 'sg_grade', [
			{ property_name: 'valid_values', value: ['p', 'q'] },
			{ property_name: 'default_value', value: 'q' }
		]);
		expect(site.get('Version', 'sg_grade')).toMatchObject({ validValues: ['p', 'q'], defaultValue: 'q' });
		await site.updateField('Version', 'sg_grade', [
			{ property_name: 'default_value', value: 'r' },
			{ property_name: 'valid_values', value: ['r', 's'] }
		]);
		expect(site.get('Version', 'sg_grade')).toMatchObject({ validValues: ['r', 's'], defaultValue: 'r' });
	});

	it('applies nothing when one property is refused', async () => {
		const site = grade();
		const stale = await refusalOf(
			site.updateField('Version', 'sg_grade', [
				{ property_name: 'default_value', value: 'a' },
				{ property_name: 'valid_values', value: ['t', 'u'] }
			])
		);
		expect(stale.message).toContain("'default_value' not in valid_values");
		for (const properties of [
			[
				{ property_name: 'description', value: 'New.' },
				{ property_name: 'default_value', value: 'zzz' }
			],
			[
				{ property_name: 'description', value: 'New.' },
				{ property_name: 'unique', value: true }
			]
		]) {
			expect((await refusalOf(site.updateField('Version', 'sg_grade', properties))).status).toBe(400);
		}
		expect(site.get('Version', 'sg_grade')).toMatchObject({ validValues: ['a', 'b'], defaultValue: 'a', description: 'Kept.' });
	});

	it('moves a status list to new values and a new default in one request', async () => {
		const site = createFakeSite().seed('Version', 'sg_state', { dataType: 'status_list', validValues: ['na', 'rev'], defaultValue: 'na' });
		await site.updateField('Version', 'sg_state', [
			{ property_name: 'valid_values', value: ['vwd', 'apr'] },
			{ property_name: 'default_value', value: 'vwd' }
		]);
		expect(site.get('Version', 'sg_state')).toMatchObject({ validValues: ['vwd', 'apr'], defaultValue: 'vwd' });
	});

	it('refuses a blank name or description, and stores a padded one as sent', async () => {
		const site = grade();
		for (const property_name of ['name', 'description']) {
			const refusal = await refusalOf(site.updateField('Version', 'sg_grade', [{ property_name, value: ' ' }]));
			expect([refusal.status, refusal.message.split(':')[0]]).toEqual([400, `API schema_field_update() invalid/missing '${property_name}' value string`]);
			expect((await refusalOf(site.updateField('Version', 'sg_grade', [{ property_name, value: '' }]))).title).toBe('Request Parameters invalid.');
		}
		await site.updateField('Version', 'sg_grade', [{ property_name: 'description', value: ' padded ' }]);
		expect(site.get('Version', 'sg_grade')?.description).toBe(' padded ');
	});

	it('keeps valid types in the order sent, and drops repeats there and on a list, not on a status list', async () => {
		const site = createFakeSite({ entityTypes: ['Version', 'Shot', 'Asset', 'Sequence'] })
			.seed('Version', 'sg_link', { dataType: 'entity', validTypes: ['Shot', 'Asset'] })
			.seed('Version', 'sg_grade', { dataType: 'list', validValues: ['x'] })
			.seed('Version', 'sg_state', { dataType: 'status_list', validValues: ['na'] });
		await site.updateField('Version', 'sg_link', [{ property_name: 'valid_types', value: ['Asset', 'Shot'] }]);
		expect(site.get('Version', 'sg_link')?.validTypes).toEqual(['Asset', 'Shot']);
		await site.updateField('Version', 'sg_link', [{ property_name: 'valid_types', value: ['Shot', 'Shot', 'Asset'] }]);
		expect(site.get('Version', 'sg_link')?.validTypes).toEqual(['Shot', 'Asset']);
		await site.updateField('Version', 'sg_grade', [{ property_name: 'valid_values', value: ['alpha', 'alpha', 'beta'] }]);
		expect(site.get('Version', 'sg_grade')?.validValues).toEqual(['alpha', 'beta']);
		await site.updateField('Version', 'sg_state', [{ property_name: 'valid_values', value: ['na', 'vwd', 'na'] }]);
		expect(site.get('Version', 'sg_state')?.validValues).toEqual(['na', 'vwd', 'na']);
	});

	it('refuses a valid type the site lacks, and loses the field to one in the wrong case', async () => {
		const site = createFakeSite().seed('Version', 'sg_link', { dataType: 'entity', validTypes: ['Shot'] });
		const unknown = await refusalOf(site.updateField('Version', 'sg_link', [{ property_name: 'valid_types', value: ['Shot', 'ZzNoSuchType'] }]));
		expect([unknown.status, unknown.title]).toEqual([400, 'API schema_field_update() invalid/missing entity']);
		expect(site.get('Version', 'sg_link')).toMatchObject({ validTypes: ['Shot'], retired: false });

		const wrongCase = await refusalOf(site.updateField('Version', 'sg_link', [{ property_name: 'valid_types', value: ['shot'] }]));
		expect([wrongCase.status, wrongCase.code, wrongCase.title]).toEqual([500, 100, 'Shotgun Server Error']);
		expect(site.get('Version', 'sg_link')).toMatchObject({ retired: true, broken: true });
		expect(await site.readField('Version', 'sg_link')).toMatchObject({ status: 'missing' });
		expect((await refusalOf(site.retireField('Version', 'sg_link'))).status).toBe(404);
	});

	it('refuses a status code the site does not have, when told the codes', async () => {
		const site = createFakeSite({ statuses: ['na', 'rev'] }).seed('Version', 'sg_state', { dataType: 'status_list', validValues: ['na'] });
		const refusal = await refusalOf(site.updateField('Version', 'sg_state', [{ property_name: 'valid_values', value: ['na', 'zzq'] }]));
		expect(refusal.title).toBe("API schema_field_update() invalid/missing 'status_list' string");
	});
});

describe('the fake site: reverse fields (corpus findings 116 and 121)', () => {
	const link = (name: string, dataType: 'entity' | 'multi_entity', validTypes: string[]) => ({
		data_type: dataType,
		properties: [
			{ property_name: 'name' as const, value: name },
			{ property_name: 'valid_types' as const, value: validTypes }
		]
	});
	const types = (value: string[]) => [{ property_name: 'valid_types' as const, value }];
	const reverse = (site: ReturnType<typeof createFakeSite>, name = 'sg_plate') =>
		site.reverseFields('Version', name).map((field) => `${field.entityType}.${field.name}${field.retired ? ' (retired)' : ''}`);

	it('creating an entity link makes a field on each of its valid types, named sg_versions_<n>', async () => {
		const site = createFakeSite();
		await site.createField('Version', link('Plate', 'entity', ['Shot', 'Asset']));
		expect(reverse(site)).toEqual(['Shot.sg_versions_1', 'Asset.sg_versions_1']);
		expect(site.get('Shot', 'sg_versions_1')).toMatchObject({ retired: false, validTypes: ['Version'], reverseOf: { entityType: 'Version', name: 'sg_plate' } });
		// A second link takes the next number on each type.
		await site.createField('Version', link('Matte', 'entity', ['Shot']));
		expect(reverse(site, 'sg_matte')).toEqual(['Shot.sg_versions_2']);
		// They are fields of the type: its listing holds them.
		expect(Object.keys(await site.readRawFields('Shot'))).toEqual(['sg_versions_1', 'sg_versions_2']);
	});

	it('creating a multi-entity link makes the reverse side on its valid type, named <type>_<field>_<types>', async () => {
		const site = createFakeSite();
		await site.createField('Version', link('Plates', 'multi_entity', ['Shot']));
		expect(reverse(site, 'sg_plates')).toEqual(['Shot.version_sg_plates_versions']);
		expect(site.get('Shot', 'version_sg_plates_versions')).toMatchObject({ dataType: 'multi_entity', validTypes: ['Version'], retired: false });
	});

	it('adding a type makes a field there, removing one retires it, and adding it back takes the next name', async () => {
		const site = createFakeSite({ entityTypes: ['Version', 'Shot', 'Asset', 'Sequence'] });
		await site.createField('Version', link('Plate', 'entity', ['Shot', 'Asset']));
		await site.updateField('Version', 'sg_plate', types(['Sequence', 'Shot', 'Asset']));
		expect(reverse(site)).toEqual(['Shot.sg_versions_1', 'Asset.sg_versions_1', 'Sequence.sg_versions_1']);

		await site.updateField('Version', 'sg_plate', types(['Sequence', 'Asset']));
		expect(reverse(site)).toEqual(['Shot.sg_versions_1 (retired)', 'Asset.sg_versions_1', 'Sequence.sg_versions_1']);
		// The name stays taken: a create that derives it is refused as any retired name is.
		expect(site.retiredNames('Shot')).toEqual(['sg_versions_1']);

		await site.updateField('Version', 'sg_plate', types(['Sequence', 'Asset', 'Shot']));
		expect(reverse(site)).toEqual(['Shot.sg_versions_1 (retired)', 'Asset.sg_versions_1', 'Sequence.sg_versions_1', 'Shot.sg_versions_2']);
		expect(site.retiredNames('Shot')).toEqual(['sg_versions_1']);
	});

	it('a write that only reorders makes and retires nothing', async () => {
		const site = createFakeSite();
		await site.createField('Version', link('Plate', 'entity', ['Shot', 'Asset']));
		await site.updateField('Version', 'sg_plate', types(['Asset', 'Shot']));
		expect(site.get('Version', 'sg_plate')?.validTypes).toEqual(['Asset', 'Shot']);
		expect(reverse(site)).toEqual(['Shot.sg_versions_1', 'Asset.sg_versions_1']);
		expect(site.retiredNames('Shot')).toEqual([]);
	});

	it('a refused update makes and retires nothing', async () => {
		const site = createFakeSite();
		await site.createField('Version', link('Plate', 'entity', ['Shot']));
		await refusalOf(site.updateField('Version', 'sg_plate', [...types(['Asset']), { property_name: 'description', value: '' }]));
		expect(reverse(site)).toEqual(['Shot.sg_versions_1']);
		expect(site.liveNames('Asset')).toEqual([]);
	});

	it.each(['entity', 'multi_entity'] as const)('retiring a %s link retires its reverse fields, and reviving it brings them back', async (dataType) => {
		const site = createFakeSite();
		await site.createField('Version', link('Plate', dataType, ['Shot']));
		const [name] = site.liveNames('Shot');
		await site.retireField('Version', 'sg_plate');
		expect(site.liveNames('Shot')).toEqual([]);
		expect(site.retiredNames('Shot')).toEqual([name]);
		expect(await site.reviveField('Version', 'sg_plate')).toEqual({ revived: true });
		expect(site.liveNames('Shot')).toEqual([name]);
	});

	it('a revive does not bring back the field of a type removed before the link was retired', async () => {
		const site = createFakeSite();
		await site.createField('Version', link('Plate', 'entity', ['Shot', 'Asset']));
		await site.updateField('Version', 'sg_plate', types(['Asset']));
		await site.retireField('Version', 'sg_plate');
		await site.reviveField('Version', 'sg_plate');
		expect(reverse(site)).toEqual(['Shot.sg_versions_1 (retired)', 'Asset.sg_versions_1']);
	});

	it('the wrong-case 500 retires the reverse fields with the link', async () => {
		const site = createFakeSite();
		await site.createField('Version', link('Plate', 'entity', ['Shot']));
		expect((await refusalOf(site.updateField('Version', 'sg_plate', types(['shot'])))).status).toBe(500);
		expect(reverse(site)).toEqual(['Shot.sg_versions_1 (retired)']);
	});

	it('a seeded link holds its reverse fields, as a link on the site does', () => {
		const site = createFakeSite()
			.seed('Version', 'sg_plate', { dataType: 'entity', validTypes: ['Shot', 'Asset'] })
			.seedRetired('Version', 'sg_old', { dataType: 'entity', validTypes: ['Shot'] });
		expect(reverse(site)).toEqual(['Shot.sg_versions_1', 'Asset.sg_versions_1']);
		expect(reverse(site, 'sg_old')).toEqual(['Shot.sg_versions_2 (retired)']);
		// Seeding the same link again, as a test does to change it behind the API, keeps the fields it has.
		site.seed('Version', 'sg_plate', { dataType: 'entity', validTypes: ['Shot', 'Asset'], description: 'Changed.' });
		expect(reverse(site)).toEqual(['Shot.sg_versions_1', 'Asset.sg_versions_1']);
	});

	it('a field that links nothing has no reverse field', async () => {
		const site = createFakeSite();
		await site.createField('Version', text('Lens'));
		expect(site.reverseFields('Version', 'sg_lens')).toEqual([]);
		expect(site.liveNames('Shot')).toEqual([]);
	});
});

describe('the fake site: status codes (corpus findings 116 and 121)', () => {
	const status = (values: string[], defaultValue?: string) => ({
		data_type: 'status_list',
		properties: [
			{ property_name: 'name' as const, value: 'State' },
			{ property_name: 'valid_values' as const, value: values },
			...(defaultValue === undefined ? [] : [{ property_name: 'default_value' as const, value: defaultValue }])
		]
	});

	it('refuses a code the site does not have, with no codes given: the site has a default set', async () => {
		const site = createFakeSite().seed('Version', 'sg_state', { dataType: 'status_list', validValues: ['na'] });
		const refusal = await refusalOf(site.updateField('Version', 'sg_state', [{ property_name: 'valid_values', value: ['na', 'zzq'] }]));
		expect(refusal).toMatchObject({ status: 400, code: 103, title: "API schema_field_update() invalid/missing 'status_list' string" });
		expect((await refusalOf(site.updateField('Version', 'sg_state', [{ property_name: 'default_value', value: 'zzq' }]))).status).toBe(400);
		expect((await refusalOf(site.createField('Version', status(['na', 'zzq'])))).status).toBe(400);
		expect(site.get('Version', 'sg_state')).toMatchObject({ validValues: ['na'], defaultValue: null });
		expect(site.liveNames('Version')).toEqual(['sg_state']);
	});

	it('takes the codes of the default set, and the codes it is told instead', async () => {
		const site = createFakeSite();
		expect(DEFAULT_STATUSES).toEqual(expect.arrayContaining(['wtg', 'rdy', 'ip', 'fin', 'na', 'rev', 'vwd', 'apr']));
		await site.createField('Version', status(['na', 'rev', 'vwd', 'apr'], 'rev'));
		expect(site.get('Version', 'sg_state')).toMatchObject({ validValues: ['na', 'rev', 'vwd', 'apr'], defaultValue: 'rev' });
		const own = createFakeSite({ statuses: ['zzq'] });
		await own.createField('Version', status(['zzq']));
		expect((await refusalOf(own.createField('Version', { ...status(['na']), properties: [{ property_name: 'name', value: 'Other' }, { property_name: 'valid_values', value: ['na'] }] }))).status).toBe(400);
	});
});
