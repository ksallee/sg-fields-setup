/**
 * A spreadsheet column header split into a type hint and a field name (IMP-18 to IMP-20, IMP-32).
 *
 * Rules where the spec leaves room:
 * - The delimiter is used exactly as typed, spaces included. Only the empty string is special: it
 *   means no delimiter, so the whole header is the field name.
 * - The split is at the last occurrence found by a plain search. With "::", "Slates:::Slate" gives
 *   the hint "Slates:".
 * - The field name never keeps the prefix, whatever the mode (IMP-20). Ignoring the hint for the
 *   type is the mode's job (import-entity-type).
 */

/** Two colons, as database exports write "Table::Field" (IMP-19). */
export const DEFAULT_DELIMITER = '::';

export interface HeaderParts {
	/** The type hint, trimmed. '' when there is none. */
	hint: string;
	/** The field name, trimmed, never blank. */
	fieldName: string;
}

/**
 * Splits a header at the last delimiter. `null` when the header makes no entry: it is blank, or
 * it is only a prefix (IMP-32).
 */
export function splitHeader(header: string, delimiter: string = DEFAULT_DELIMITER): HeaderParts | null {
	const at = delimiter === '' ? -1 : header.lastIndexOf(delimiter);
	const hint = at === -1 ? '' : header.slice(0, at).trim();
	const fieldName = (at === -1 ? header : header.slice(at + delimiter.length)).trim();
	return fieldName === '' ? null : { hint, fieldName };
}
