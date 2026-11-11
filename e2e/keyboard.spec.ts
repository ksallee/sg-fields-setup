/**
 * The editor by keyboard (audit M8): where focus is after a save and after a delete, and that
 * the checkboxes answer to Space. What decides it is unit-tested (`editor-session.focusAfterRemoval`,
 * the session's key map); these hold the DOM side, `app/editor/focus.ts` and `app/block-input.ts`.
 */
import { expect, importSpreadsheet, test } from './fixtures';

const status = '[data-slot="editor-status"]';
const focused = (page: import('@playwright/test').Page) =>
	page.evaluate(() => {
		const active = document.activeElement;
		return {
			slot: active?.getAttribute('data-slot') ?? active?.tagName ?? null,
			row: active?.closest('[data-row-key]')?.querySelector('[data-slot="row-title"]')?.textContent?.trim() ?? null
		};
	});

test('EDT-44 EDT-46: Ctrl+S keeps focus in the field being typed in, on a stored row and on a row stored for the first time', async ({ page }) => {
	await importSpreadsheet(page, { name: 'Keyboard save' });
	await page.locator('[data-slot="row-toggle"]').first().click();
	const name = page.locator('[data-slot="display-name"]').first();
	await name.focus();
	await name.press('ControlOrMeta+a');
	await page.keyboard.type('Focal Reach');
	await page.keyboard.press('ControlOrMeta+s');
	await expect(page.locator(status)).toHaveAttribute('data-status', 'saved');
	expect(await focused(page)).toEqual({ slot: 'display-name', row: 'Focal Reach' });
	await expect(page.locator('[data-slot="editor-pane"]')).not.toHaveAttribute('inert');
	// Typing goes on where it was.
	await page.keyboard.type('!');
	await expect(name).toHaveValue('Focal Reach!');
	await page.keyboard.press('ControlOrMeta+s');
	await expect(page.locator(status)).toHaveAttribute('data-status', 'saved');

	// A new row: its key changes when it is stored, and the list draws it again.
	await page.locator('[data-slot="add-field"]').first().focus();
	await page.keyboard.press('Enter');
	expect(await focused(page)).toEqual({ slot: 'display-name', row: 'New field' });
	await page.keyboard.type('Zoom Ratio');
	await page.getByRole('group', { name: 'Data type' }).last().getByRole('button').first().click();
	await page.getByRole('option', { name: /^\s*Text\b/ }).first().click();
	const added = page.locator('[data-slot="entry-row"]', { has: page.locator('[data-slot="row-title"]', { hasText: 'Zoom Ratio' }) });
	await added.locator('[data-slot="display-name"]').focus();
	const before = await added.getAttribute('data-row-key');
	await page.keyboard.press('ControlOrMeta+s');
	await expect(page.locator(status)).toHaveAttribute('data-status', 'saved');
	await expect(added).not.toHaveAttribute('data-row-key', before ?? '');
	expect(await focused(page)).toEqual({ slot: 'display-name', row: 'Zoom Ratio' });
});

test('EDT-33 EDT-39 EDT-43: a deleted row hands focus to its neighbour; Space selects a row; a bulk delete hands focus on too', async ({ page }) => {
	await importSpreadsheet(page, { name: 'Keyboard delete' });
	const titles = await page.locator('[data-slot="row-title"]').allTextContents();
	expect(titles).toHaveLength(3);

	// The middle row goes: the next one takes the focus.
	await page.locator('[data-slot="row-delete"]').nth(1).focus();
	await page.keyboard.press('Enter');
	await expect(page.locator('[data-slot="entry-row"]')).toHaveCount(2);
	expect(await focused(page)).toEqual({ slot: 'row-toggle', row: titles[2].trim() });

	// Space on a row's checkbox selects it. Then the selected row goes: the row before it takes the focus.
	await page.locator('[data-slot="row-check"]').nth(1).focus();
	await page.keyboard.press('Space');
	await expect(page.locator('[data-slot="selection-count"]')).toHaveText('1 selected');
	await page.locator('[data-slot="bulk-delete"]').focus();
	await page.keyboard.press('Enter');
	await expect(page.locator('[data-slot="entry-row"]')).toHaveCount(1);
	expect(await focused(page)).toEqual({ slot: 'row-toggle', row: titles[0].trim() });

	// The last row of the set goes: nothing is left but "Add entity type".
	await page.locator('[data-slot="row-delete"]').focus();
	await page.keyboard.press('Enter');
	await expect(page.locator('[data-slot="entry-row"]')).toHaveCount(0);
	expect(await focused(page)).toEqual({ slot: 'add-entity-type-button', row: null });
});
