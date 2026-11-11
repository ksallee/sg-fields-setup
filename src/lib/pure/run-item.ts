/**
 * What a run does for one item (RUN-7 to RUN-15, corpus findings 040, 116 and 119). The only
 * code in the app that writes to a site's schema.
 *
 * No I/O of its own: every call goes through the `SchemaWritePort` and the `RunReader` it is
 * handed. One call at a time, each awaited before the next (RUN-6).
 *
 * | class                             | steps                                                        | outcome            |
 * |-----------------------------------|--------------------------------------------------------------|--------------------|
 * | `type-conflict`, `blocked`, `refused` | none                                                     | skipped, the plan's reasons |
 * | `already-matches`                 | none; visibility as an existing field                        | skipped, nothing to change |
 * | `update`                          | re-read, re-plan, write, read back                           | done, skipped or failed |
 * | `create`                          | re-read, revive, then read it or create, read back           | done, skipped or failed |
 *
 * **Update** (RUN-7, RUN-15). The field is read again and the entry planned against that read.
 * Gone: failed. Now blocked, refused or of another type: failed with the plan's reasons. Now
 * matching: skipped, nothing to change. Otherwise the one request of the fresh plan is sent,
 * then the field is read back and must plan as "already matches". Anything else is a
 * failure that names each setting still different. A success status proves nothing here.
 *
 * **Create** (RUN-8 to RUN-12).
 *
 * 1. Re-read. Live with the wanted type: skipped as "already exists", visibility as an existing
 *    field. Its differences are left alone: the person ticked a create, not an update, and the
 *    row says how many settings differ. Live with another type: skipped as a type conflict.
 * 2. Revive. The answer is read by `readRevive`, strictly:
 *    - revived: read the field. Unreadable: failed, and the field stays live. Another data type,
 *      or a difference the API cannot write: retired again, failed with the trash instruction.
 *      Other differences: written and read back. None: done.
 *    - nothing retired (the measured 404): create.
 *    - already live (the measured 400): the field appeared since step 1. Read again and go on as
 *      step 1 does.
 *    - anything else, a permission refusal included: failed with the server's message. Never a
 *      create. A revive that was misread, followed by a create, is how a name gets spent: the
 *      create is refused when the name is retired, but a `_1` field is made when it is live.
 * 3. Create with the planned payload. The name the server gave is compared with the wanted one.
 *    Different: the new field is retired and the item fails with both names (RUN-12). Refused
 *    because a retired field holds the name: failed with the trash instruction, no second revive.
 *    Then read back, as an update.
 *
 * **Valid types** (corpus finding 121). A valid type the site does not have is a 400. One in the
 * wrong case (`shot`) is a 500 that takes the field down. So before anything is sent, every valid
 * type of the entry, and of each payload again, is matched exactly against the site's entity
 * types, by the planner's rule (`unknownValidTypes`). One stray name fails the item with no call made. The planner refuses such entries; this
 * is the second guard.
 *
 * **Repeats.** The site drops a repeated value from a list's valid values and from valid types.
 * The planner removes repeats before it compares and sends (`wantedEntry`), so the read-back,
 * which is the planner's own comparison, does not fail on one.
 *
 * A re-trash is read back too: the row says whether the field is in the trash or still live.
 *
 * **Failures.** A refusal (an error with a status) fails the item and nothing else (RUN-16,
 * RUN-27). A call that got no answer fails the item and sets `abort`: the connection is gone, so
 * the run stops there (RUN-17). After such a write the site may or may not have changed; a retry
 * re-plans from the site and finds out.
 */
import type { LiveFieldRead } from './live-field';
import { diffEntry, wantedEntry, withoutRepeats } from './plan-diff';
import { planEntry, unknownValidTypes, type PlanEntry, type PlanItem, type PlanSite, type PropertyWrite } from './plan';
import {
	asRefusal,
	errorMessage,
	isRetiredNameRefusal,
	readRevive,
	retiredNameIn,
	type ReviveAnswer,
	type RunReader,
	type SchemaWritePort
} from './run-port';
import type { FieldEffect, Retrash, RowNote, RunAction, WriteKind } from './run';
import type { FieldOrigin } from './visibility-types';

