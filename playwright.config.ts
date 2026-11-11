/**
 * The browser tests (`e2e/`, docs/development.md "Browser tests"). Chromium on the dev server, on
 * its own port. The site variables are blanked for that server, so a `.env.local` never connects
 * a test to a real site: a variable already set wins over the file.
 */
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? '5299');
const ci = Boolean(process.env.CI);

export default defineConfig({
	testDir: 'e2e',
	fullyParallel: true,
	forbidOnly: ci,
	retries: ci ? 1 : 0,
	reporter: ci ? [['html', { open: 'never' }], ['list']] : 'list',
	use: {
		baseURL: `http://localhost:${port}`,
		trace: 'on-first-retry'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: `pnpm dev --port ${port} --strictPort`,
		url: `http://localhost:${port}`,
		reuseExistingServer: false,
		timeout: 60_000,
		env: {
			FPT_API_SITE_URL: '',
			FPT_API_SCRIPT_NAME: '',
			FPT_API_API_KEY: '',
			PUBLIC_FPT_SITE_URL: '',
			FPT_EXTRA_SITE_SUFFIXES: ''
		}
	}
});
