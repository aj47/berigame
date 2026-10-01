/**
 * Browser check for automatic reconnect (src/spacetime/reconnect.ts):
 *   1. server killed and restarted -> "Reconnecting…" banner, then the same character, no duplicate player rows
 *   2. server down past the retry budget -> "Connection lost — Retry"; Retry recovers once the server is back
 *   3. browser offline emulation -> banner, then recovery on `online`
 *   4. CDP slow-3G throttling -> the game still loads, ticks advance, and a drop under throttling recovers
 *
 * Needs a local server with the module published and vite pointed at it:
 *   GAME_URL=http://127.0.0.1:5173 \
 *   STDB_STOP_CMD="pkill -f 'listen-addr 127.0.0.1:3000'" \
 *   STDB_START_CMD="spacetime start --listen-addr 127.0.0.1:3000 --data-dir /tmp/stdb" \
 *   node scripts/reconnect-check.mjs
 * Without STDB_STOP_CMD/STDB_START_CMD the server-restart cases are skipped.
 * Optional: PLAYWRIGHT_MODULE (path to playwright), CHROMIUM_PATH, SHOT_DIR.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const OUT = path.resolve(process.env.SHOT_DIR ?? 'test-results/reconnect');
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.GAME_URL ?? 'http://127.0.0.1:5173';
const URL_ = `${BASE}${BASE.includes('?') ? '&' : '?'}reconnectAttempts=4&reconnectMaxMs=1500`;
const report = { at: new Date().toISOString(), checks: [], errors: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const redact = (s) => String(s).replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted credential]');
function check(name, passed, detail) {
  report.checks.push({ name, passed: Boolean(passed), detail });
  console.log(passed ? 'PASS' : 'FAIL', name, detail ? JSON.stringify(detail) : '');
  if (!passed) throw new Error(name);
}

const canRestart = Boolean(process.env.STDB_STOP_CMD && process.env.STDB_START_CMD);
let serverProc = null;
function stopServer() {
  try { execSync(process.env.STDB_STOP_CMD, { stdio: 'ignore', shell: '/bin/bash' }); } catch { /* not running */ }
  serverProc = null;
}
async function startServer() {
  serverProc = spawn('/bin/bash', ['-c', process.env.STDB_START_CMD], { stdio: 'ignore', detached: true });
  serverProc.unref();
  await sleep(2500);
}

const launch = { headless: true };
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launch);
const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => report.errors.push(redact(e.message)));

const ready = (timeout = 30_000) =>
  page.waitForFunction(() => window.__berigame?.me && !document.querySelector('.loading-screen') && !document.querySelector('.connection-banner'), null, { timeout });
const state = () => page.evaluate(() => ({
  tick: window.__berigame?.tick,
  me: window.__berigame?.me?.hex,
  rowsForMe: (window.__berigame?.players ?? []).filter((p) => p.hex === window.__berigame?.me?.hex).length,
  players: (window.__berigame?.players ?? []).length,
  banner: document.querySelector('.connection-banner')?.getAttribute('data-status') ?? null,
  bannerText: document.querySelector('.connection-banner')?.textContent ?? null,
  overlay: Boolean(document.querySelector('.loading-screen')),
  busy: document.querySelectorAll('[aria-busy="true"], .hotbar-slot.busy').length,
}));
const banner = (status, timeout = 15_000) =>
  page.waitForFunction((s) => {
    const el = document.querySelector('.connection-banner');
    return el && (!s || s.split('|').includes(el.getAttribute('data-status')));
  }, status, { timeout });
const advancing = async (timeout = 15_000) => {
  const t = (await state()).tick;
  await page.waitForFunction((t0) => window.__berigame?.tick > t0, t, { timeout });
};
async function recovered(label, baseline, timeout) {
  await ready(timeout);
  await advancing();
  const s = await state();
  check(`${label}: same character after reconnect`, s.me === baseline.me, { me: s.me?.slice(0, 8) });
  check(`${label}: exactly one player row for this character`, s.rowsForMe === 1, { rowsForMe: s.rowsForMe });
  check(`${label}: no input stuck busy`, s.busy === 0, { busy: s.busy });
  return s;
}

