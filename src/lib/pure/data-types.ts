/**
 * FPT data types as the tool sees them: which a user may pick, what each is called, and which
 * settings each carries. Names are the API's own (corpus `doors/field_types.md`).
 */
import type { EntryDefinition } from './model';

/**
 * The data types a user may pick for a new entry, in picker order (MOD-13).
 *
 * Exactly the types the corpus measured as created: `findings/019_create_fields`, and probe G3's
 * answer in `findings/116_field_settings_create_update` (`status_list`, which needs its valid
 * values) and `findings/117_field_types_and_names` (`currency`, `timecode`, `footage`, each with a
 * name alone). `color` and `image` were measured refused (B9), `calculated` a 500.
 */
export const CREATABLE_DATA_TYPES = [
	'text',
	'number',
	'float',
	'percent',
	'currency',
	'duration',
	'timecode',
	'footage',
	'date',
	'date_time',
	'checkbox',
	'list',
	'status_list',
	'entity',
	'multi_entity',
	'url'
] as const;

export type CreatableDataType = (typeof CREATABLE_DATA_TYPES)[number];

/** Whether the type can be picked and installed. Exact match: no trimming, no case folding. */
export function isCreatable(dataType: string): dataType is CreatableDataType {
	return (CREATABLE_DATA_TYPES as readonly string[]).includes(dataType);
}

/**
 * Whether the entry is a mirror: it has a data type and that type is not creatable (MOD-14).
 * A mirror is read-only and never installed (MOD-15). An entry with no type is not a mirror, it
 * is incomplete (MOD-16).
 */
export function isMirror(entry: Pick<EntryDefinition, 'dataType'>): boolean {
	const dataType = entry.dataType.trim();
	return dataType !== '' && !isCreatable(dataType);
}

/** This app's wording for each data type, handed to the data type picker as its `labels`. */
export const DATA_TYPE_LABELS: Readonly<Record<string, string>> = {
	// Creatable.
	text: 'Text',
	number: 'Number',
	float: 'Float',
	percent: 'Percent',
	currency: 'Currency',
	duration: 'Duration',
	timecode: 'Timecode',
	footage: 'Footage',
	date: 'Date',
	date_time: 'Date and time',
	checkbox: 'Checkbox',
	list: 'List',
	status_list: 'Status list',
	entity: 'Entity link',
	multi_entity: 'Multi-entity link',
	url: 'URL',
	// Mirror types the corpus has a card for.
	color: 'Colour',
	calculated: 'Calculated',
	summary: 'Summary',
	image: 'Image',
	entity_type: 'Entity type',
	pivot_column: 'Pivot column',
	password: 'Password',
	serializable: 'Serializable',
	jsonb: 'JSON',
	uuid: 'UUID'
};

/** The name a person reads for a data type. A type with no label shows exactly as read (MOD-16). */
export function dataTypeLabel(dataType: string): string {
	return Object.hasOwn(DATA_TYPE_LABELS, dataType) ? DATA_TYPE_LABELS[dataType] : dataType;
}

/** A type-specific setting, named by its key on an entry. */
export type Setting = 'validTypes' | 'validValues' | 'uniquePerProject' | 'defaultValue';

const SETTINGS: Readonly<Record<string, readonly Setting[]>> = {
	entity: ['validTypes'],
	multi_entity: ['validTypes'],
	list: ['validValues', 'defaultValue'],
	status_list: ['validValues', 'defaultValue'],
	text: ['uniquePerProject'],
	number: ['uniquePerProject'],
	checkbox: ['defaultValue']
};

const NO_SETTINGS: readonly Setting[] = [];

/**
 * The settings a data type carries (table under "Type-specific settings", MOD-9). Empty for every
 * other type, known or not.
 */
export function settingsOf(dataType: string): readonly Setting[] {
	return Object.hasOwn(SETTINGS, dataType) ? SETTINGS[dataType] : NO_SETTINGS;
}

/** Whether a data type carries one setting: which inputs the editor shows, what cleaning keeps. */
export function carries(dataType: string, setting: Setting): boolean {
	return settingsOf(dataType).includes(setting);
}
