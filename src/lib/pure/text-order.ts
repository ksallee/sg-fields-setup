/**
 * The two orders text is sorted by. Both are fixed, so a list sorts the same in every browser.
 *
 * - `compareCodeUnits`: by UTF-16 code unit, as `<` compares. Exact and stable: storage order, tie
 *   breaks, timestamps.
 * - `nameCollator`: names as a person reads them: English, case and accents ignored, digits by
 *   value ("CustomEntity2" before "CustomEntity10"). Two names it calls equal need a tie break.
 */

export function compareCodeUnits(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

export const nameCollator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
