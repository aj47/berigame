/**
 * Two-browser end-to-end check against the running Vite dev server and a
 * local SpacetimeDB. Needs playwright installed locally or globally:
 *   PLAYWRIGHT_MODULE=$(npm root -g)/playwright node scripts/browser-check.mjs
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');

const URL = process.env.GAME_URL ?? 'http://127.0.0.1:5173/';
const OUT = process.env.SHOT_DIR ?? '/tmp/claude-0/stdb/shots';
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  (' + extra + ')' : ''}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = (page) => page.evaluate(() => window.__berigame ?? null);
const waitFor = async (page, label, fn, timeout = 10_000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const s = await state(page);
    if (s && fn(s)) return s;
    await sleep(100);
  }
  throw new Error(`timeout: ${label}`);
};
const project = (page, x, z, y = 1) => page.evaluate(([x, z, y]) => window.__berigameProject(x, z, y), [x, z, y]);
const clickTile = async (page, x, z, y = 0) => {
  const p = await project(page, x, z, y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
};

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'chrome' });
const errors = { A: [], B: [] };
const open = async (name) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors[name].push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors[name].push(m.text()); });
  await page.goto(URL);
  await waitFor(page, `${name} has own player`, (s) => s.me !== null, 20_000);
  await page.waitForFunction(() => !document.querySelector('.loading-screen'), null, { timeout: 20_000 });
  return page;
};

try {
  const A = await open('A');
  const B = await open('B');
  await sleep(1000);
  await A.screenshot({ path: `${OUT}/01-loaded-A.png` });
  const aHex = (await state(A)).me.hex;
  const bHex = (await state(B)).me.hex;
  await waitFor(A, 'A sees B online', (s) => s.players.some((p) => p.hex === bHex && p.online));
  await waitFor(B, 'B sees A online', (s) => s.players.some((p) => p.hex === aHex && p.online));
  check('two independent clients see one another', aHex !== bHex);
  check('tick period estimate ~600ms', Math.abs((await state(A)).period - 600) < 120, `${Math.round((await state(A)).period)}ms`);

  // Move A three tiles east by clicking the ground.
  const meA = (await state(A)).me;
  await clickTile(A, meA.x + 3, meA.z);
  const moved = await waitFor(A, 'A moved', (s) => s.me.x === meA.x + 3, 6_000);
  check('A walked to the clicked tile', moved.me.x === meA.x + 3);
  const seenByB = await waitFor(B, 'B sees A move', (s) => s.players.some((p) => p.hex === meA.hex && p.x === meA.x + 3), 4_000);
  check('B sees A at the new tile', !!seenByB);
  await A.screenshot({ path: `${OUT}/02-moved-A.png` });

  // Stance hotkeys.
  await A.keyboard.press('3');
  await waitFor(A, 'stance -> Guard', (s) => s.me.stance === 2, 3_000);
  check('key 3 sets Guard', (await state(A)).me.stance === 2);
  await A.keyboard.press('1');
  await waitFor(A, 'stance -> Strike', (s) => s.me.stance === 0, 3_000);

  // B attacks A: click A's avatar in B's page, choose Attack from the dropdown.
  const aPos = (await state(B)).players.find((p) => p.hex === meA.hex);
  await clickTile(B, aPos.x, aPos.z, 1.2);
  await B.waitForSelector('.click-dropdown', { timeout: 3_000 });
  await B.screenshot({ path: `${OUT}/03-dropdown-B.png` });
  await B.click('.click-dropdown button:has-text("Attack")');
  const bState = await waitFor(B, 'B targets A', (s) => s.me.target === meA.hex && s.me.hostile, 5_000);
  check('B is now attacking A', bState.me.target === meA.hex);
  // Both hold Strike, so the first exchanges clash: no damage, a CLASH number over A.
  await A.waitForSelector('.damage-number', { timeout: 15_000 });
  await A.screenshot({ path: `${OUT}/04-combat-A.png` });
  const firstNumber = await A.locator('.damage-number').first().textContent();
  check('first exchange renders CLASH over A', firstNumber === 'CLASH', firstNumber ?? '');
  const hud = await A.textContent('.stance-hud');
  check('HUD shows a fight state and HP', /HP\s+\d+\s*\/\s*30/.test(hud ?? ''), hud?.replace(/\s+/g, ' '));

  // A switches to Guard -> counters B's Strike; A should gain Advantage.
  await A.keyboard.press('3');
  const adv = await waitFor(A, 'A reaches Advantage', (s) => s.me.fightState === 1, 15_000);
  check('Guard vs Strike gives A the Advantage', adv.me.fightState === 1);
  // Give A real damage so the later eating check cannot pass at full HP.
  await A.keyboard.press('2');
  await waitFor(A, 'A receives damage', (s) => s.me.hp < 30, 8_000);
  await B.locator('.stop-button').click();
  await waitFor(B, 'on-screen Stop ends attack', (s) => !s.me.hostile && s.me.target === null);
  await A.keyboard.press('Escape');
  check('on-screen Stop cancels combat', true);

  // Harvest: click tree 4 (tile 30,25) in A's page.
  await A.keyboard.press('Escape');
  await clickTile(A, 30, 25, 1.5);
  await A.waitForSelector('.click-dropdown', { timeout: 3_000 });
  // A previous local run may have harvested this shared tree recently.
  for (let retry = 0; retry < 35 && !(await A.locator('.click-dropdown .context-action:enabled').count()); retry++) {
    await sleep(1000);
    await clickTile(A, 30, 25, 1.5);
  }
  await A.click('.click-dropdown button:has-text("Harvest")');
  await A.waitForSelector('.harvest-progress', { timeout: 10_000 });
  await A.screenshot({ path: `${OUT}/05-harvest-A.png` });
  await A.keyboard.press('i');
  await A.waitForSelector('.inventory-slot.filled', { timeout: 12_000 });
  check('berry appears in inventory after harvest', (await A.locator('.inventory-slot.filled').count()) === 1);
  await A.screenshot({ path: `${OUT}/06-inventory-A.png` });

  // Eat it.
  const hpBefore = (await state(A)).me.hp;
  check('eating begins below full health', hpBefore < 30);
  await A.click('.inventory-slot.filled');
  await A.getByRole('button', { name: /^Eat/ }).click();
  await A.waitForFunction(() => document.querySelectorAll('.inventory-slot.filled').length === 0);
  await waitFor(A, 'blueberry restores exactly five capped HP', (s) => s.me.hp === Math.min(30, hpBefore + 5));
  const hpAfter = (await state(A)).me.hp;
  check('eating consumes the berry and heals exactly five capped HP', hpAfter === Math.min(30, hpBefore + 5), `${hpBefore}->${hpAfter}`);
  await waitFor(B, 'B sees the heal', (s) => s.players.some((p) => p.hex === aHex && p.hp === hpAfter));

  // Chat.
  await A.keyboard.press('i');
  await A.click('[data-panel="chat"]');
  const chatText = `gg from A ${Date.now()}`;
  await A.fill('#chat-message', chatText);
  await A.getByRole('button', { name: 'Send', exact: true }).click();
  await B.click('[data-panel="chat"]');
  await B.getByRole('log').getByText(chatText, { exact: true }).waitFor({ timeout: 5_000 });
  check('chat delivered to B', true);
  await B.screenshot({ path: `${OUT}/07-chat-B.png` });

  // Refresh keeps identity.
  const hexBefore = (await state(A)).me.hex;
  await A.reload();
  const after = await waitFor(A, 'A reconnected', (s) => s.me !== null, 20_000);
  check('refresh keeps the same identity and healed HP', after.me.hex === hexBefore && after.me.hp === hpAfter);
  await A.click('[data-panel="inventory"]');
  check('refresh keeps the consumed inventory empty', await A.locator('.inventory-slot.filled').count() === 0);

  // A real inventory is lost on death, the UI disables combat, then recovers.
  await A.getByRole('button', { name: 'Close inventory', exact: true }).click();
  await B.getByRole('button', { name: 'Close chat', exact: true }).click();
  await clickTile(B, 30, 25, 1.5);
  await B.waitForSelector('.click-dropdown');
  for (let retry = 0; retry < 35 && !(await B.locator('.click-dropdown .context-action:enabled').count()); retry++) {
    await sleep(1000);
    await clickTile(B, 30, 25, 1.5);
  }
  await B.locator('.click-dropdown button:has-text("Harvest")').click();
  await B.click('[data-panel="inventory"]');
  await B.waitForSelector('.inventory-slot.filled', { timeout: 15_000 });
  check('death UI test begins with a carried berry', await B.locator('.inventory-slot.filled').count() === 1);
  await A.locator('.stance-button').nth(0).click();
  await B.locator('.stance-button').nth(1).click();
  const victim = (await state(A)).players.find((player) => player.hex === bHex);
  await clickTile(A, victim.x, victim.z, 1.1);
  await A.locator('.click-dropdown button:has-text("Attack")').click();
  await waitFor(B, 'B dies', (s) => s.me.state === 1, 40_000);
  await B.getByText('Respawning…', { exact: true }).waitFor();
  check('dead player combat controls are disabled', await B.locator('.stance-button:disabled').count() === 3);
  check('carried berry disappears from the dead player bag', await B.locator('.inventory-slot.filled').count() === 0);
  await B.screenshot({ path: `${OUT}/08-death-B.png` });
  await waitFor(B, 'B respawns at full health', (s) => s.me.state === 0 && s.me.hp === 30 && s.me.x === 25 && s.me.z === 25, 6_000);
  await waitFor(A, 'A sees respawn and stops attacking', (s) => !s.me.hostile && s.me.target === null && s.players.some((player) => player.hex === bHex && player.hp === 30));
  check('respawn restores controls and preserves inventory loss', await B.locator('.stance-button:disabled').count() === 0 && await B.locator('.inventory-slot.filled').count() === 0);
  await B.screenshot({ path: `${OUT}/09-respawn-B.png` });

  check('no page errors in A', errors.A.length === 0, errors.A.slice(0, 3).join(' | '));
  check('no page errors in B', errors.B.length === 0, errors.B.slice(0, 3).join(' | '));
} catch (e) {
  console.error('BROWSER CHECK ERROR', e);
  for (const [index, context] of browser.contexts().entries()) {
    const page = context.pages()[0];
    if (page) {
      await page.screenshot({ path: `${OUT}/failure-${index}.png` }).catch(() => {});
      console.error('Page state', await state(page).catch(() => null), 'errors', errors[index ? 'B' : 'A']);
    }
  }
  failures++;
} finally {
  await browser.close();
}
console.log(failures === 0 ? '\nALL BROWSER CHECKS PASSED' : `\n${failures} BROWSER CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
