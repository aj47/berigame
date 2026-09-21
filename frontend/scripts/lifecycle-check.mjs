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
  await page.locator('.stance-button').nth(2).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__berigame.me.stance === 2);
  check('Enter activates focused Guard without opening chat', await page.locator('.chat-panel').count() === 0);
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
  await page.click('[data-panel="chat"]');
  await page.locator('#chat-message').pressSequentially('123 ih');
  check('typing shortcuts in chat preserves stance', await page.evaluate(() => window.__berigame.me.stance === 2));
  await context.close();

  // Carry a genuine local legacy credential into a fresh browser storage scope.
  // Credentials stay in this process/browser only and are never written to the report.
  const legacy = await browser.newContext();
  await legacy.addInitScript((token) => { if (!sessionStorage.getItem('legacy-seeded')) { localStorage.setItem('berigame_stdb_token', token); sessionStorage.setItem('legacy-seeded', 'yes'); } }, originalToken);
  const old = await legacy.newPage(); await old.goto(url); await ready(old);
  check('legacy local token migration preserves the existing character', await identity(old) === originalIdentity);
  check('legacy migration preserves the original token copy', await old.evaluate((key) => localStorage.getItem(key) === localStorage.getItem('berigame_stdb_token'), scopedKey));
  await legacy.close();

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
const out = new URL('../../docs/art/game-review/lifecycle-validation.json', import.meta.url);
fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
process.exitCode = report.failures.length ? 1 : 0;
