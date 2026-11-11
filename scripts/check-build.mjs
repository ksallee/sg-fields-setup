/**
 * Fails when the built output carries dev-only code or the name of a secret (B5 of the security
 * audit). Run after `pnpm build`: `node scripts/check-build.mjs`. The gates workflow runs it.
 *
 * What must never ship: the dev token route's body and the script key's variable names, and the
 * fake site of the install screen. `src/lib/build-clean.test.ts` holds each pattern to the source
 * it stands for, so a rename cannot leave a pattern that matches nothing.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Each pattern, and the dev-only source it is the mark of. */
export const DEV_ONLY_PATTERNS = [
	{ pattern: 'FPT_API_', source: 'src/routes/live/dev-token/+server.ts', what: 'the script key variables' },
	{ pattern: 'client_credentials', source: 'src/routes/live/dev-token/+server.ts', what: 'the dev token grant' },
	{ pattern: '__installFake', source: 'src/lib/testing/install-site-fake.ts', what: 'the fake site handle' },
	{ pattern: 'fake.shotgrid', source: 'src/lib/testing/install-site-fake.ts', what: 'the fake site address' },
	{ pattern: 'install-site-fake', source: 'src/lib/io/install-site.ts', what: 'the fake site module' }
];

/** The folders a build writes. */
export const BUILD_OUTPUTS = ['.svelte-kit/output', '.vercel/output'];

/**
 * @param {string} dir
 * @returns {Generator<string>}
 */
function* files(dir) {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		const stat = statSync(path, { throwIfNoEntry: false });
		if (!stat) continue;
		if (stat.isDirectory()) yield* files(path);
		else if (stat.isFile()) yield path;
	}
}

/**
 * Every `{file, pattern}` found under the folders. A folder that is missing is an error: nothing was built.
 * @param {readonly string[]} dirs
 * @param {readonly { pattern: string }[]} [patterns]
 */
export function findDevCode(dirs, patterns = DEV_ONLY_PATTERNS) {
	const found = [];
	let scanned = 0;
	for (const dir of dirs) {
		if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${dir} is missing. Run the build first.`);
		for (const file of files(dir)) {
			scanned += 1;
			const text = readFileSync(file, 'latin1');
			for (const { pattern } of patterns) if (text.includes(pattern)) found.push({ file, pattern });
		}
	}
	if (scanned === 0) throw new Error(`Nothing to scan in ${dirs.join(', ')}. Run the build first.`);
	return { found, scanned };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		const { found, scanned } = findDevCode(BUILD_OUTPUTS);
		if (found.length > 0) {
			for (const { file, pattern } of found) console.error(`${file}: holds "${pattern}"`);
			console.error(`The build carries dev-only code: ${found.length} match${found.length === 1 ? '' : 'es'}.`);
			process.exit(1);
		}
		console.log(`The build is clean: ${scanned} files, no dev-only code.`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}