export interface ItemContext {
	port: SchemaWritePort;
	reader: RunReader;
	/** The site as the run's re-plan read it. */
	site: PlanSite;
	/** Told of each schema change as soon as the site answered it, before any read-back. */
	onEffect: (effect: FieldEffect) => void;
}

export interface ItemResult {
	state: 'done' | 'skipped' | 'failed';
	note: RowNote | null;
	/** How visibility treats the field (VIS-4, VIS-5). Null when none applies: nothing is there to show. */
	visibility: FieldOrigin | null;
	/** Set when a call got no answer or something broke: the run stops with this error (RUN-17). */
	abort: string | null;
}

const done = (visibility: FieldOrigin): ItemResult => ({ state: 'done', note: null, visibility, abort: null });
const skipped = (note: RowNote, visibility: FieldOrigin | null = null): ItemResult => ({ state: 'skipped', note, visibility, abort: null });
const failed = (note: RowNote, abort: string | null = null): ItemResult => ({ state: 'failed', note, visibility: null, abort });

/** A call that threw: the site's refusal, or no answer at all. */
function threw(action: RunAction, error: unknown): ItemResult {
	const refusal = asRefusal(error);
	const message = errorMessage(error);
	return failed({ code: 'refused', action, status: refusal?.status ?? null, message }, refusal ? null : message);
}

type Read = { read: LiveFieldRead; failure: null } | { read: null; failure: unknown };

async function readNow(ctx: ItemContext, entry: PlanItem): Promise<Read> {
	try {
		return { read: await ctx.reader.field(entry.entityType, entry.programmaticName), failure: null };
	} catch (failure) {
		return { read: null, failure };
	}
}

/** The plan for an entry against a read. Never null here: a mirror entry has no item to apply. */
function plan(ctx: ItemContext, entry: PlanEntry, read: LiveFieldRead): PlanItem {
	const item = planEntry(entry, read, ctx.site);
	if (item === null) throw new Error('A mirror entry cannot be installed.');
	return item;
}

/** The valid types among them that are no entity type of the site: the planner's own rule (`unknownValidTypes`). */
function strays(ctx: ItemContext, types: readonly string[]): string[] {
	return withoutRepeats(unknownValidTypes(types, ctx.site.entityTypes).map((type) => type.name));
}

/** The valid types a payload carries. */
function carriedTypes(properties: readonly PropertyWrite[]): string[] {
	return properties.flatMap((property) =>
		property.property_name === 'valid_types' && Array.isArray(property.value) ? property.value : []
	);
}

/** The effect of a write, with the reverse fields it made when it carried valid types. */
function effectOf(kind: 'created' | 'updated', name: string, fresh: PlanItem, properties: readonly PropertyWrite[]): FieldEffect {
	const effect: FieldEffect = { kind, name };
	if (carriedTypes(properties).length > 0 && fresh.reverseFieldTypes.length > 0) effect.reverseFieldTypes = [...fresh.reverseFieldTypes];
	return effect;
}

/**
 * Reads the field back and checks it against the entry (RUN-15): it must plan as "already
 * matches", the property PLN-20 asks for. Null when it does.
 */
async function verify(ctx: ItemContext, entry: PlanEntry, item: PlanItem, after: WriteKind): Promise<ItemResult | null> {
	const { read, failure } = await readNow(ctx, item);
	if (read === null) {
		const refusal = asRefusal(failure);
		const message = errorMessage(failure);
		return failed({ code: 'unreadable', after, message }, refusal ? null : message);
	}
	if (read.kind === 'absent') return failed({ code: 'unreadable', after, message: null });
	const fresh = plan(ctx, entry, read);
	if (fresh.class === 'already-matches') return null;
	if (fresh.class === 'type-conflict') return failed({ code: 'plan', reasons: fresh.reasons });
	return failed({ code: 'not-applied', after, differences: diffEntry(entry, read.field) });
}

/**
 * Sends an update's one request, then reads back. Null when the field then matches. The site
 * applies a request whole or not at all (finding 121), so a refusal means nothing was written.
 *
 * Exported for its own test: `fresh` is always this module's re-plan of the entry, so the guard
 * below cannot be reached through `applyItem` while the first guard there holds.
 */
