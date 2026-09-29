/** Optional local browser regression: credential migration/recovery and keyboard activation. */
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'chrome' });
const url = process.env.GAME_URL ?? 'http://127.0.0.1:5173/';
const report = { createdAt: new Date().toISOString(), checks: [], failures: [] };
const check = (name, pass) => { report.checks.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`); if (!pass) report.failures.push(name); };
const ready = (page) => page.waitForFunction(() => window.__berigame?.me && !document.querySelector('.loading-screen'), null, { timeout: 20_000 });
const identity = (page) => page.evaluate(() => window.__berigame.me.hex);
try {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const Native = window.WebSocket;
    window.__auditSockets = [];
    window.WebSocket = class extends Native { constructor(...args) { super(...args); window.__auditSockets.push(this); } };
  });
  const page = await context.newPage();
  await page.goto(url); await ready(page);
  const originalIdentity = await identity(page);
  const scopedKey = await page.evaluate(async () => (await import('/src/spacetime/connection.ts')).TOKEN_KEY);
  const originalToken = await page.evaluate((key) => localStorage.getItem(key), scopedKey);
  check('fresh character uses a scoped credential', !!originalToken && scopedKey.startsWith('berigame_stdb_token:v2:'));
  // A fresh character's quick slots are empty (disabled), so keyboard activation is checked on Stop:
  // start a long walk, press Enter on the focused Stop button, and the character must halt short of it.
  const start = await page.evaluate(() => ({ x: window.__berigame.me.x, z: window.__berigame.me.z }));
  const goal = { x: start.x + 10, z: start.z }; // far enough that a slow page presses Stop mid-walk
  const target = await page.evaluate(({ x, z }) => window.__berigameProject(x, z, 0), goal);
  await page.mouse.click(target.x, target.y);
  await page.waitForFunction((s) => window.__berigame.me.x !== s.x || window.__berigame.me.z !== s.z, start, { timeout: 10_000 });
  await page.locator('.combat-hud .stop-button').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1_500);
  const halted = await page.evaluate(() => ({ x: window.__berigame.me.x, z: window.__berigame.me.z }));
  await page.waitForTimeout(1_200);
  const still = await page.evaluate(() => ({ x: window.__berigame.me.x, z: window.__berigame.me.z }));
  check('Enter activates focused Stop without opening chat', halted.x === still.x && halted.z === still.z
    && !(still.x === goal.x && still.z === goal.z) && await page.locator('.chat-panel').count() === 0);
  await page.locator('[data-panel="inventory"]').focus();
  await page.keyboard.press('Enter');
  await page.locator('.inventory-panel').waitFor();
  check('Enter activates the Bag button', true);
  await page.getByRole('button', { name: 'Close inventory', exact: true }).click();

  const second = await context.newPage();
  await second.goto(url); await ready(second);
  check('second tab shares the same character', await identity(second) === originalIdentity);
  await second.close();
  await page.evaluate(() => window.__auditSockets.forEach((socket) => socket.close()));
  await page.getByText('Connection interrupted', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Rejoin island', exact: true }).focus();
  await page.keyboard.press('Enter');
  await ready(page);
  check('keyboard Rejoin after socket loss preserves identity', await identity(page) === originalIdentity);
  // Digits 1-3 are quick-slot keys and i/h open panels; while typing in chat none of them may fire.
  const beforeTyping = await page.evaluate(() => ({ weapon: window.__berigame.me.weapon, hp: window.__berigame.me.hp }));
  await page.click('[data-panel="chat"]');
  await page.locator('#chat-message').pressSequentially('123 ih');
  await page.waitForTimeout(800);
  const afterTyping = await page.evaluate(() => ({ weapon: window.__berigame.me.weapon, hp: window.__berigame.me.hp }));
  check('typing shortcuts in chat leaves quick slots, weapon and panels alone', JSON.stringify(afterTyping) === JSON.stringify(beforeTyping)
    && await page.locator('#chat-message').inputValue() === '123 ih' && await page.locator('.inventory-panel').count() === 0);
  await context.close();

  // Carry a genuine local legacy credential into a fresh browser storage scope.
  // Credentials stay in this process/browser only and are never written to the report.
  // The client migrates the unscoped token only for the default local server (port 3000).
  const localDefault = /^ws:\/\/(localhost|127\.0\.0\.1|\[::1\]):3000$/.test(decodeURIComponent(scopedKey.split(':v2:')[1].split(':').slice(0, -1).join(':')));
  if (!localDefault) console.log('SKIP legacy token migration: only the default local server (port 3000) migrates');
  else {
  const legacy = await browser.newContext();
  await legacy.addInitScript((token) => { if (!sessionStorage.getItem('legacy-seeded')) { localStorage.setItem('berigame_stdb_token', token); sessionStorage.setItem('legacy-seeded', 'yes'); } }, originalToken);
  const old = await legacy.newPage(); await old.goto(url); await ready(old);
  check('legacy local token migration preserves the existing character', await identity(old) === originalIdentity);
  check('legacy migration preserves the original token copy', await old.evaluate((key) => localStorage.getItem(key) === localStorage.getItem('berigame_stdb_token'), scopedKey));
  await legacy.close();
  }

  const invalid = await browser.newContext();
  await invalid.addInitScript((key) => { if (!sessionStorage.getItem('invalid-seeded')) { localStorage.setItem(key, 'invalid-audit-token'); sessionStorage.setItem('invalid-seeded', 'yes'); } }, scopedKey);
  const bad = await invalid.newPage(); await bad.goto(url);
  await bad.getByText('Sign-in recovery', { exact: true }).waitFor();
  check('invalid sign-in has an explicit recovery path', true);
  await bad.getByRole('button', { name: 'Rejoin island', exact: true }).click();
  await bad.getByText('Sign-in recovery', { exact: true }).waitFor();
  check('ordinary Rejoin does not silently replace a stored credential', await bad.evaluate((key) => localStorage.getItem(key) === 'invalid-audit-token', scopedKey));
  await bad.locator('summary').filter({ hasText: 'Sign-in recovery' }).click();
  await bad.getByRole('button', { name: 'Start a new character', exact: true }).focus();
  await bad.keyboard.press('Enter');
  await ready(bad);
  check('explicit reset creates a connected character', !!(await identity(bad)));
  check('explicit reset backs up the prior credential and saves a new scoped token', await bad.evaluate((key) => Object.keys(localStorage).some((candidate) => candidate.startsWith(`${key}:backup:`) && localStorage.getItem(candidate) === 'invalid-audit-token') && localStorage.getItem(key) !== 'invalid-audit-token', scopedKey));
  await invalid.close();
} catch (error) { report.failures.push(String(error)); console.error(error); }
finally { await browser.close(); }
// OUT_DIR keeps ad-hoc runs out of the committed evidence folder.
const out = process.env.OUT_DIR ? `${process.env.OUT_DIR}/lifecycle-validation.json` : new URL('../../docs/art/game-review/lifecycle-validation.json', import.meta.url);
if (process.env.OUT_DIR) fs.mkdirSync(process.env.OUT_DIR, { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
process.exitCode = report.failures.length ? 1 : 0;
