/**
 * The import's note to the editor (IMP-50). The import dialog stores a new set and opens the
 * editor on it; the editor then shows a dismissible banner saying how many fields came in
 * (`importBannerText` in `$lib/pure/import-build`). The two screens share nothing but this note.
 *
 * Kept in `sessionStorage`, as `install-selection` is. One note at a time. Reading it clears it,
 * so the banner shows on the first opening of the new set and not after a reload. A note for
 * another set, unreadable storage or blocked storage all read as null: no banner.
 */

const KEY = 'sg-fields-setup:import-banner';

function session(): Storage | null {
	try {
		return sessionStorage;
	} catch {
		return null;
	}
}

/** Remembers how many fields the import stored in the set. A count of zero clears the note. */
export function writeImportBanner(setId: string, importedCount: number, storage: Storage | null = session()): void {
	try {
		if (importedCount > 0) storage?.setItem(KEY, JSON.stringify({ setId, importedCount }));
		else storage?.removeItem(KEY);
	} catch {
		/* Blocked storage: the editor opens without the banner. */
	}
}

/** How many fields were just imported into this set, or null. Reading clears the note. */
export function readImportBanner(setId: string, storage: Storage | null = session()): number | null {
	try {
		const parsed: unknown = JSON.parse(storage?.getItem(KEY) ?? 'null');
		if (parsed === null || typeof parsed !== 'object') return null;
		const { setId: owner, importedCount } = parsed as { setId?: unknown; importedCount?: unknown };
		if (owner !== setId) return null;
		storage?.removeItem(KEY);
		return typeof importedCount === 'number' && Number.isInteger(importedCount) && importedCount > 0 ? importedCount : null;
	} catch {
		return null;
	}
}