export async function writeAndVerify(ctx: ItemContext, entry: PlanEntry, fresh: PlanItem, after: WriteKind): Promise<ItemResult | null> {
	if (fresh.update === null) throw new Error('An update item has no request.');
	const { properties } = fresh.update;
	// The last line before the write: a wrong-case valid type sent here takes the field down (finding 121).
	const unknown = strays(ctx, carriedTypes(properties));
	if (unknown.length > 0) return failed({ code: 'unknown-valid-types', names: unknown });
	try {
		await ctx.port.updateField(fresh.entityType, fresh.programmaticName, properties);
	} catch (error) {
		return threw('update', error);
	}
	ctx.onEffect(effectOf('updated', fresh.programmaticName, fresh, properties));
	return verify(ctx, entry, fresh, after);
}

/** Puts a field the run just made back in the trash, and reads to see that it went (RUN-10, RUN-12). */
async function retrash(ctx: ItemContext, entityType: string, name: string): Promise<Retrash & { abort: string | null }> {
	try {
		await ctx.port.retireField(entityType, name);
	} catch (error) {
		const message = errorMessage(error);
		return { retired: false, retireError: message, abort: asRefusal(error) ? null : message };
	}
	try {
		const read = await ctx.reader.field(entityType, name);
		if (read.kind === 'present') {
			return { retired: false, retireError: 'The site answered success and the field is still live.', abort: null };
		}
	} catch (error) {
		// The delete was answered. Only the check failed: the field is taken as retired.
		ctx.onEffect({ kind: 'retired', name });
		return { retired: true, retireError: null, abort: asRefusal(error) ? null : errorMessage(error) };
	}
	ctx.onEffect({ kind: 'retired', name });
	return { retired: true, retireError: null, abort: null };
}

/** RUN-8: the create found the field live. */
function foundLive(ctx: ItemContext, entry: PlanEntry, read: LiveFieldRead & { kind: 'present' }): ItemResult {
	const fresh = plan(ctx, entry, read);
	if (fresh.class === 'type-conflict') return skipped({ code: 'plan', reasons: fresh.reasons });
	return skipped({ code: 'already-exists', differences: diffEntry(entry, read.field) }, 'existing');
}

async function applyUpdate(ctx: ItemContext, entry: PlanEntry, item: PlanItem): Promise<ItemResult> {
	const { read, failure } = await readNow(ctx, item);
	if (read === null) return threw('read', failure);
	if (read.kind === 'absent' && read.reason === 'does-not-exist') return failed({ code: 'gone' });
	const fresh = plan(ctx, entry, read);
	if (fresh.class === 'already-matches') return skipped({ code: 'nothing-to-change' }, 'existing');
	if (fresh.class !== 'update') return failed({ code: 'plan', reasons: fresh.reasons });
	return (await writeAndVerify(ctx, entry, fresh, 'update')) ?? done('existing');
}

/** RUN-10: the revive answered 204. */
async function afterRevive(ctx: ItemContext, entry: PlanEntry, item: PlanItem): Promise<ItemResult> {
	ctx.onEffect({ kind: 'revived', name: item.programmaticName });
	const { read, failure } = await readNow(ctx, item);
	if (read === null) {
		const message = errorMessage(failure);
		return failed({ code: 'unreadable', after: 'revive', message }, asRefusal(failure) ? null : message);
	}
	if (read.kind === 'absent') return failed({ code: 'unreadable', after: 'revive', message: null });

	const fresh = plan(ctx, entry, read);
	if (fresh.class === 'already-matches') return done('new');
	if (fresh.class === 'update') return (await writeAndVerify(ctx, entry, fresh, 'revive')) ?? done('new');

	// It cannot be made to match: back to the trash it goes.
	const { abort, ...back } = await retrash(ctx, item.entityType, item.programmaticName);
	const trashPageUrl = ctx.site.trashPageUrl;
	if (fresh.class === 'type-conflict') {
		return failed({ code: 'retired-other-type', liveDataType: read.field.dataType, trashPageUrl, ...back }, abort);
	}
	return failed({ code: 'retired-blocked', reasons: fresh.reasons, trashPageUrl, ...back }, abort);
}

