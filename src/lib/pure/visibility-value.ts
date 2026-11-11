/**
 * A field's `visible` setting, as one project reads it.
 *
 * `visible` is per project (corpus `findings/115_field_visibility_per_project`). A schema read
 * with `?project_id=N` carries `visible: { value, editable }` on every field: `value` is whether
 * that project shows the field, `editable` whether the site lets it be hidden or shown
 * (`findings/056`). Without a project every field reads true. A hidden field is still returned.
 */

/** One field in one project. */
export interface FieldVisibility {
	visible: boolean;
	/** `visible.editable`: whether the site lets the value change. Null when the record does not say. */
	editable: boolean | null;
}

/** The one property a visibility write sends. */
export type VisibleWrite = [{ property_name: 'visible'; value: boolean }];

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The visibility in one field record. Only a value that is `false` hides: a missing value means
 * visible (VIS-7). The key was never seen missing (finding 115), so this is a guard. A value that
 * came bare is taken as the value. Null when the record is not an object.
 */
export function readVisibility(record: unknown): FieldVisibility | null {
	if (!isRecord(record)) return null;
	const setting = record['visible'];
	if (!isRecord(setting)) return { visible: setting !== false, editable: null };
	const editable = setting['editable'];
	return { visible: setting['value'] !== false, editable: typeof editable === 'boolean' ? editable : null };
}

/**
 * Every field of a type, keyed by programmatic name, in the listing's order. `data` is the
 * `data` of `GET /schema/<Type>/fields?project_id=N` (VIS-8). Anything that is not an object
 * reads as no fields.
 */
export function readVisibilityListing(data: unknown): Map<string, FieldVisibility> {
	const fields = new Map<string, FieldVisibility>();
	if (!isRecord(data)) return fields;
	for (const [name, record] of Object.entries(data)) {
		const visibility = readVisibility(record);
		if (visibility) fields.set(name, visibility);
	}
	return fields;
}

/** The `properties` of the measured write: `[{ property_name: 'visible', value }]`. The project goes beside it. */
export function visibleWrite(visible: boolean): VisibleWrite {
	return [{ property_name: 'visible', value: visible }];
}
