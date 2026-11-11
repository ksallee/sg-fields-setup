/**
 * The app's routes, so no screen spells a path by hand.
 *
 * - `/`: the set list. The spreadsheet import is a dialog on it, not a route.
 * - `/sets/<id>`: the editor of a set.
 * - `/sets/<id>/install`: the install of the whole set. With `?selection=1`, of the entries the
 *   editor handed over through `$lib/io/install-selection` (EDT-10, PLN-1): ids are too many
 *   and too long for a URL.
 * - `/connect`: the site and the sign-in.
 */

export const HOME_PATH = '/';
export const CONNECT_PATH = '/connect';

/** The editor of the set `id`. */
export function setPath(id: string): string {
	return `/sets/${encodeURIComponent(id)}`;
}

/** The install screen of the set `id`: the whole set, or the selection the editor stored first. */
export function installPath(id: string, options: { selection?: boolean } = {}): string {
	return `${setPath(id)}/install${options.selection ? '?selection=1' : ''}`;
}
