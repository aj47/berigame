/**
 * Live check of scheduled Giant raids against a running Vite dev server and a
 * private local SpacetimeDB the CLI identity published (so it is the world
 * owner): the countdown while it sleeps, the T-1 announcement, an owner-woken
 * raid, a defeat with its reward, and the Friends panel's mentee count. Uses
 * owner SQL to place the player beside the Giant with a club (test setup only).
 *   PLAYWRIGHT_MODULE=... CHROMIUM_PATH=... GAME_URL=http://127.0.0.1:4293/play \
 *   SPACETIME_BIN=spacetime STDB_SERVER=http://127.0.0.1:4291 STDB_DB=raids SHOT_DIR=... node scripts/raid-check.mjs
 */
import fs from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const URL = process.env.GAME_URL ?? 'http://127.0.0.1:5173/play';
const OUT = process.env.SHOT_DIR ?? '/tmp/raid-shots';
const BIN = process.env.SPACETIME_BIN ?? 'spacetime';
const SERVER = process.env.STDB_SERVER ?? 'http://127.0.0.1:3000';
const DB = process.env.STDB_DB ?? 'berigame';
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  (' + extra + ')' : ''}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (q) => execFileSync(BIN, ['sql', DB, q, '--server', SERVER], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const call = (...args) => execFileSync(BIN, ['call', DB, ...args, '--server', SERVER], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const state = (page) => page.evaluate(() => window.__berigame ?? null);
const waitFor = async (label, fn, timeout = 20_000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await sleep(250);
  }
  throw new Error(`timeout: ${label}`);
};
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}` }).catch((e) => console.log(`screenshot skipped: ${e.message.split('\n')[0]}`));
const text = (page, sel) => page.locator(sel).first().textContent({ timeout: 1500 }).catch(() => '');

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60_000);
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL);
  await waitFor('own player', async () => (await state(page))?.me, 120_000);
  await page.waitForFunction(() => !document.querySelector('.loading-screen'), null, { timeout: 120_000 });
  const me = (await state(page)).me;
  const id = `0x${me.hex}`;

  // Asleep: next wake about 10 minutes out.
  call('trigger_giant_raid', '598');
  const countdown = await waitFor('countdown', async () => { const t = await text(page, '[data-testid="raid-countdown"]'); return /The Giant wakes in \d+:\d\d/.test(t) && t; });
  check('HUD countdown while it sleeps', !!countdown, countdown);
  await sleep(2500);
  await shot(page, '01-hud-countdown-and-t10-toast.png');

  // Test setup: put the player in the Boulders beside the Giant with a stone club, out of grace.
  sql(`INSERT INTO inventory_slot (id, owner, slot, item_id, quantity) VALUES (0, ${id}, 0, 'stone_club', 1)`);
  sql(`UPDATE player SET x = 53, z = 57, hp = 30, respawn_tick = 0, weapon = 'stone_club' WHERE identity = ${id}`);
  await waitFor('moved', async () => { const s = await state(page); return s.me.x === 53 && s.me.z === 57; });
  await sleep(3500);
  const asleep = await waitFor('asleep label', async () => { const t = await text(page, '[data-testid="giant-asleep"]'); return /sleeps/.test(t) && t; });
  check('sleeping Giant shows Zzz and its wake countdown', /wakes in/.test(asleep), asleep);
  await shot(page, '02-giant-asleep-zzz.png');

  // T-1 announcement: toast and a chat system line.
  call('trigger_giant_raid', '58');
  const toast = await waitFor('T-1 toast', async () => { const t = await text(page, '.toast'); return /1 minute/.test(t) && t; });
  check('T-1 announcement toast', !!toast, toast);
  await page.keyboard.press('Enter').catch(() => {});
  await sleep(600);
  let line = await text(page, '[data-testid="chat-system-line"]');
  if (!line) {
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /chat/i.test(b.getAttribute('aria-label') ?? b.textContent ?? ''))?.click());
    await sleep(600);
    line = await text(page, '[data-testid="chat-system-line"]');
  }
  check('announcement also lands in chat as a system line', /wakes in/.test(line), line);
  const lineCounts = await page.evaluate(() => [...document.querySelectorAll('[data-testid="chat-system-line"]')].map((el) => el.textContent));
  check('each world-wide event arrives exactly once (no doubled event-table delivery)', lineCounts.length === 2 && new Set(lineCounts).size === 2, JSON.stringify(lineCounts));
  await shot(page, '03-t1-announcement-chat.png');
  await page.evaluate(() => document.querySelector('.chat-panel .close-button')?.click());
  await sleep(400);

  // Keep the test player topped up while it fights (the Giant hits hard; a death drops the club).
  const heal = setInterval(() => execFile(BIN, ['sql', DB, `UPDATE player SET hp = 30 WHERE identity = ${id}`, '--server', SERVER], () => {}), 1500);
  // The owner wakes it now (the scheduled wake is replaced).
  const refused = (() => { try { execFileSync(BIN, ['call', DB, 'trigger_giant_raid', '0', '--server', SERVER, '--anonymous'], { stdio: 'pipe' }); return false; } catch { return true; } })();
  check('trigger_giant_raid is refused for a non-owner', refused);
  call('trigger_giant_raid', '0');
  const raid = sql('SELECT awake, raid_players FROM giant_raid');
  check('raid is on, counting the player in the Boulders', /true\s*\|\s*1/.test(raid), raid.split('\n').slice(-2).join(' ').trim());
  const hpRow = sql('SELECT hp, max_hp, state FROM giant');
  check('raid HP for one player is 600', /600\s*\|\s*600/.test(hpRow));
  const live = await waitFor('raid chip', async () => { const t = await text(page, '[data-testid="raid-countdown"]'); return /Giant raid!/.test(t) && t; });
  check('HUD shows the raid time left', !!live, live);
  // Face it: tap the Giant and choose Attack (walks up and keeps swinging).
  const attackViaMenu = async () => {
    for (let i = 0; i < 12; i++) {
      const p = await page.evaluate(() => window.__berigameProject(57, 57, 2));
      await page.mouse.click(p.x, p.y);
      const ok = await page.waitForSelector('.click-dropdown', { timeout: 3000 }).then(() => true).catch(() => false);
      if (ok) {
        const clicked = await page.evaluate(() => {
          const b = [...document.querySelectorAll('.click-dropdown button')].find((el) => /Attack The Giant/.test(el.textContent ?? ''));
          b?.click();
          return !!b;
        });
        if (clicked) return true;
      }
      await sleep(500);
    }
    return false;
  };
  check('the awake Giant can be attacked from its menu', await attackViaMenu());
  await sleep(3500);
  await shot(page, '04-raid-awake-fight.png');

  // Bring it low and finish it (test setup), then check the reward.
  sql(`UPDATE player SET hp = 30 WHERE identity = ${id}`);
  const nowTick = Number(/(\d+)\s*$/.exec(sql('SELECT tick FROM world').trim())?.[1] ?? 0);
  // Fresh last_hit_tick, or the lazy idle regeneration would read it as full again.
  sql(`UPDATE giant SET hp = 40, last_hit_tick = ${nowTick} WHERE id = 1`);
  // Grace for the finish (its blows skip players in grace), so the swings are not interrupted.
  sql(`UPDATE player SET respawn_tick = ${nowTick + 400} WHERE identity = ${id}`);
  await attackViaMenu();
  // Its blows interrupt the swings (as for anyone): attack again until it falls.
  const reward = await waitFor('reward toast', async () => {
    const t = await text(page, '.toast');
    if (/Giant's Tooth/.test(t)) return t;
    return null;
  }, 60_000);
  check('defeat toasts the reward', !!reward, reward);
  await shot(page, '05a-raid-defeat-topple.png');
  await sleep(3500);
  await shot(page, '05-raid-defeated-reward.png');
  clearInterval(heal);
  const after = sql('SELECT awake, last_outcome FROM giant_raid');
  check('it sleeps again after the defeat', /false\s*\|\s*1/.test(after));
  const inv = sql(`SELECT item_id, quantity FROM inventory_slot WHERE owner = ${id}`);
  check('contributor got 6 obsidian', /obsidian"?\s*\|\s*6/.test(inv));

  // Mentor count in the Friends panel (seeded mentee count; the credit rules are unit-tested).
  sql(`INSERT INTO mentor_stat (identity, mentees) VALUES (${id}, 3)`);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^chat/i.test((b.textContent ?? '').trim()))?.click());
  await sleep(500);
  await page.evaluate(() => document.querySelector('[data-testid="open-friends"]')?.click());
  const mentor = await waitFor('mentee count', async () => { const t = await text(page, '[data-testid="mentee-count"]'); return /3 newer players/.test(t) && t; }, 10_000).catch(() => '');
  check('Friends panel shows the mentee count', !!mentor, mentor);
  await shot(page, '06-friends-mentee-count.png');
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  console.log('FAIL', e.message);
  for (const p of browser.contexts().flatMap((c) => c.pages())) await shot(p, 'zz-failure.png');
  failures++;
} finally {
  await browser.close();
}
console.log(failures ? `${failures} failure(s)` : 'all passed');
process.exit(failures ? 1 : 0);
