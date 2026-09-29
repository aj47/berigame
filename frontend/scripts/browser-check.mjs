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

// Mirrors shared/sim (constants.ts, items.ts); this plain-node script cannot import TypeScript.
const PUNCH_DAMAGE = 3;
const MAX_HP = 30;
const FIRST_SPAWN_HP = 20;
const STICK_DAMAGE = 6;
const quickSlot = (page, n) => page.locator(`.combat-hud .hotbar-slot[data-slot="${n}"]`);
const quickLabels = (page) => page.locator('.combat-hud .hotbar-slot').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
const openBag = async (page) => { if (!(await page.locator('.inventory-panel').count())) await page.click('[data-panel="inventory"]'); await page.waitForSelector('.inventory-panel'); };
const closeBag = async (page) => { if (await page.locator('.inventory-panel').count()) await page.getByRole('button', { name: 'Close inventory', exact: true }).click(); };
const bagLabels = async (page) => { await openBag(page); return page.locator('.inventory-slot').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label'))); };
const stickSlot = async (page) => (await bagLabels(page)).findIndex((label) => /^Slot \d+: Stick\b/.test(label ?? ''));

/** Walk to a tile a few tiles at a time, so every click lands on screen. */
async function walkViaUi(page, x, z) {
  for (let step = 0; step < 12; step++) {
    const me = (await state(page)).me;
    if (me.x === x && me.z === z) return;
    const dx = Math.sign(x - me.x) * Math.min(4, Math.abs(x - me.x));
    const dz = Math.sign(z - me.z) * Math.min(4, Math.abs(z - me.z));
    await clickTile(page, me.x + dx, me.z + dz);
    await waitFor(page, 'step walked', (s) => s.me.x === me.x + dx && s.me.z === me.z + dz, 8_000).catch(() => {});
  }
  throw new Error(`could not walk to ${x},${z}`);
}

/**
 * Harvest until the 25% bonus roll puts a stick in the bag, by tapping the goal chip ("Search the berry
 * trees for a sturdy stick"), which walks to the tree with the soonest claim. Returns the bag slot or -1.
 */
async function findStickViaUi(page, timeout = 600_000) {
  const start = Date.now();
  const chip = page.locator('.goal-chip');
  while (Date.now() - start < timeout) {
    const goal = await chip.getAttribute('data-goal', { timeout: 2_000 }).catch(() => null);
    if (goal === 'wield-stick' || goal === 'reach-coast') break;
    if (goal === 'find-stick' && await chip.isEnabled().catch(() => false)) await chip.click().catch(() => {});
    await sleep(2_000);
  }
  const slot = await stickSlot(page);
  await closeBag(page);
  return slot;
}

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

  // Quick slots: a fresh character has three empty slots and punches.
  check('combat HUD shows three quick slots', (await A.locator('.combat-hud .hotbar-slot').count()) === 3);
  const emptyLabels = await quickLabels(A);
  check('empty quick slots are labelled', emptyLabels.every((label, i) => label === `Quick slot ${i + 1}: empty`), emptyLabels.join(' | '));
  check('weapon chip shows Punch', /Punch/.test((await A.textContent('.combat-hud')) ?? ''));
  const beforeKeys = (await state(A)).me;
  for (const key of ['1', '2', '3']) await A.keyboard.press(key);
  await sleep(1200);
  const afterKeys = (await state(A)).me;
  check('pressing empty quick-slot keys changes nothing', afterKeys.weapon === '' && afterKeys.hp === beforeKeys.hp, `weapon=${JSON.stringify(afterKeys.weapon)}`);

  // M1: new characters wash ashore on 20 HP, in first-spawn grace, and spawn sits in a safe ring.
  check(`a new character starts on ${FIRST_SPAWN_HP}/${MAX_HP} HP`, afterKeys.hp === FIRST_SPAWN_HP, `hp=${afterKeys.hp}`);
  check('the HUD shows the Safe badge at spawn', await B.locator('.combat-hud .safe-badge').count() === 1);
  check('the goal chip starts at Pick a berry', /Pick a berry/.test((await A.locator('.goal-chip').textContent().catch(() => '')) ?? ''));
  // B (in the safe ring) tries to attack A: the server refuses and nothing changes.
  const graceTile = (await state(B)).players.find((p) => p.hex === aHex);
  await clickTile(B, graceTile.x, graceTile.z, 1.2);
  await B.waitForSelector('.click-dropdown', { timeout: 10_000 });
  await B.screenshot({ path: `${OUT}/03a-safe-ring-B.png` });
  await B.click('.click-dropdown button:has-text("Attack")');
  await sleep(1500);
  check('an attack from the safe ring on a newcomer is refused', !(await state(B)).me.hostile && (await state(A)).me.hp === FIRST_SPAWN_HP);
  await B.keyboard.press('Escape');

  // Harvest: click tree 4 (tile 30,25) in A's page.
  await A.keyboard.press('Escape');
  await clickTile(A, 30, 25, 1.5);
  await A.waitForSelector('.click-dropdown', { timeout: 10_000 });
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
  // A harvest adds the berry and, 25% of the time, a stick in the same update.
  const harvested = await bagLabels(A);
  check('blueberry appears in quick slot 1 after harvest', /^Slot 1: Blueberry, 1\b/.test(harvested[0] ?? ''), harvested[0] ?? '');
  check('the harvest adds at most a berry and a stick', harvested.filter((l) => !/: empty/.test(l ?? '')).every((l) => /: (Blueberry|Stick)\b/.test(l ?? '')));
  await A.screenshot({ path: `${OUT}/06-inventory-A.png` });
  check('the quick slot mirrors the bag', /^Quick slot 1: Blueberry$/.test((await quickLabels(A))[0] ?? ''));

  // Eat it from the quick slot with key 1.
  const hpBefore = (await state(A)).me.hp;
  check('eating begins below full health', hpBefore < 30);
  await A.keyboard.press('1');
  await A.waitForFunction(() => !document.querySelector('.inventory-slot[aria-label^="Slot 1: Blueberry"]'));
  await waitFor(A, 'blueberry restores exactly five capped HP', (s) => s.me.hp === Math.min(30, hpBefore + 5));
  const hpAfter = (await state(A)).me.hp;
  check('quick-slot key 1 eats the berry and heals exactly five capped HP', hpAfter === Math.min(30, hpBefore + 5), `${hpBefore}->${hpAfter}`);
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
  const bagBefore = await bagLabels(A);
  await A.reload();
  const after = await waitFor(A, 'A reconnected', (s) => s.me !== null, 20_000);
  check('refresh keeps the same identity and healed HP', after.me.hex === hexBefore && after.me.hp === hpAfter);
  await A.waitForFunction(() => !document.querySelector('.loading-screen'), null, { timeout: 20_000 });
  const bagAfter = await bagLabels(A);
  check('refresh keeps the bag as it was (berry consumed)', JSON.stringify(bagAfter) === JSON.stringify(bagBefore) && !bagAfter.some((l) => /Blueberry/.test(l ?? '')));
  await closeBag(A);
  await B.getByRole('button', { name: 'Close chat', exact: true }).click();

  // Stick: harvest until one turns up, move it to a quick slot, wield it with its key, hit B with it.
  let found = await findStickViaUi(A);
  check('harvesting eventually finds a stick', found >= 0);
  if (found >= 0) {
    if (found >= 3) {
      await openBag(A);
      await A.locator('.inventory-slot').nth(found).click();
      await A.getByRole('button', { name: 'Move', exact: true }).click();
      await A.locator('.inventory-slot').nth(0).click();
      await A.waitForSelector('.inventory-slot[aria-label^="Slot 1: Stick"]', { timeout: 5_000 });
      found = 0;
      await closeBag(A);
    }
    // A found a stick, which ends A's grace 10 ticks later. B walks out of the safe ring and punches A
    // (an accepted attack ends B's own grace too), so A can hit back with the stick below.
    await clickTile(B, 25, 28);
    await waitFor(B, 'B leaves the safe ring', (s) => s.me.x === 25 && s.me.z === 28, 10_000);
    await walkViaUi(A, 27, 28);
    // The Safe badge shows while in the safe ring or in grace.
    await A.waitForSelector('.combat-hud .safe-badge', { state: 'detached', timeout: 15_000 });
    // B attacks A: click A's avatar in B's page, choose Attack from the dropdown.
    const aPos = (await state(B)).players.find((p) => p.hex === meA.hex);
    await clickTile(B, aPos.x, aPos.z, 1.2);
    await B.waitForSelector('.click-dropdown', { timeout: 10_000 });
    await B.screenshot({ path: `${OUT}/03-dropdown-B.png` });
    await B.click('.click-dropdown button:has-text("Attack")');
    const bState = await waitFor(B, 'B targets A', (s) => s.me.target === meA.hex && s.me.hostile, 5_000);
    check('B is now attacking A', bState.me.target === meA.hex);
    // Every swing is a Hit: B's bare-handed punch costs A exactly PUNCH_DAMAGE.
    const aHp = (await state(A)).me.hp;
    const punched = await waitFor(A, 'A takes a punch', (s) => s.me.hp < aHp, 15_000);
    check(`a punch deals ${PUNCH_DAMAGE}`, (aHp - punched.me.hp) % PUNCH_DAMAGE === 0 && punched.me.hp < aHp, `hp=${aHp}->${punched.me.hp}`);
    await A.waitForSelector('.damage-number', { timeout: 5_000 });
    await A.screenshot({ path: `${OUT}/04-combat-A.png` });
    const firstNumber = await A.locator('.damage-number').first().textContent();
    check('the punch renders its damage over A', (firstNumber ?? '').includes(String(PUNCH_DAMAGE)), firstNumber ?? '');
    const hud = await A.textContent('.combat-hud');
    check('HUD shows HP and the punch chip', /HP\s+\d+\s*\/\s*30/.test(hud ?? '') && /Punch/.test(hud ?? ''), hud?.replace(/\s+/g, ' '));
    await B.locator('.stop-button').click();
    await waitFor(B, 'on-screen Stop ends attack', (s) => !s.me.hostile && s.me.target === null);
    await A.keyboard.press('Escape');
    check('on-screen Stop cancels combat', true);
    await A.keyboard.press(String(found + 1));
    await waitFor(A, 'A wields the stick', (s) => s.me.weapon === 'stick', 5_000);
    check('the quick-slot key wields the stick', (await quickSlot(A, found).getAttribute('aria-pressed')) === 'true'
      && (await quickSlot(A, found).getAttribute('aria-label')) === `Quick slot ${found + 1}: Stick, wielded`);
    check('weapon chip shows the stick damage', new RegExp(`Stick\\s*·\\s*${STICK_DAMAGE}`).test((await A.textContent('.combat-hud')) ?? ''));
    await waitFor(B, 'B sees the stick in A\'s hand', (s) => s.players.some((p) => p.hex === aHex && p.weapon === 'stick'), 5_000);
    const avatarWeapon = await B.evaluate((hex) => (window.__berigameAvatars?.() ?? []).find((a) => a.identity === hex)?.weapon, aHex);
    check('B renders A holding the stick', avatarWeapon === 'stick', String(avatarWeapon));
    const bHp = (await state(B)).me.hp;
    const bTile = (await state(A)).players.find((p) => p.hex === bHex);
    await clickTile(A, bTile.x, bTile.z, 1.1);
    await A.locator('.click-dropdown button:has-text("Attack")').click();
    const struck = await waitFor(B, 'B takes a stick hit', (s) => s.me.hp < bHp, 20_000);
    check(`a stick hit deals ${STICK_DAMAGE}`, bHp - struck.me.hp === STICK_DAMAGE, `${bHp}->${struck.me.hp}`);
    await A.screenshot({ path: `${OUT}/07b-stick-A.png` });
    await A.locator('.stop-button').click();
    await waitFor(A, 'A stops', (s) => !s.me.hostile);
    await A.keyboard.press(String(found + 1));
    await waitFor(A, 'the same key puts the stick away', (s) => s.me.weapon === '', 5_000);
    check('pressing the wielded slot again returns to punching', /Punch/.test((await A.textContent('.combat-hud')) ?? ''));
  }

  // A real inventory is lost on death, the UI disables combat, then recovers.
  await clickTile(B, 30, 25, 1.5);
  await B.waitForSelector('.click-dropdown');
  for (let retry = 0; retry < 35 && !(await B.locator('.click-dropdown .context-action:enabled').count()); retry++) {
    await sleep(1000);
    await clickTile(B, 30, 25, 1.5);
  }
  await B.locator('.click-dropdown button:has-text("Harvest")').click();
  await B.click('[data-panel="inventory"]');
  await B.waitForSelector('.inventory-slot.filled', { timeout: 15_000 });
  check('death UI test begins with a carried berry', /^Slot 1: Blueberry\b/.test((await bagLabels(B))[0] ?? ''));
  check('the carried berry enables quick slot 1', await quickSlot(B, 0).isEnabled());
  const victim = (await state(A)).players.find((player) => player.hex === bHex);
  await clickTile(A, victim.x, victim.z, 1.1);
  await A.locator('.click-dropdown button:has-text("Attack")').click();
  await waitFor(B, 'B dies', (s) => s.me.state === 1, 40_000);
  await B.getByText('Respawning…', { exact: true }).waitFor();
  check('dead player quick slots are disabled', await B.locator('.hotbar-slot:disabled').count() === 3);
  check('carried berry disappears from the dead player bag', await B.locator('.inventory-slot.filled').count() === 0);
  await B.screenshot({ path: `${OUT}/08-death-B.png` });
  await waitFor(B, 'B respawns at full health', (s) => s.me.state === 0 && s.me.hp === 30 && s.me.x === 25 && s.me.z === 25, 6_000);
  await waitFor(A, 'A sees respawn and stops attacking', (s) => !s.me.hostile && s.me.target === null && s.players.some((player) => player.hex === bHex && player.hp === 30));
  const respawnLabels = await quickLabels(B);
  check('respawn restores the HUD and preserves inventory loss', !(await B.getByText('Respawning…', { exact: true }).count())
    && respawnLabels.every((label, i) => label === `Quick slot ${i + 1}: empty`) && await B.locator('.inventory-slot.filled').count() === 0);
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
