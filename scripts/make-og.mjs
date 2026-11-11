/** Renders scripts/og.html to static/og.png, 1200 by 630. Run: node scripts/make-og.mjs */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(pathToFileURL(path.join(root, 'scripts/og.html')).href);
await page.screenshot({ path: path.join(root, 'static/og.png') });
await browser.close();
