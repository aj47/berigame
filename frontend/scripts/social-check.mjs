/**
 * Two-browser check of the social features against a running Vite dev server
 * and a local SpacetimeDB: invite link join, friends list, trade, speech
 * bubbles, mute and the Nearby chat filter.
 *   PLAYWRIGHT_MODULE=$(npm root -g)/playwright GAME_URL=http://127.0.0.1:5173/play node scripts/social-check.mjs
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const URL = process.env.GAME_URL ?? 'http://127.0.0.1:5173/play';
const OUT = process.env.SHOT_DIR ?? '/tmp/social-shots';
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  (' + extra + ')' : ''}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = (page) => page.evaluate(() => window.__berigame ?? null);
const waitFor = async (page, label, fn, timeout = 20_000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const s = await state(page).catch(() => null);
    if (s && fn(s)) return s;
    await sleep(150);
  }
  throw new Error(`timeout: ${label}`);
};
const project = (page, x, z, y = 1) => page.evaluate(([x, z, y]) => window.__berigameProject(x, z, y), [x, z, y]);
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}` }).catch((e) => console.log(`screenshot skipped: ${e.message.split('\n')[0]}`));
/** A DOM click without Playwright's actionability waits (the software-rendered canvas can starve them). */
const tap = async (page, selector) => {
  await page.waitForSelector(selector, { state: 'attached', timeout: 30_000 });
  await page.$eval(selector, (el) => el.click());
};
const toastText = (page) => page.locator('.toast').textContent({ timeout: 1000 }).catch(() => '');

async function pickBerry(page) {
  const chip = page.locator('.goal-chip');
  for (let i = 0; i < 40; i++) {
    const n = await page.evaluate(() => [...document.querySelectorAll('.combat-hud .hotbar-slot')].filter((el) => /berry/i.test(el.getAttribute('aria-label') ?? '')).length);
    if (n > 0) return true;
    if (await chip.isEnabled().catch(() => false)) await chip.click().catch(() => {});
    await sleep(1500);
  }
  return false;
}

async function openMenuOn(page, hex) {
  for (let i = 0; i < 6; i++) {
    const s = await state(page);
    const other = s.players.find((p) => p.hex === hex);
    const p = await project(page, other.x, other.z, 1.1);
    await page.mouse.click(p.x, p.y);
    try { await page.waitForSelector('.click-dropdown', { timeout: 3000 }); return; } catch { await sleep(500); }
  }
  throw new Error('menu did not open');
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const errors = { A: [], B: [] };
const open = async (name, url, options) => {
  const ctx = await browser.newContext(options);
  const page = await ctx.newPage();
  page.setDefaultTimeout(60_000);
  page.on('pageerror', (e) => errors[name].push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors[name].push(m.text()); });
  await page.goto(url);
  await waitFor(page, `${name} has own player`, (s) => s.me !== null, 120_000);
  await page.waitForFunction(() => !document.querySelector('.loading-screen'), null, { timeout: 120_000 });
  return page;
};