let cdp;
try {
  await page.goto(URL_);
  await ready(60_000);
  await advancing();
  const baseline = await state();
  report.baseline = baseline;
  check('baseline: connected with a character', Boolean(baseline.me) && baseline.rowsForMe === 1);

  if (canRestart) {
    // 1. Kill and restart the server.
    stopServer();
    await banner('reconnecting|offline', 15_000);
    const down = await state();
    await page.screenshot({ path: path.join(OUT, 'reconnecting.png') });
    check('server down: "Reconnecting…" banner, no full-screen overlay', down.banner === 'reconnecting' && !down.overlay && /Reconnecting/.test(down.bannerText), down);
    await startServer();
    await recovered('server restart', baseline, 45_000);

    // 2. Stay down past the retry budget -> give up -> manual Retry.
    stopServer();
    await banner('failed', 60_000);
    const failed = await state();
    await page.screenshot({ path: path.join(OUT, 'connection-lost.png') });
    check('gave up: "Connection lost" banner with Retry', /Connection lost/.test(failed.bannerText) && await page.getByRole('button', { name: 'Retry' }).isVisible(), failed);
    await sleep(3000);
    check('gave up: no further automatic attempts', (await state()).banner === 'failed');
    await startServer();
    await page.getByRole('button', { name: 'Retry' }).click();
    await recovered('manual Retry', baseline, 45_000);
  } else {
    report.skipped = 'server restart cases (set STDB_STOP_CMD and STDB_START_CMD)';
    console.log('SKIP server restart cases');
  }

  // 3. Browser offline emulation.
  await ctx.setOffline(true);
  await banner('reconnecting|offline', 15_000);
  const off = await state();
  await page.screenshot({ path: path.join(OUT, 'offline.png') });
  check('offline: banner shown, no full-screen overlay', Boolean(off.banner) && !off.overlay, off);
  await sleep(2000);
  await ctx.setOffline(false);
  await recovered('offline→online', baseline, 45_000);

  // 4. Slow 3G (CDP throttling): cold load, play, and a drop while throttled.
  cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  const slow3g = { offline: false, latency: 400, downloadThroughput: (500 * 1024) / 8, uploadThroughput: (500 * 1024) / 8 };
  await cdp.send('Network.emulateNetworkConditions', slow3g);
  const t0 = Date.now();
  await page.reload();
  await ready(180_000);
  await advancing(30_000);
  const slow = await state();
  report.slow3gLoadMs = Date.now() - t0;
  check('slow 3G: loads the same character and ticks advance', slow.me === baseline.me && slow.rowsForMe === 1, { loadMs: report.slow3gLoadMs });
  await cdp.send('Network.emulateNetworkConditions', { ...slow3g, offline: true });
  await banner('reconnecting|offline', 20_000);
  await sleep(1500);
  await cdp.send('Network.emulateNetworkConditions', slow3g);
  await recovered('slow 3G drop', baseline, 90_000);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  check('no JavaScript page errors', report.errors.length === 0, report.errors);
  report.status = 'passed';
} catch (e) {
  report.status = 'failed';
  report.failure = redact(e.stack ?? e);
  report.lastState = await state().catch(() => null);
  console.error(redact(e));
  process.exitCode = 1;
  await page.screenshot({ path: path.join(OUT, 'failure.png') }).catch(() => {});
} finally {
  await ctx.setOffline(false).catch(() => {});
  await browser.close();
  if (canRestart && serverProc === null) {
    // Leave the server running as we found it.
    try { execSync(`${process.env.STDB_STOP_CMD}`, { stdio: 'ignore', shell: '/bin/bash' }); } catch {}
    await startServer();
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, out: OUT, failure: report.failure }));
}
