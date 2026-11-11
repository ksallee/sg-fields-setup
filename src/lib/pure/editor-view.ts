/**
 * What the editor's entry list shows (specs/05-editor.md, EDT-16 to EDT-38): which groups, in
 * what order, with which rows and counts. One call builds the whole view model; the screen draws
 * it and keeps no logic of its own.
 *
 * Decisions where the spec leaves room:
 * - The unassigned group comes last, after the named types (EDT-16).
 * - Groups sort by stored name ignoring case, numbers read as numbers: `CustomEntity2` before
 *   `CustomEntity10` (EDT-16).
 * - Search also matches the type's site display name, the label on the group header (EDT-34).
 *   The query is trimmed.
 * - The filter counts follow the search and ignore the filter itself, so each count says what
 *   picking that filter would show (EDT-35). The needs-attention highlight reads the same count.
 * - When entries exist but nothing is visible, the view says so (`no_matches`).
 */
import { ENTRY_CATEGORIES, type EntryCategory } from './category';

/** What the view reads from a row of the working copy. Rows keep their own other fields. */
export interface ViewRow {
	/** Stable and unique within the working copy. */
	key: string;
	targetEntityType: string;
	programmaticName: string;
	displayName: string;
}

/** The status filter's choices, in toolbar order (EDT-35). */
export const STATUS_FILTERS = ['all', ...ENTRY_CATEGORIES] as const;

export type StatusFilter = (typeof STATUS_FILTERS)[number];

/** The label of the group of rows with no target entity type (EDT-16). */
export const UNASSIGNED_LABEL = 'Unassigned';

export interface EditorViewInput {
	/** The working copy's rows, in its order. */
	rows: readonly ViewRow[];
	/** Each row's category against the site (CMP-8). Asked once per row. */
	categoryOf: (key: string) => EntryCategory;
	/** The site's display name for an entity type API name, or undefined when not known. */
	typeDisplayName: (apiName: string) => string | undefined;
	/** Type names the user added as empty groups this session (EDT-19). Not persisted. */
	addedGroups: readonly string[];
	search: string;
	filter: StatusFilter;
	/** The on-site-first toggle (EDT-36). */
	onSiteFirst: boolean;
	/** An "add entity type" is open: the empty message waits (EDT-22). */
	addInProgress?: boolean;
}

/** A group header's count (EDT-17). */
export interface GroupCount {
	/** Rows visible after search and filter. */
	shown: number;
	/** Rows of this type in the working copy. */
	total: number;
	/** A search or filter hides some: the count reads "shown of total". */
	partial: boolean;
}

export interface ViewGroup extends GroupCount {
	/** The trimmed stored type name; `''` for the unassigned group. Unique among the groups. */
	type: string;
	/** The header text: the site display name when known, else the stored name (EDT-17). */
	label: string;
	unassigned: boolean;
	/** An added group with no rows (EDT-19). */
	added: boolean;
	/** The group has no rows: it shows its own hint (EDT-22). */
	emptyHint: boolean;
	/** The visible rows' keys, in on-screen order. */
	keys: string[];
}

/** Rows per filter choice, over the rows the search lets through (EDT-35). */
export type FilterCounts = Record<StatusFilter, number>;

/**
 * The list's empty message: `no_entries` invites adding a type or importing (EDT-22);
 * `no_matches` says the search or filter hides every entry.
 */
export type EmptyState = 'no_entries' | 'no_matches' | null;

