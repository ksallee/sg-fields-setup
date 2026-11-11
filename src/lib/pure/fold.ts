/**
 * Trimmed, without case: the one folding the planner's label check, the editor's search and the
 * import's entity type match share. Other comparisons fold differently on purpose; the table in
 * `docs/design.md` ("Comparing names") says which applies where.
 */
export function trimFold(text: string): string {
	return text.trim().toLowerCase();
}
