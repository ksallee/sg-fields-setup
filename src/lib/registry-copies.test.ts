/**
 * The registry copies in `src/lib/components/` are never edited here (CLAUDE.md). Each must read
 * as sg-widgets' file at the release of `sg-widgets-core` this app installs, with only the import
 * path rewritten: `$lib/registry/components/` there is `$lib/components/` here. Refresh them on
 * every core bump (docs/development.md, "Refreshing registry copies").
 *
 * Needs the sg-widgets checkout beside this repo (or beside its worktree folder), with its
 * release tags. Skipped where it is missing, as in CI.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import core from 'sg-widgets-core/package.json' with { type: 'json' };

const ROOT = process.cwd();
// Beside this repo, or beside its worktree folder (`../sg-fields-setup-wt/<slug>`).
const WIDGETS = [join(ROOT, '..', 'sg-widgets'), join(ROOT, '..', '..', 'sg-widgets')].find((dir) => existsSync(join(dir, '.git'))) ?? '';
const TAG = `v${core.version}`;
const COMPONENTS = join(ROOT, 'src/lib/components');

function atTag(path: string): string | null {
	try {
		return execFileSync('git', ['-C', WIDGETS, 'show', `${TAG}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
	} catch {
		return null;
	}
}

function hasTag(): boolean {
	if (WIDGETS === '') return false;
	try {
		execFileSync('git', ['-C', WIDGETS, 'rev-parse', '--verify', '--quiet', `${TAG}^{commit}`], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

/** Each copy here, and the file it copies in sg-widgets. */
function copies(): { copy: string; source: string }[] {
	const widgets = readdirSync(COMPONENTS)
		.filter((name) => /\.(svelte|ts)$/.test(name))
		.map((name) => ({ copy: `src/lib/components/${name}`, source: `packages/svelte/src/lib/registry/components/${name}` }));
	// The registry's checkbox replaces shadcn's: it draws the mixed state (docs/design.md).
	const checkbox = ['checkbox.svelte', 'index.ts'].map((name) => ({
		copy: `src/lib/components/ui/checkbox/${name}`,
		source: `packages/svelte/src/lib/components/ui/checkbox/${name}`
	}));
	return [...widgets, ...checkbox];
}

describe.skipIf(!hasTag())(`registry copies against sg-widgets ${TAG}`, () => {
	it.each(copies())('$copy differs from sg-widgets only by the import path', ({ copy, source }) => {
		const original = atTag(source);
		expect(original, `${source} is not in sg-widgets ${TAG}`).not.toBeNull();
		expect(readFileSync(join(ROOT, copy), 'utf8')).toBe(original!.replaceAll('$lib/registry/components/', '$lib/components/'));
	});
});
