/**
 * The editor's selection, handed to the install screen (EDT-10, PLN-1). Entry ids are too many
 * and too long for a URL, so the editor writes them here and opens
 * `installPath(setId, { selection: true })`; the install screen reads them. Kept in
 * `sessionStorage`: it survives a reload of the install screen and ends with the tab.
 *
 * One selection at a time. A selection for another set, unreadable storage or blocked storage
 * all read as null. The install screen then plans nothing and says the selection was lost
 * (`$lib/pure/install-entries`): it never takes the whole set in its place.
 */

const KEY = 'sg-fields-setup:install-selection';

function session(): Storage | null {
	try {
		return sessionStorage;
	} catch {
		return null;
	}
}

/** Remembers the entries to install for the set. An empty list clears it. */
export function writeInstallSelection(setId: string, entryIds: readonly string[], storage: Storage | null = session()): void {
	try {
		if (entryIds.length === 0) storage?.removeItem(KEY);
		else storage?.setItem(KEY, JSON.stringify({ setId, entryIds }));
	} catch {
		/* Blocked storage: the install screen says the selection was lost. */
	}
}

/** The entry ids handed over for this set, or null. Reading does not clear them. */
export function readInstallSelection(setId: string, storage: Storage | null = session()): string[] | null {
	try {
		const parsed: unknown = JSON.parse(storage?.getItem(KEY) ?? 'null');
		if (parsed === null || typeof parsed !== 'object') return null;
		const { setId: owner, entryIds } = parsed as { setId?: unknown; entryIds?: unknown };
		if (owner !== setId || !Array.isArray(entryIds)) return null;
		const ids = entryIds.filter((id): id is string => typeof id === 'string');
		return ids.length > 0 ? ids : null;
	} catch {
		return null;
	}
}
