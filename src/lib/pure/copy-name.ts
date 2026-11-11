/** Set names: when two are the same name (MOD-2), and the name a duplicate takes (SET-18, SET-20). */

/**
 * The form of a set name that uniqueness compares: two names clash when their keys are equal
 * (MOD-2). Trimmed, Unicode-normalised (NFC) and lowercased, so "Lens", " lens " and "LENS" are
 * one name. Case is ignored because a person cannot tell two such sets apart in the list, search
 * already ignores case (SET-5), and an exported set file named after its set would collide on a
 * case-insensitive disk. Inner spaces and punctuation count. Never shown: the stored name keeps
 * its case.
 */
export function setNameKey(name: string): string {
	return name.trim().normalize('NFC').toLowerCase();
}

/**
 * The name for a copy of the set called `name`, given the names already taken.
 *
 * "<name> copy" if free, else "<name> copy 2", "<name> copy 3" and so on: the lowest free number
 * from 2, gaps filled (SET-18, SET-20, Q9). `name` is trimmed first. Taken names are compared by
 * `setNameKey`. The suffix is always added to the whole name: a copy of "Lens copy" is
 * "Lens copy copy", never a renumbered "Lens copy 2", so a set that ends in "copy" or in a number
 * of its own is never misread.
 */
export function copyName(name: string, taken: Iterable<string>): string {
	const takenKeys = new Set<string>();
	for (const takenName of taken) takenKeys.add(setNameKey(takenName));
	const base = `${name.trim()} copy`;
	if (!takenKeys.has(setNameKey(base))) return base;
	let n = 2;
	while (takenKeys.has(setNameKey(`${base} ${n}`))) n += 1;
	return `${base} ${n}`;
}
