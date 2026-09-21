/** Real browser pointer gestures: camera manipulation must not send movement. */
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const out = process.env.SHOT_DIR ?? 'docs/art/game-review/gestures';
fs.mkdirSync(out, { recursive: true });
const report = { qualification: 'Desktop Chrome mouse and CDP touch gestures; not physical-device qualification.', checks: [], errors: [] };
const browser = await chromium.launch({ channel: 'chrome' });
const check = (name, pass, detail) => {
  report.checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
  if (!pass) throw new Error(name);
};
const snapshot = page => page.evaluate(() => ({ me: window.__berigame.me, camera: window.__berigameRender.camera }));
const stationary = (a, b) => a.me.x === b.me.x && a.me.z === b.me.z;
const cameraChanged = (a, b) => a.camera.some((value, i) => Math.abs(value - b.camera[i]) > .5);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5173');
  await page.waitForFunction(() => window.__berigame?.me && window.__berigameRender && !document.querySelector('.loading-screen'));
  await delay(1600);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([id, x, y]) => ({ id, x, y })) });
  let before = await snapshot(page);
  await touch('touchStart', [[1, 100, 440]]);
  for (let i = 1; i <= 12; i++) { await touch('touchMove', [[1, 100 + i * 10, 440 + i * 3]]); await delay(30); }
  await touch('touchEnd', []); await delay(1700);
  let after = await snapshot(page);
  check('one-finger camera orbit works without walking', cameraChanged(before, after) && stationary(before, after), { before, after });

  for (const anchored of [false, true]) {
    before = await snapshot(page);
    await touch('touchStart', [[1, 140, 430], [2, 230, 430]]);
    for (let i = 1; i <= 12; i++) { await touch('touchMove', [[1, anchored ? 140 : 140 - i * 4, 430], [2, 230 + i * 5, 430]]); await delay(30); }
    await touch('touchEnd', []); await delay(1700);
    after = await snapshot(page);
    check(`${anchored ? 'anchored' : 'two-moving-finger'} pinch zoom works without walking`, cameraChanged(before, after) && stationary(before, after), { before, after });
  }
  before = await snapshot(page);
  await touch('touchStart', [[1, 100, 430]]);
  await touch('touchMove', [[1, 145, 445]]);
  await touch('touchCancel', []); await delay(1700);
  after = await snapshot(page);
  check('cancelled touch gesture does not issue movement', stationary(before, after), { before, after });
  await page.getByRole('button', { name: /^Help/ }).tap();
  await page.getByRole('button', { name: 'Reset view', exact: true }).tap();
  await page.getByRole('button', { name: 'Close help', exact: true }).tap();
  await delay(1600);
  before = await snapshot(page);
  const target = await page.evaluate(({ x, z }) => window.__berigameProject(x, z + 2, 0), before.me);
  await page.touchscreen.tap(target.x, target.y);
  await page.waitForFunction(z => window.__berigame.me.z === z, before.me.z + 2, { timeout: 8000 });
  check('tap-to-move still works after drag, pinch, touch cancellation and Reset view', true);
  await page.screenshot({ path: `${out}/touch-after-gestures.png` });

  await page.setViewportSize({ width: 1280, height: 800 }); await delay(1600);
  before = await snapshot(page);
  await page.mouse.move(440, 450); await page.mouse.down();
  await page.mouse.move(590, 490, { steps: 12 }); await page.mouse.up(); await delay(1700);
  after = await snapshot(page);
  check('mouse camera drag works without walking', cameraChanged(before, after) && stationary(before, after), { before, after });
  before = after;
  await page.mouse.wheel(0, 300); await delay(1700);
  after = await snapshot(page);
  check('mouse wheel zoom works without walking', cameraChanged(before, after) && stationary(before, after), { before, after });
  check('no page errors', report.errors.length === 0, report.errors);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = String(error); process.exitCode = 1; }
finally { await browser.close(); report.browserClosed = true; fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n'); }