try {
  const A = await open('A', URL, { viewport: { width: 1280, height: 800 } });
  const aHex = (await state(A)).me.hex;
  await A.evaluate(() => {}); // settle

  // A picks a berry (walks to a tree), then makes an invite link from Chat > Friends.
  check('A picks a berry', await pickBerry(A));
  await tap(A, '[data-panel="chat"]');
  await tap(A, '[data-testid="open-friends"]');
  await tap(A, '.friends-invite > summary');
  await tap(A, '[data-testid="make-invite"]');
  const link = await A.locator('[data-testid="invite-link"]').inputValue({ timeout: 20_000 });
  check('invite link carries only ?join=CODE', /\?join=[2-9A-HJ-NP-Z]{8}$/.test(link) && !/token|identity/i.test(link), link);
  await shot(A, '01-invite-link.png');

  // B opens the link on a phone: a new player who washes up beside A.
  const joinUrl = new globalThis.URL(link);
  const target = new globalThis.URL(URL);
  target.search = joinUrl.search;
  const B = await open('B', target.toString(), { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const bHex = (await state(B)).me.hex;
  const aNow = (await state(A)).me;
  const bJoined = await waitFor(B, 'B lands beside A', (s) => Math.max(Math.abs(s.me.x - aNow.x), Math.abs(s.me.z - aNow.z)) <= 2, 30_000).catch(() => null);
  check('the joiner lands beside the inviter', !!bJoined, bJoined ? `${bJoined.me.x},${bJoined.me.z} vs ${aNow.x},${aNow.z}` : '');
  check('the ?join code is removed from the address bar', !B.url().includes('join='), B.url());
  await A.waitForSelector('[data-testid="friend-row"]', { timeout: 20_000 });
  const rowText = await A.locator('[data-testid="friend-row"]').first().textContent();
  check('A sees B in Friends, online with area', /Online · the Grove/.test(rowText ?? ''), rowText ?? '');
  await shot(A, '02-friends-list.png');
  await tap(A, '[aria-label="Close friends"]');

  // Chat: a speech bubble above A for B; Nearby filter.
  check('B picks a berry', await pickBerry(B));
  await tap(A, '[data-panel="chat"]');
  await A.fill('#chat-message', 'Hello from the Grove! Want to swap berries?');
  await tap(A, '.chat-input-bar button[type=submit]');
  await B.waitForFunction(() => [...document.querySelectorAll('.player-chat-bubble')].some((b) => /swap berries/.test(b.textContent ?? '') && b.parentElement?.style.display !== 'none'), null, { timeout: 20_000 });
  check('B sees A\'s speech bubble', true);
  await shot(B, '03-speech-bubble-mobile.png');
  await tap(A, '.chat-mode button:has-text("Nearby")');
  const nearbyShown = await A.locator('#chat-log p').filter({ hasText: 'swap berries' }).count();
  check('Nearby shows a line said next to you', nearbyShown === 1);
  await tap(A, '[aria-label="Close chat"]');

  // Trade: A opens B's menu and asks; B accepts on the phone.
  await openMenuOn(A, bHex);
  const menu = await A.locator('.click-dropdown').textContent();
  check('player menu has Trade and Mute, with friend actions in Chat', /Trade/.test(menu) && /Mute chat/.test(menu) && !/Add friend/.test(menu), menu);
  await tap(A, '.click-dropdown button:has-text("Trade")');
  await B.waitForSelector('[data-testid="trade-request"]', { timeout: 20_000 });
  await shot(B, '04-trade-request-mobile.png');
  await tap(B, '[data-testid="trade-request"] button:has-text("Accept")');
  await A.waitForSelector('[data-testid="trade-sheet"]', { timeout: 20_000 });
  await B.waitForSelector('[data-testid="trade-sheet"]', { timeout: 20_000 });
  await tap(A, '.trade-bag .trade-chip >> nth=0');
  await B.waitForFunction(() => document.querySelectorAll('[data-testid="their-offer"] .trade-chip').length > 0, null, { timeout: 20_000 });
  await tap(B, '.trade-bag .trade-chip >> nth=0');
  await A.waitForFunction(() => document.querySelectorAll('[data-testid="their-offer"] .trade-chip').length > 0, null, { timeout: 20_000 });
  await sleep(600);
  await tap(A, '[data-testid="trade-confirm"]');
  await B.waitForFunction(() => /ready/.test(document.querySelector('[data-testid="trade-sheet"]')?.textContent ?? ''), null, { timeout: 20_000 });
  await shot(B, '05-trade-sheet-mobile.png');
  await shot(A, '06-trade-sheet-desktop.png');
  await tap(B, '[data-testid="trade-confirm"]');
  await A.waitForSelector('[data-testid="trade-sheet"]', { state: 'detached', timeout: 20_000 });
  const doneToast = await toastText(A);
  check('the trade completes for both', /Traded with/.test(doneToast), doneToast);

  // Mute: B mutes A; A's next line shows no bubble for B.
  await openMenuOn(B, aHex);
  await tap(B, '.click-dropdown button:has-text("Mute chat")');
  await sleep(4000);
  await tap(A, '[data-panel="chat"]');
  await A.fill('#chat-message', 'You should not see this bubble');
  await tap(A, '.chat-input-bar button[type=submit]');
  await sleep(3000);
  const mutedBubble = await B.evaluate(() => [...document.querySelectorAll('.player-chat-bubble')].some((b) => /should not see/.test(b.textContent ?? '') && b.parentElement?.style.display !== 'none'));
  check('a muted player\'s bubble is hidden', !mutedBubble);
  const muted = await B.evaluate(() => localStorage.getItem('berigame.chat.v1'));
  check('mute is saved in localStorage', !!muted && muted.includes('muted'), muted ?? '');

  for (const [name, list] of Object.entries(errors)) {
    const real = list.filter((e) => !/WebGL|GPU|favicon|Download the React DevTools/i.test(e));
    check(`no page errors in ${name}`, real.length === 0, real.slice(0, 3).join(' | '));
  }
} catch (e) {
  console.log('FAIL  ' + (e?.stack ?? e));
  for (const pg of browser.contexts().flatMap((c) => c.pages())) await pg.screenshot({ path: `${OUT}/../social-debug-${Math.random().toString(36).slice(2, 6)}.png` }).catch(() => {});
  failures++;
} finally {
  await browser.close();
}
console.log(failures ? `${failures} failure(s)` : 'all passed');
process.exit(failures ? 1 : 0);
