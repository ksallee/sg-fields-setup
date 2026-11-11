/**
 * Lists typed as text in the editor: valid values one per line (EDT-28), and valid types as a
 * comma-separated list when no site is connected (EDT-27). Data in, data out.
 */

/** A comma-separated list: items trimmed, blanks dropped, order kept (EDT-27). */
export function parseCommaList(text: string): string[] {
	return text
		.split(',')
		.map((item) => item.trim())
		.filter((item) => item !== '');
}

/** A list as one line: a comma and a space between items (EDT-27). */
export function commaListText(values: readonly string[]): string {
	return values.join(', ');
}

/** The same items in the same order. */
export function sameItems(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((item, i) => item === b[i]);
}
