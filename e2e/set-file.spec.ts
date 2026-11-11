/** Set files (specs/03-set-list.md, D1): what one exports, one imports back, under a free name. */
import { expect, importSetFile, INSTALL_DRIVE_COUNT, INSTALL_DRIVE_NAME, setRow, test } from './fixtures';

test('D1 SET-20: an exported set file imports back as a copy with every field', async ({ page }, testInfo) => {
	await importSetFile(page);
	const row = setRow(page, INSTALL_DRIVE_NAME);
	await expect(row.locator('[data-slot="set-count"]')).toHaveText(`${INSTALL_DRIVE_COUNT} fields`);

	const downloading = page.waitForEvent('download');
	await row.getByRole('button', { name: 'Export as a set file' }).click();
	const download = await downloading;
	expect(download.suggestedFilename()).toMatch(/\.json$/);
	const file = testInfo.outputPath(download.suggestedFilename());
	await download.saveAs(file);

	await importSetFile(page, file, `${INSTALL_DRIVE_NAME} copy`);
	await expect(page.locator('[data-slot="set-row"]')).toHaveCount(2);
	await expect(setRow(page, `${INSTALL_DRIVE_NAME} copy`).locator('[data-slot="set-count"]')).toHaveText(`${INSTALL_DRIVE_COUNT} fields`);
	await expect(page.getByText(`The name "${INSTALL_DRIVE_NAME}" was taken.`)).toBeVisible();
});
