/**
 * Test helper: a live field read from a record shaped like `GET /schema/<Type>/fields` returns
 * (every value wrapped, corpus `endpoints/get_schema_type_fields`).
 */
import { readField, type LiveField } from '../live-field';

export interface FieldAttrs {
	displayName?: string;
	dataType?: string;
	description?: string;
	defaultValue?: unknown;
	validValues?: string[];
	validTypes?: string[];
	unique?: boolean;
}

export function liveRecord(entityType: string, attrs: FieldAttrs = {}): Record<string, unknown> {
	const properties: Record<string, unknown> = {
		default_value: { value: attrs.defaultValue ?? null, editable: false },
		summary_default: { value: 'none', editable: true }
	};
	if (attrs.validValues) properties['valid_values'] = { value: attrs.validValues, editable: true };
	if (attrs.validTypes) properties['valid_types'] = { value: attrs.validTypes, editable: true };
	return {
		name: { value: attrs.displayName ?? '', editable: true },
		description: { value: attrs.description ?? '', editable: true },
		entity_type: { value: entityType, editable: false },
		data_type: { value: attrs.dataType ?? 'text', editable: false },
		unique: { value: attrs.unique ?? false, editable: false },
		visible: { value: true, editable: true },
		properties
	};
}

export function makeLiveField(entityType: string, name: string, attrs: FieldAttrs = {}): LiveField {
	const field = readField(entityType, name, liveRecord(entityType, attrs));
	if (!field) throw new Error(`no field for ${entityType}.${name}`);
	return field;
}
