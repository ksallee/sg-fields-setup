/**
 * The name normaliser used to match a column with a live field (IMP-27).
 *
 * Rules where the spec leaves room:
 * - "Alphanumeric" means any Unicode letter, digit or combining mark, so "Durée" stays "durée" and
 *   does not collapse into "dur e". Marks are kept so scripts that write vowels as marks stay whole.
 * - The text is put in composed form (NFC) first, so a decomposed "é" equals a composed one.
 * - Lowercasing is locale-independent.
 */

const NOT_ALPHANUMERIC = /[^\p{L}\p{M}\p{N}]+/gu;

/** Trim, lowercase, one space per run of other characters, trim again. */
export function normaliseName(name: string): string {
	return name.normalize('NFC').trim().toLowerCase().replace(NOT_ALPHANUMERIC, ' ').trim();
}
