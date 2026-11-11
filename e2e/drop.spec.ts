import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, LENS_CSV, test } from './fixtures';

/** Drags `file` from outside the browser onto `target` and lets go: enter, over, drop. */
async function dropFile(page: Page, target: Locator, file: string): Promise<void> {
	const bytes = [...(await readFile(file))];
	const transfer = await page.evaluateHandle(
		({ bytes, name }) => {
			const data = new DataTransfer();
			data.items.add(new File([new Uint8Array(bytes)], name));
			return data;
		},
		{ bytes, name: path.basename(file) }
	);
	for (const type of ['dragenter', 'dragover', 'drop']) await target.dispatchEvent(type, { dataTransfer: transfer });
}

test('IMP-1: a spreadsheet dropped on the import dialog is read', async ({ page }) => {
	await page.goto('/');
	await page.locator('[data-slot="import-spreadsheet"]').first().click();
	const dialog = page.locator('[data-slot="import-dialog"]');
	await expect(dialog).toBeVisible();

	await dropFile(page, dialog.locator('[data-slot="file-drop"]'), LENS_CSV);
	await expect(dialog.locator('[data-slot="import-bucket"]')).toHaveCount(1);
});

test('IMP-1: a spreadsheet dropped anywhere on the import dialog is read', async ({ page }) => {
	await page.goto('/');
	await page.locator('[data-slot="import-spreadsheet"]').first().click();
	const dialog = page.locator('[data-slot="import-dialog"]');
	await expect(dialog).toBeVisible();

	await dropFile(page, dialog.getByRole('heading', { name: 'Import a spreadsheet' }), LENS_CSV);
	await expect(dialog.locator('[data-slot="import-bucket"]')).toHaveCount(1);
});

test('IMP-1: a spreadsheet dropped on the set list opens the import dialog with it', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('[data-slot="set-list-pane"]')).toBeVisible();

	await dropFile(page, page.locator('[data-slot="set-list-pane"]'), LENS_CSV);
	const dialog = page.locator('[data-slot="import-dialog"]');
	await expect(dialog).toBeVisible();
	await expect(dialog.locator('[data-slot="import-bucket"]')).toHaveCount(1);
});
