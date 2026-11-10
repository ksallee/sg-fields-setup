/**
 * The deploy is two files, so it is read as two files.
 *
 * Vercel builds this repo from `main` alone. `git.deploymentEnabled` names the one
 * branch it will build, and `ignoreCommand` exits 0 — "skip this build" — for every
 * other ref, which is what stops a preview on a feature branch. The adapter has to be
 * the Vercel one: `framework: "sveltekit"` makes Vercel read the build output the
 * adapter writes, and the node adapter writes something else.
 */
import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import vercel from '../../vercel.json';

const config: {
	framework?: string;
	git?: { deploymentEnabled?: Record<string, boolean> };
	ignoreCommand?: string;
	outputDirectory?: string;
} = vercel;

describe('vercel.json', () => {
	it('builds as SvelteKit and leaves the output directory to the adapter', () => {
		expect(config.framework).toBe('sveltekit');
		expect(config.outputDirectory).toBeUndefined();
	});

	it('enables main and nothing else', () => {
		expect(config.git?.deploymentEnabled).toEqual({ main: true });
	});

	it('skips the build on any ref that is not main', () => {
		expect(config.ignoreCommand).toContain('VERCEL_GIT_COMMIT_REF');
		expect(config.ignoreCommand).toContain('main');
	});
});

describe('package.json', () => {
	const devDependencies: Record<string, string> = pkg.devDependencies;

	it('carries the Vercel adapter and no longer the node one', () => {
		expect(devDependencies['@sveltejs/adapter-vercel']).toMatch(/^\^\d/);
		expect(devDependencies['@sveltejs/adapter-node']).toBeUndefined();
	});
});
