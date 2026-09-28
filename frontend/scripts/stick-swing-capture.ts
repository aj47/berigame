/**
 * Frame-by-frame capture of the stick swing in the real game, for animation review.
 * A browser player picks up a stick an SDK helper found, wields it with quick-slot
 * key 1, attacks a second SDK actor, and the page clock is paused and stepped so
 * every frame of the swing is rendered regardless of how slow the GPU is.
 *
 *   PLAYWRIGHT_MODULE=$(npm root -g)/playwright SPACETIME_DB=berigame npx tsx scripts/stick-swing-capture.ts
 *
 * Writes PNGs + contact sheet inputs to SWING_CAPTURE_DIR (default docs/art/game-review/stick-swing).
 * Needs a local SpacetimeDB and the Vite dev server (scripts/play.sh). Never deletes data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DbConnection, tables } from '../src/module_bindings';
import { EventKind, HOTBAR_SIZE, STICK_ITEM_ID, TICK_MS, chebyshev } from '../../shared/sim';
import { STICK_SWING_MS } from '../src/animation/stickSwing';

const { chromium } = createRequire(path.join(__dirname, 'stick-swing-capture.ts'))(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const URL = process.env.GAME_URL ?? 'http://127.0.0.1:5173/';
const DB = process.env.SPACETIME_DB ?? 'berigame';
const URI = process.env.SPACETIME_URI ?? 'ws://127.0.0.1:3000';
const OUT = path.resolve(process.env.SWING_CAPTURE_DIR ?? '../docs/art/game-review/stick-swing');
const STEP_MS = Number(process.env.SWING_STEP_MS ?? 40);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const connections: DbConnection[] = [];

async function waitFor<T>(label: string, fn: () => T | Promise<T>, timeout = 20_000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = await fn(); if (v) return v; await sleep(50); }
  throw new Error(`timeout: ${label}`);
}

function connect(): Promise<any> {
  return new Promise((resolve, reject) => {
    const events: any[] = [];
    const c = DbConnection.builder().withUri(URI).withDatabaseName(DB)
      .onConnectError((_c, e) => reject(e))
      .onConnect((conn, identity) => {
        conn.db.combatEvent.onInsert((_ctx, e) => events.push(e));
        conn.subscriptionBuilder().onApplied(() => resolve({ conn, identity, hex: identity.toHexString(), events }))
          .onError((_ctx, e) => reject(e))
          .subscribe([tables.world, tables.player, tables.tree, tables.combatEvent, tables.inventorySlot, tables.groundItem]);
      }).build();
    connections.push(c);
  });
}
const row = (c: any) => c.conn.db.player.identity.find(c.identity);
const tick = (c: any) => c.conn.db.world.id.find(0)?.tick ?? 0;
const sticks = (c: any) => [...c.conn.db.inventorySlot.iter()].filter((r: any) => r.owner.toHexString() === c.hex && r.itemId === STICK_ITEM_ID);

/** Harvest the nearest ripe tree until the STICK_DROP_CHANCE roll finds a stick. */
async function findStick(c: any, timeout = 480_000) {
  const start = Date.now();
  const done = () => c.events.filter((e: any) => e.kind === EventKind.HarvestDone && e.attacker.toHexString() === c.hex).length;
  while (!sticks(c).length) {
    if (Date.now() - start > timeout) throw new Error('no stick found');
    const me = row(c), T = tick(c);
    const tree = [...c.conn.db.tree.iter()].filter((t: any) => !t.harvester && t.cooldownUntilTick <= T)
      .sort((x: any, y: any) => chebyshev(me, x) - chebyshev(me, y) || x.id - y.id)[0];
    if (!tree) { await sleep(TICK_MS); continue; }
    const before = done();
    try { await c.conn.reducers.startHarvest({ treeId: tree.id }); } catch { await sleep(TICK_MS); continue; }
    try { await waitFor('harvest', () => done() > before); } catch { await c.conn.reducers.cancel({}); }
  }
}