/**
 * RUN-11, RUN-12: nothing is retired under the name.
 *
 * Exported for its own test, as `writeAndVerify` is: its valid-types guard is the last line
 * before the create.
 */
export async function plainCreate(ctx: ItemContext, entry: PlanEntry, fresh: PlanItem): Promise<ItemResult> {
	if (fresh.create === null) throw new Error('A create item has no payload.');
	const wanted = fresh.programmaticName;
	const types = carriedTypes(fresh.create.properties);
	const unknown = strays(ctx, types);
	if (unknown.length > 0) return failed({ code: 'unknown-valid-types', names: unknown });
	let assigned: string;
	try {
		assigned = (await ctx.port.createField(fresh.entityType, fresh.create)).name;
	} catch (error) {
		const refusal = asRefusal(error);
		if (refusal && isRetiredNameRefusal(refusal)) {
			return failed({ code: 'name-retired', name: retiredNameIn(refusal) ?? wanted, trashPageUrl: ctx.site.trashPageUrl });
		}
		return threw('create', error);
	}
	if (typeof assigned !== 'string' || assigned === '') {
		// A field was made and its name is unknown. Nothing can be retired by a name nobody has.
		return failed({ code: 'wrong-name', assigned: '', retired: false, retireError: null });
	}
	ctx.onEffect(effectOf('created', assigned, fresh, fresh.create.properties));
	if (assigned !== wanted) {
		// The last guard (RUN-12). The field under the wrong name is retired: that name is spent.
		const { abort, ...back } = await retrash(ctx, fresh.entityType, assigned);
		return failed({ code: 'wrong-name', assigned, ...back }, abort);
	}
	return (await verify(ctx, entry, fresh, 'create')) ?? done('new');
}

async function applyCreate(ctx: ItemContext, entry: PlanEntry, item: PlanItem): Promise<ItemResult> {
	const { read, failure } = await readNow(ctx, item);
	if (read === null) return threw('read', failure);
	if (read.kind === 'present') return foundLive(ctx, entry, read);
	const fresh = plan(ctx, entry, read);
	if (fresh.class !== 'create') return skipped({ code: 'plan', reasons: fresh.reasons });

	let answer: ReviveAnswer;
	try {
		answer = await ctx.port.reviveField(item.entityType, item.programmaticName);
	} catch (error) {
		return threw('revive', error);
	}
	switch (readRevive(answer, item.programmaticName)) {
		case 'revived':
			return afterRevive(ctx, entry, item);
		case 'nothing-retired':
			return plainCreate(ctx, entry, fresh);
		case 'already-live': {
			const again = await readNow(ctx, item);
			if (again.read === null) return threw('read', again.failure);
			if (again.read.kind === 'present') return foundLive(ctx, entry, again.read);
			break;
		}
		case 'unknown':
			break;
	}
	// Not one of the answers the corpus measured, or one that contradicts the read. No create.
	const refusal = answer as Extract<ReviveAnswer, { revived: false }>;
	return failed({ code: 'refused', action: 'revive', status: refusal.status, message: refusal.message });
}

/**
 * Applies one item and says how it ended. Never rejects: whatever goes wrong comes back as a
 * failed result.
 *
 * `entry` is the entry the item was planned from. `item` is its plan from the run's re-plan.
 */
export async function applyItem(ctx: ItemContext, entry: PlanEntry, item: PlanItem): Promise<ItemResult> {
	try {
		switch (item.class) {
			case 'type-conflict':
			case 'refused':
			case 'blocked':
				return skipped({ code: 'plan', reasons: item.reasons });
			case 'already-matches':
				return skipped({ code: 'nothing-to-change' }, 'existing');
			case 'update':
			case 'create': {
				// Before the first call: a revive followed by a refused write would leave a field live.
				const unknown = strays(ctx, wantedEntry(entry).validTypes);
				if (unknown.length > 0) return failed({ code: 'unknown-valid-types', names: unknown });
				return item.class === 'update' ? await applyUpdate(ctx, entry, item) : await applyCreate(ctx, entry, item);
			}
		}
	} catch (error) {
		const message = errorMessage(error);
		return failed({ code: 'error', message }, message);
	}
}
