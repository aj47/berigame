/**
 * Screenshots of scripts/preview-coast.html for art review.
 *   npx vite --port 5199 &   (from frontend/)
 *   PLAYWRIGHT_MODULE=$(npm root -g)/playwright node scripts/preview-coast-capture.mjs
 * Writes docs/art/game-review/m2-art/coast-{game,close,hand}.png
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = process.env.PREVIEW_URL ?? 'http://127.0.0.1:5199/scripts/preview-coast.html';
const out = path.resolve(here, '../../docs/art/game-review/m2-art');
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
page.on('console', (m) => console.log('console', m.text()));
page.on('pageerror', (e) => console.error('pageerror', e.message));
for (const view of ['game', 'close', 'hand']) {
  await page.goto(`${base}?view=${view}`);
  await page.waitForFunction(() => window.__previewReady, null, { timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(out, `coast-${view}.png`) });
  console.log('wrote', `coast-${view}.png`);
}
await browser.close();
