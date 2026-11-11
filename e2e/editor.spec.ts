/**
 * The way in and the editor (specs/03-set-list.md, 04-import.md, 05-editor.md): a spreadsheet
 * becomes a set, an edit is saved and survives a reload, and leaving with unsaved work asks first.
 */
import type { Page } from '@playwright/test';
import { expect, importSpreadsheet, setRow, test } from './fixtures';

const status = (page: Page) => page.locator('[data-slot="editor-status"]');

/** The editor row whose title reads `title`. */
const entryRow = (page: Page, title: string) =>
	page.locator('[data-slot="entry-row"]').filter({ has: page.locator('[data-slot="row-title"]', { hasText: new RegExp(`^${title}$`) }) });

/** Opens the row titled `title` and gives its display name a new value. */
async function rename(page: Page, title: string, to: string): Promise<void> {
	const row = entryRow(page, title);
	await row.locator('[data-slot="row-toggle"]').click();
	await row.locator('[data-slot="display-name"]').fill(to);
	await expect(status(page)).toHaveAttribute('data-status', 'dirty');
}

test('SET-1 IMP-1 IMP-49 EDT-44 EDT-46: a spreadsheet becomes a set, an edit is saved and survives a reload', async ({ page }) => {
	await importSpreadsheet(page, { name: 'Lens report' });
	await expect(page.locator('[data-slot="field-count"]')).toHaveText('3 fields');
	await expect(page.locator('[data-slot="import-banner"]')).toContainText('Imported 3 fields.');
	await expect(page.locator('[data-slot="row-title"]')).toHaveText(['Focal Length', 'Lens Type', 'Slate Note']);

	await rename(page, 'Lens Type', 'Lens Kind');
	await expect(status(page)).toHaveText('Unsaved changes');
	await page.keyboard.press('ControlOrMeta+s');
	await expect(status(page)).toHaveAttribute('data-status', 'saved');
	await expect(status(page)).toHaveText('Saved');

	await page.reload();
	await expect(status(page)).toHaveText('Saved');
	await expect(page.locator('[data-slot="row-title"]')).toHaveText(['Focal Length', 'Lens Kind', 'Slate Note']);
	await expect(page.locator('[data-slot="field-count"]')).toHaveText('3 fields');
});

test('EDT-5: leaving with unsaved changes asks; Keep editing stays, Discard changes leaves the stored set as it was', async ({ page }) => {
	await importSpreadsheet(page, { name: 'Lens report' });
	const editorUrl = page.url();
	const discard = page.locator('[data-slot="confirm-dialog"]');

	await rename(page, 'Focal Length', 'Focal Distance');
	await page.locator('[data-slot="page-back"]').click();
	await expect(discard).toBeVisible();
	await expect(discard.getByRole('heading', { name: 'Discard unsaved changes?' })).toBeVisible();

	await discard.getByRole('button', { name: 'Keep editing' }).click();
	await expect(discard).toBeHidden();
	expect(page.url()).toBe(editorUrl);
	await expect(entryRow(page, 'Focal Distance')).toBeVisible();
	await expect(status(page)).toHaveAttribute('data-status', 'dirty');

	await page.locator('[data-slot="page-back"]').click();
	await expect(discard).toBeVisible();
	await discard.getByRole('button', { name: 'Discard changes' }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(setRow(page, 'Lens report')).toBeVisible();

	await setRow(page, 'Lens report').locator('[data-slot="set-name"]').click();
	await expect(page).toHaveURL(editorUrl);
	await expect(status(page)).toHaveAttribute('data-status', 'saved');
	await expect(page.locator('[data-slot="row-title"]')).toHaveText(['Focal Length', 'Lens Type', 'Slate Note']);
});