async function main() {
  const helper = await connect();
  const dummy = await connect();
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1.5 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(e.message));
  await page.addInitScript({ content: 'window.__name = value => value;' });
  await page.clock.install();
  await page.goto(URL);
  await page.waitForFunction(() => !!(window as any).__berigame?.me && !document.querySelector('.loading-screen'), null, { timeout: 60_000 });
  const me = () => page.evaluate(() => (window as any).__berigame.me);
  const project = (x: number, z: number, y = 1) => page.evaluate(([x, z, y]: number[]) => (window as any).__berigameProject(x, z, y), [x, z, y]);
  const clickTile = async (x: number, z: number, y = 0) => { const p = await project(x, z, y); await page.mouse.click(p.x, p.y); };
  // Plain DOM calls: Playwright locators stall while the fake page clock is installed.
  const chooseAction = (text: string) => waitFor(`menu action ${text}`, () => page.evaluate((text: string) => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('.click-dropdown button')].find((b) => b.textContent?.includes(text));
    button?.click();
    return !!button;
  }, text), 5_000);
  const debug = async (label: string) => {
    await page.screenshot({ path: path.join(OUT, `debug-${label}.png`) });
    console.error(label, JSON.stringify({
      me: await me(),
      dropdown: await page.evaluate(() => document.querySelector('.click-dropdown')?.textContent ?? null),
      avatars: await page.evaluate(() => (window as any).__berigameAvatars().map((a: any) => ({ id: a.identity.slice(-4), at: a.position.map((v: number) => Math.round(v * 10) / 10) }))),
    }));
  };
  const step = async <T,>(label: string, fn: () => Promise<T>) => { try { return await fn(); } catch (e) { await debug(label); throw e; } };
  const quickLabel = (slot: number) => page.evaluate((slot: number) => document.querySelector(`.combat-hud .hotbar-slot[data-slot="${slot}"]`)?.getAttribute('aria-label') ?? '', slot);
  await page.mouse.move(640, 450); await page.mouse.wheel(0, -420); await sleep(600);

  // Everyone spawns on the same tile; move the dummy off it first so its click box can't cover the stick.
  // The follow camera sits behind the spawn tile: +x runs down-right on screen and -z up-right. A dummy
  // at (+1, -1) stands beside the player (the chop is seen side-on) and the stick drops at (-1, +1) on
  // the other side, within pickup range and never behind another avatar's click box.
  const HOME = { x: 25, z: 25 }, DUMMY = { x: 26, z: 24 }, DROP = { x: 24, z: 26 };
  await dummy.conn.reducers.setTarget(DUMMY);

  // 1. The helper finds a stick and drops it next to the browser player's spawn tile.
  console.log('helper is harvesting for a stick…');
  await findStick(helper);
  await helper.conn.reducers.setTarget(DROP);
  await waitFor('helper beside spawn', () => row(helper)?.x === DROP.x && row(helper)?.z === DROP.z, 30_000);
  await helper.conn.reducers.dropItem({ slot: sticks(helper)[0].slot, quantity: 1 });
  const ground = await waitFor('stick on the ground', () => [...helper.conn.db.groundItem.iter()].find((g: any) => g.itemId === STICK_ITEM_ID && g.x === DROP.x && g.z === DROP.z));
  await helper.conn.reducers.setTarget({ x: 22, z: 21 });

  // 2. The browser player picks it up through the UI and wields it with key 1.
  await waitFor('helper walked off', () => chebyshev(row(helper), ground) > 2, 30_000);
  await sleep(1000);
  await clickTile(ground.x, ground.z, 0.42); // the item sprite floats 0.42 above the tile
  try {
    await chooseAction('Pick up');
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, 'debug-pickup.png') });
    console.error(JSON.stringify({
      helper: { hex: helper.hex.slice(-4), row: { x: row(helper).x, z: row(helper).z } }, ground: { x: ground.x, z: ground.z },
      click: await project(ground.x, ground.z, 0.42),
      avatars: await page.evaluate(() => (window as any).__berigameAvatars().map((a: any) => ({ id: a.identity.slice(-4), position: a.position }))),
      dropdown: await page.evaluate(() => document.querySelector('.click-dropdown')?.textContent),
      rowsOnPage: await page.evaluate(() => (window as any).__berigame.players.map((p: any) => ({ id: p.hex.slice(-4), x: p.x, z: p.z, online: p.online }))),
    }, null, 1));
    throw e;
  }
  await waitFor('stick picked up', async () => (await quickLabel(0)).includes('Stick'));
  await page.keyboard.press('1');
  await waitFor('stick wielded', async () => (await me())?.weapon === STICK_ITEM_ID);
  const now = await me();
  if (now.x !== HOME.x || now.z !== HOME.z) await clickTile(HOME.x, HOME.z);
  await step('home', () => waitFor('back home', async () => { const m = await me(); return m.x === HOME.x && m.z === HOME.z; }, 20_000));
  await sleep(2500); // let the follow camera settle
  await page.screenshot({ path: path.join(OUT, '01-wielded-hud.png') });

  // 3. The dummy already stands beside the player's tile, so the player swings without moving the camera.
  await waitFor('dummy in place', () => row(dummy)?.x === DUMMY.x && row(dummy)?.z === DUMMY.z, 30_000);
  const mine = await me();
  await clickTile(DUMMY.x, DUMMY.z, 1.0);
  try { await chooseAction('Attack'); } catch (e) {
    await page.screenshot({ path: path.join(OUT, 'debug-attack.png') });
    console.error(JSON.stringify({ me: await me(), dummy: row(dummy) && { x: row(dummy).x, z: row(dummy).z }, click: await project(DUMMY.x, DUMMY.z, 1.0) }));
    throw e;
  }
  const before = dummy.events.length;
  await waitFor('player adjacent', async () => { const m = await me(); return Math.max(Math.abs(m.x - DUMMY.x), Math.abs(m.z - DUMMY.z)) <= 1; });
  await sleep(1200);
  // Pause the page clock right after one swing; the next swing's event then arrives while paused and
  // is stamped with the paused time, so stepping the clock renders every frame of that swing.
  const swingsBy = () => dummy.events.slice(before).filter((e: any) => e.kind === EventKind.Hit && e.attacker.toHexString() === mine.hex);
  const seen = swingsBy().length;
  await waitFor('a swing lands', () => swingsBy().length > seen, 10_000);
  await page.clock.pauseAt(Date.now() + 400);
  const count = swingsBy().length;
  const hit = await waitFor('next stick hit', () => swingsBy()[count], 10_000);
  await sleep(400); // the browser's socket delivers the same event
  // The server keeps ticking while the page clock is paused and capturing is slow, so stop attacking
  // (Stop / Esc) to keep later swings, and the dummy's death, out of the frames.
  await page.keyboard.press('Escape');
  const frames: any[] = [];
  const at = await me();
  const a = await project(at.x, at.z, 0), b = await project(DUMMY.x, DUMMY.z, 0), top = await project(DUMMY.x, DUMMY.z, 2.6);
  const cx = (a.x + b.x) / 2, w = Math.max(360, Math.abs(a.x - b.x) + 300), y0 = Math.max(0, top.y - 60), h = Math.max(320, Math.max(a.y, b.y) - y0 + 50);
  const clip = { x: Math.max(0, cx - w / 2), y: y0, width: w, height: h };
  for (let t = 0; t <= STICK_SWING_MS + 120; t += STEP_MS) {
    await page.clock.runFor(STEP_MS);
    const avatar = await page.evaluate((hex: string) => (window as any).__berigameAvatars().find((p: any) => p.identity === hex), mine.hex);
    const firstCue = frames.find((f) => f.cue)?.cue;
    if (firstCue && avatar?.cue && avatar.cue !== firstCue) break; // a later swing started: stop
    const file = `swing-${String(frames.length).padStart(2, '0')}.png`;
    await page.screenshot({ path: path.join(OUT, file), clip });
    frames.push({ file, stepMs: (frames.length + 1) * STEP_MS, clip: avatar?.clip, cue: avatar?.cue, weapon: avatar?.weapon });
  }
  await page.clock.resume();
  await page.screenshot({ path: path.join(OUT, '02-after-swing.png') });
  const report = { url: URL, database: DB, event: { kind: hit.kind, damage: hit.damage, itemId: hit.itemId }, stepMs: STEP_MS, frames, errors };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ damage: hit.damage, itemId: hit.itemId, clips: [...new Set(frames.map((f) => f.clip))], errors: errors.length }));
  await page.keyboard.press('Escape');
  await browser.close();
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => { for (const c of connections) c.disconnect(); setTimeout(() => process.exit(), 300); });
