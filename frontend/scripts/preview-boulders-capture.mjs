/**
 * Screenshots of scripts/preview-boulders.html for art review.
 *   npx vite --port 5199 &   (from frontend/)
 *   PLAYWRIGHT_MODULE=$(npm root -g)/playwright node scripts/preview-boulders-capture.mjs
 * Writes docs/art/game-review/m3-boulders/<view>.png
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = process.env.PREVIEW_URL ?? 'http://127.0.0.1:5199/scripts/preview-boulders.html';
const out = path.resolve(here, '../../docs/art/game-review/m3-boulders');
fs.mkdirSync(out, { recursive: true });
const views = (process.env.VIEWS ?? 'overview,idle,windup,slam,stomp,defeated,obsidian').split(',');
const browser = await chromium.launch({ timeout: 900_000, executablePath: process.env.CHROMIUM, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
page.on('pageerror', (e) => console.error('pageerror', e.message));
for (const view of views) {
  await page.goto(`${base}?view=${view}`, { timeout: 600_000 });
  await page.waitForFunction(() => window.__previewReady, null, { timeout: 600_000 });
  await page.waitForTimeout(view === 'windup' || view === 'stomp' ? 900 : 2500);
  await page.screenshot({ path: path.join(out, `${view}.png`) });
  console.log('wrote', `${view}.png`);
}
await browser.close();
