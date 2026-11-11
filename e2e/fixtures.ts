/**
 * What every browser test runs with. Tests import `test` and `expect` from here, never from
 * `@playwright/test`.
 *
 * - A guard on the browser context: a request to any host but this machine is aborted, and the
 *   test fails with the address. Data and blob addresses never reach it. `toleratedHosts` lets a
 *   test keep a known leak aborted without failing.
 * - A Content Security Policy violation fails the test, seen from the console and from the
 *   page's own `securitypolicyviolation` event. So does an uncaught page error.
 *
 * Each test gets a fresh context, so a fresh IndexedDB: no test sees another's sets.
 *
 * The helpers seed through the screens, as a person would.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type Page } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The set every install case of the fake site is seeded for (`src/lib/io/install-site-fake.ts`). */
export const INSTALL_DRIVE_FILE = path.join(ROOT, 'fixtures/install-drive/install-drive.fieldset.json');
export const INSTALL_DRIVE_NAME = 'Install drive';
export const INSTALL_DRIVE_COUNT = 13;

/** A spreadsheet of three columns, no prefixes: every column takes the fallback entity type. */
export const LENS_CSV = path.join(ROOT, 'e2e/data/lens-report.csv');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

declare global {
	interface Window {
		__cspViolations?: string[];
		__reportCsp?: (line: string) => void;
	}
}

export const test = base.extend<{ toleratedHosts: string[]; guard: void }>({
	/**
	 * Hosts whose requests are still aborted but do not fail the test. Empty by default. Only for a
	 * known leak in the app, named where it is set, with the issue that removes it.
	 */
	toleratedHosts: [[], { option: true }],
	guard: [
		async ({ context, page, toleratedHosts }, use) => {
			const offsite: string[] = [];
			const problems: string[] = [];

			await context.route('**/*', (route) => {
				const url = new URL(route.request().url());
				if (url.protocol === 'data:' || url.protocol === 'blob:' || LOCAL_HOSTS.has(url.hostname)) return route.continue();
				if (!toleratedHosts.includes(url.hostname)) offsite.push(url.href);
				return route.abort('blockedbyclient');
			});

			// Each document keeps its own list, and reports to the test too, so a page left behind still counts.
			await context.exposeFunction('__reportCsp', (line: string) => void problems.push(`csp: ${line}`));
			await context.addInitScript(() => {
				window.__cspViolations = [];
				document.addEventListener('securitypolicyviolation', (event) => {
					const line = `${event.violatedDirective} blocked ${event.blockedURI || 'inline'} on ${event.documentURI}`;
					window.__cspViolations?.push(line);
					void window.__reportCsp?.(line);
				});
			});

			page.on('console', (message) => {
				if (message.type() === 'error' && /Content Security Policy|Refused to/i.test(message.text())) problems.push(`console: ${message.text()}`);
			});
			page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));

			await use();

			const left = await page.evaluate(() => window.__cspViolations ?? []).catch(() => []);
			for (const line of left) if (!problems.includes(`csp: ${line}`)) problems.push(`csp: ${line}`);
			expect(offsite, 'requests to hosts off this machine').toEqual([]);
			expect(problems, 'CSP violations and page errors').toEqual([]);
		},
		{ auto: true }
	]
});

export { expect };

/** The id of the set a list row links to. */
async function idOf(page: Page, name: string): Promise<string> {
	const href = await setRow(page, name).locator('[data-slot="set-name"]').getAttribute('href');
	const id = href?.match(/^\/sets\/([^/?#]+)/)?.[1];
	if (!id) throw new Error(`No set id in the link of "${name}": ${href}`);
	return decodeURIComponent(id);
}

/** The list row of the set named exactly `name`. */
export function setRow(page: Page, name: string) {
	return page.locator('[data-slot="set-row"]').filter({ has: page.locator('[data-slot="set-name"]', { hasText: new RegExp(`^\\s*${escape(name)}\\s*$`) }) });
}

function escape(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "Import set file" on the list, with `file`. Waits for the row and answers the set's id. */
export async function importSetFile(page: Page, file: string = INSTALL_DRIVE_FILE, name: string = INSTALL_DRIVE_NAME): Promise<string> {
	// `about:blank` reads as the path `blank`.
	if (new URL(page.url()).pathname !== '/') await page.goto('/');
	await page.locator('[data-slot="set-file-input"]').setInputFiles(file);
	await expect(setRow(page, name)).toBeVisible();
	return idOf(page, name);
}

/**
 * "Import spreadsheet" on the list, with `file`. With no site connected the fallback entity type
 * is typed. Lands in the editor of the new set and answers its id.
 */
export async function importSpreadsheet(page: Page, options: { file?: string; fallback?: string; name: string }): Promise<string> {
	await page.goto('/');
	await page.locator('[data-slot="import-spreadsheet"]').first().click();
	const dialog = page.locator('[data-slot="import-dialog"]');
	await expect(dialog).toBeVisible();
	await dialog.locator('[data-slot="file-drop"] input[type="file"]').setInputFiles(options.file ?? LENS_CSV);
	await expect(dialog.locator('[data-slot="import-bucket"]')).toHaveCount(1);
	await dialog.getByRole('textbox', { name: /^Fallback entity type of / }).fill(options.fallback ?? 'Shot');
	await dialog.getByLabel('Set name').fill(options.name);
	await dialog.locator('[data-slot="import-confirm"]').click();
	await expect(page).toHaveURL(/\/sets\/[^/]+$/);
	const id = decodeURIComponent(new URL(page.url()).pathname.split('/')[2]);
	await expect(page.locator('[data-slot="editor-status"]')).toHaveAttribute('data-status', 'saved');
	return id;
}
