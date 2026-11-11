/**
 * An entity type or field name that is one path segment of a schema address: letters, digits and
 * underscores. The io modules refuse any other name before a request leaves, so a bad name never
 * reaches the site.
 */
export function isSchemaName(name: string): boolean {
	return /^[A-Za-z0-9_]+$/.test(name);
}
