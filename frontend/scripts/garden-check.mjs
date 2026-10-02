/**
 * Live check of the personal garden against a Vite dev server and a local
 * SpacetimeDB the CLI identity owns (so it can call the owner-only
 * garden_dev_ripen test hook instead of waiting hours):
 *   PLAYWRIGHT_MODULE=$(npm root -g)/playwright GAME_URL=http://127.0.0.1:5173/play \
 *   STDB_SERVER=http://127.0.0.1:3000 STDB_DB=berigame node scripts/garden-check.mjs
 * Picks berries, plants three plots from the tap menu, fast-forwards growth,
 * reloads (the returning-player toast), harvests, and saves screenshots.
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const URL = process.env.GAME_URL ?? 'http://127.0.0.1:5173/play';
const OUT = process.env.SHOT_DIR ?? '/tmp/garden-shots';
const SPACETIME = process.env.SPACETIME_BIN ?? 'spacetime';
const SERVER = process.env.STDB_SERVER ?? 'http://127.0.0.1:3000';
const DB = process.env.STDB_DB ?? 'berigame';
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  (' + extra + ')' : ''}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = (page) => page.evaluate(() => window.__berigame ?? null);
const project = (page, x, z, y = 0.2) => page.evaluate(([x, z, y]) => window.__berigameProject(x, z, y), [x, z, y]);
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}` }).catch((e) => console.log(`screenshot skipped: ${e.message.split('\n')[0]}`));
const toastText = (page) => page.locator('.toast').textContent({ timeout: 1000 }).catch(() => '');
const ripen = (hex, aheadMs) => execFileSync(SPACETIME, ['call', '-s', SERVER, DB, 'garden_dev_ripen', `0x${hex}`, String(aheadMs)], { stdio: 'pipe' });
/** Berries in your bag, read from the database (the goal chip must not wander off to the Giant). */
const berryCount = (hex) => {
  const out = execFileSync(SPACETIME, ['sql', '-s', SERVER, DB, `SELECT item_id, quantity FROM inventory_slot WHERE owner = 0x${hex}`], { stdio: 'pipe' }).toString();
  let n = 0;
  for (const m of out.matchAll(/"berry_\w+"\s*\|\s*(\d+)/g)) n += Number(m[1]);
  return n;
};

async function waitReady(page) {
  const start = Date.now();
  while (Date.now() - start < 120_000) {
    const s = await state(page).catch(() => null);
    if (s?.me) break;
    await sleep(300);
  }
  await page.waitForFunction(() => !document.querySelector('.loading-screen'), null, { timeout: 120_000 });
}

async function openPlotMenu(page, plot) {
  const tiles = [{ x: 21, z: 20 }, { x: 22, z: 20 }, { x: 21, z: 21 }, { x: 22, z: 21 }];
  for (let i = 0; i < 8; i++) {
    const p = await project(page, tiles[plot].x, tiles[plot].z, 0.15);
    await page.mouse.click(p.x, p.y);
    try { await page.waitForSelector('.click-dropdown', { timeout: 6000 }); return; } catch { await sleep(400); }
  }
  throw new Error(`menu did not open on plot ${plot}`);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
// Record every toast (they are short-lived), so a check cannot miss one.
await ctx.addInitScript(() => {
  window.__toasts = [];
  new MutationObserver(() => {
    const t = document.querySelector('.toast')?.textContent;
    if (t && window.__toasts[window.__toasts.length - 1] !== t) window.__toasts.push(t);
  }).observe(document, { subtree: true, childList: true, characterData: true });
});
const page = await ctx.newPage();
page.setDefaultTimeout(60_000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
try {
  await page.goto(URL);
  await waitReady(page);
  const hex = (await state(page)).me.hex;
  console.log('ready as', hex);

  // Pick a few berries with the goal chip.
  const chip = page.locator('.goal-chip');
  for (let i = 0; i < 45 && berryCount(hex) < 3; i++) {
    const text = (await chip.textContent().catch(() => '')) ?? '';
    if (/pick|search/i.test(text) && !/eat/i.test(text) && await chip.isEnabled().catch(() => false)) await chip.click().catch(() => {});
    else {
      // The chip moved on (a stick turned up): pick the nearest tree directly.
      const tree = [{ x: 20, z: 30 }, { x: 30, z: 25 }, { x: 25, z: 15 }][i % 3];
      const p = await project(page, tree.x, tree.z, 1.2);
      await page.mouse.click(p.x, p.y);
      await sleep(600);
      await page.locator('.click-dropdown .context-action:not([disabled])').first().click({ timeout: 2000 }).catch(() => {});
      await sleep(4000);
    }
    await sleep(2500);
    console.log('berries', berryCount(hex));
  }
  check('picked berries (setup)', berryCount(hex) >= 1, `${berryCount(hex)}`);

  // Walk over and plant plots 0..2 from the tap menu (the first berry you have).
  let planted = 0;
  const plantedPlots = [];
  for (let plot = 0; plot < 3; plot++) {
    await openPlotMenu(page, plot);
    const option = page.locator('.click-dropdown .context-action:not([disabled])').first();
    if (!(await option.count())) { await page.keyboard.press('Escape'); break; }
    await option.click();
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      if (await page.locator(`[data-garden-plot="${plot}"]`).count()) { planted++; plantedPlots.push(plot); break; }
    }
  }
  check('planted from the tap menu', planted >= 1, `${planted} plots`);
  await sleep(800);
  await shot(page, '01-planted-seeds.png');
  const first = plantedPlots[0] ?? 0;

  // Menu on a growing plot shows time left.
  await openPlotMenu(page, first);
  const growing = await page.locator('.click-dropdown').textContent();
  check('growing plot shows time left', /left/.test(growing ?? ''), growing?.slice(0, 80));
  await shot(page, '02-growing-menu.png');
  await page.keyboard.press('Escape');

  // Fast-forward to mixed growth stages (50 min short of ripe), then to ripe.
  ripen(hex, 50 * 60 * 1000);
  await sleep(2500);
  await shot(page, '03-growing-stages.png');
  ripen(hex, 0);
  await sleep(1500);

  // A returning player: reload and look for the ripe toast.
  await page.reload();
  await waitReady(page);
  let toast = '';
  for (let i = 0; i < 40 && !/ripe/i.test(toast); i++) { toast = (await page.evaluate(() => window.__toasts.join(' | '))) || ''; await sleep(250); }
  check('login toast: garden is ripe', /Your garden is ripe/.test(toast), toast);
  await sleep(1200);
  await shot(page, '04-ripe-login-toast.png');

  await openPlotMenu(page, first);
  const harvestBtn = page.locator('.click-dropdown .context-action', { hasText: 'Harvest' });
  check('ripe plot offers Harvest', (await harvestBtn.count()) === 1);
  await harvestBtn.click();
  for (let i = 0; i < 30 && (await page.locator(`[data-garden-plot="${first}"]`).count()); i++) await sleep(300);
  check('harvest empties the plot', (await page.locator(`[data-garden-plot="${first}"]`).count()) === 0);
  await sleep(600);
  await shot(page, '05-harvested.png');
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (e) {
  console.log('FAIL', e.message);
  failures++;
  await shot(page, 'error.png');
} finally {
  await browser.close();
}
process.exit(failures ? 1 : 0);
