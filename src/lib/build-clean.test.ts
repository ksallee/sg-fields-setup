/**
 * The build check (`scripts/check-build.mjs`, B5 of the security audit): the gates workflow runs
 * it after the build. Here its patterns are held to the dev-only source they stand for, and the
 * scan to finding them.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BUILD_OUTPUTS, DEV_ONLY_PATTERNS, findDevCode } from '../../scripts/check-build.mjs';

const root = new URL('../../', import.meta.url);
const temp = mkdtempSync(join(tmpdir(), 'build-clean-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

function output(name: string, files: Record<string, string>): string {
	const dir = join(temp, name);
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(join(dir, path, '..'), { recursive: true });
		writeFileSync(join(dir, path), text);
	}
	return dir;
}

describe('the dev-only patterns', () => {
	it('are the five', () => {
		expect(DEV_ONLY_PATTERNS.map((each) => each.pattern)).toEqual(['FPT_API_', 'client_credentials', '__installFake', 'fake.shotgrid', 'install-site-fake']);
	});

	it.each(DEV_ONLY_PATTERNS)('"$pattern" is still in $source', ({ pattern, source }) => {
		expect(readFileSync(new URL(source, root), 'utf8')).toContain(pattern);
	});

	it('scan the two folders a build writes', () => {
		expect(BUILD_OUTPUTS).toEqual(['.svelte-kit/output', '.vercel/output']);
	});
});

describe('findDevCode', () => {
	it('passes a build with none of them', () => {
		const dir = output('clean', { 'server/index.js': 'export const handler = () => notFound();', 'client/a/b.js': 'fetch("/live/session-poll")' });
		expect(findDevCode([dir])).toEqual({ found: [], scanned: 2 });
	});

	it.each(DEV_ONLY_PATTERNS)('finds "$pattern" in a nested file', ({ pattern }) => {
		const dir = output(`dirty-${pattern.replace(/\W/g, '')}`, { 'ok.js': 'fine', 'functions/x.func/chunks/y.js': `const a = "${pattern}x";` });
		expect(findDevCode([dir]).found).toEqual([{ file: join(dir, 'functions/x.func/chunks/y.js'), pattern }]);
	});

	it('refuses to pass when nothing was built', () => {
		expect(() => findDevCode([join(temp, 'absent')])).toThrow('Run the build first.');
		mkdirSync(join(temp, 'empty'));
		expect(() => findDevCode([join(temp, 'empty')])).toThrow('Run the build first.');
	});
});