export interface EditorView {
	/** The visible groups, in order (EDT-16, EDT-37). */
	groups: ViewGroup[];
	/** Every visible row's key, in on-screen order, across groups. Selection ranges over it. */
	visibleKeys: string[];
	counts: FilterCounts;
	/** The needs-attention filter has a count above zero (EDT-35). */
	highlightNeedsAttention: boolean;
	/** The set has entries (EDT-38). */
	showToolbar: boolean;
	emptyState: EmptyState;
	/** The trimmed search is not blank. */
	searchActive: boolean;
	/** The filter is not `all`. */
	filterActive: boolean;
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

const CATEGORY_RANK: Record<EntryCategory, number> = Object.fromEntries(
	ENTRY_CATEGORIES.map((category, index) => [category, index])
) as Record<EntryCategory, number>;

function compareTypes(a: string, b: string): number {
	if (a === b) return 0;
	if (a === '') return 1;
	if (b === '') return -1;
	return collator.compare(a, b) || (a < b ? -1 : 1);
}

function labelFor(type: string, typeDisplayName: (apiName: string) => string | undefined): string {
	if (type === '') return UNASSIGNED_LABEL;
	const name = typeDisplayName(type)?.trim();
	return name ? name : type;
}

function normalizeQuery(search: string): string {
	return search.trim().toLowerCase();
}

function matchesQuery(row: ViewRow, query: string, typeLabel: string | undefined): boolean {
	if (query === '') return true;
	return (
		row.displayName.toLowerCase().includes(query) ||
		row.programmaticName.toLowerCase().includes(query) ||
		row.targetEntityType.toLowerCase().includes(query) ||
		(typeLabel !== undefined && typeLabel.toLowerCase().includes(query))
	);
}

/**
 * Whether a row matches a search (EDT-34): case-insensitive substring of its display name,
 * programmatic name, target entity type, or the type's site display name when given. A blank
 * search matches every row.
 */
export function matchesSearch(row: ViewRow, search: string, typeLabel: string | undefined): boolean {
	return matchesQuery(row, normalizeQuery(search), typeLabel);
}

/** A group header's count text (EDT-17): `3`, or `1 of 3` when a search or filter hides some. */
export function groupCountText(count: GroupCount): string {
	return count.partial ? `${count.shown} of ${count.total}` : `${count.total}`;
}

interface Bucket {
	type: string;
	label: string;
	total: number;
	matched: { key: string; category: EntryCategory }[];
}

/** The editor list's view model for one set's rows (EDT-16 to EDT-38). Reads its input, never changes it. */
export function buildEditorView(input: EditorViewInput): EditorView {
	const query = normalizeQuery(input.search);
	const searchActive = query !== '';
	const filterActive = input.filter !== 'all';

	const buckets = new Map<string, Bucket>();
	const bucketFor = (type: string): Bucket => {
		let bucket = buckets.get(type);
		if (!bucket) {
			bucket = { type, label: labelFor(type, input.typeDisplayName), total: 0, matched: [] };
			buckets.set(type, bucket);
		}
		return bucket;
	};

	const counts: FilterCounts = { all: 0, on_site: 0, new: 0, needs_attention: 0 };
	for (const row of input.rows) {
		const bucket = bucketFor(row.targetEntityType.trim());
		bucket.total += 1;
		const siteLabel = bucket.type === '' || bucket.label === bucket.type ? undefined : bucket.label;
		if (!matchesQuery(row, query, siteLabel)) continue;
		const category = input.categoryOf(row.key);
		counts.all += 1;
		counts[category] += 1;
		bucket.matched.push({ key: row.key, category });
	}

	const addedTypes = new Set<string>();
	for (const name of input.addedGroups) {
		const type = name.trim();
		if (type === '') continue;
		addedTypes.add(type);
		bucketFor(type);
	}

	const groups: ViewGroup[] = [];
	const visibleKeys: string[] = [];
	const ordered = [...buckets.values()].sort((a, b) => compareTypes(a.type, b.type));
	for (const bucket of ordered) {
		let rows = filterActive ? bucket.matched.filter((row) => row.category === input.filter) : bucket.matched;
		if (input.onSiteFirst) {
			// Array.prototype.sort is stable: order within a category stays.
			rows = [...rows].sort((a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category]);
		}
		const shown = rows.length;
		const added = bucket.total === 0 && addedTypes.has(bucket.type);
		const visible = shown > 0 || (!searchActive && (added || !filterActive));
		if (!visible) continue;
		const keys = rows.map((row) => row.key);
		visibleKeys.push(...keys);
		groups.push({
			type: bucket.type,
			label: bucket.label,
			unassigned: bucket.type === '',
			added,
			emptyHint: bucket.total === 0,
			keys,
			shown,
			total: bucket.total,
			partial: shown < bucket.total
		});
	}

	const hasEntries = input.rows.length > 0;
	let emptyState: EmptyState = null;
	if (!hasEntries && addedTypes.size === 0 && !input.addInProgress) emptyState = 'no_entries';
	else if (hasEntries && visibleKeys.length === 0) emptyState = 'no_matches';

	return {
		groups,
		visibleKeys,
		counts,
		highlightNeedsAttention: counts.needs_attention > 0,
		showToolbar: hasEntries,
		emptyState,
		searchActive,
		filterActive
	};
}
