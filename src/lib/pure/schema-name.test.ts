import { describe, expect, it } from 'vitest';
import { isSchemaName } from './schema-name';

describe('isSchemaName', () => {
	it('takes letters, digits and underscores', () => {
		for (const name of ['Version', 'CustomEntity01', 'sg_lens_2', '_']) expect(isSchemaName(name)).toBe(true);
	});

	it('refuses a blank name, a slash, a dot, a space, a query and non-ASCII', () => {
		for (const name of ['', 'a/b', '..', 'sg lens', 'sg?x=1', 'sg_é', 'Shot\n']) expect(isSchemaName(name)).toBe(false);
	});
});
