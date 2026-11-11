import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { cspDirectives } from './src/lib/pure/security-headers.ts';
import { extraSuffixes } from './src/lib/pure/site-host.ts';

export default defineConfig(({ mode }) => {
	// The Content Security Policy is fixed when the app is built. Its `connect-src` reads the same
	// variable the `/live/` endpoints read when they run, so the browser may call what they accept.
	const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
	const csp = cspDirectives(extraSuffixes(env.FPT_EXTRA_SITE_SUFFIXES));

	return {
		plugins: [
			tailwindcss(),
			sveltekit({
				compilerOptions: {
					// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
					runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},
				adapter: adapter(),
				// A nonce per response on every script, the theme script of `app.html` included.
				csp: { mode: 'nonce', directives: csp as never }
			})
		],
		test: {
			expect: { requireAssertions: true },
			projects: [
				{
					extends: './vite.config.ts',
					test: {
						name: 'server',
						environment: 'node',
						include: ['src/**/*.{test,spec}.{js,ts}'],
						exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
					}
				}
			]
		}
	};
});
