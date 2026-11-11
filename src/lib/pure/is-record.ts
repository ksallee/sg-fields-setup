/** A plain object: not null, not an array. The first check on any JSON a site or a file sends. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
