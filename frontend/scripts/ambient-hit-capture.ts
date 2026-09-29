/**
 * Review capture for hit reactions (knockback + hitstop) and ambient wildlife.
 * A browser player and an SDK actor meet in the Grove. Measures AmbientLife's
 * per-frame CPU cost, then (page clock paused and stepped) renders a club blow
 * landing on the actor, and the actor walking into a flock of birds.
 *
 *   PLAYWRIGHT_MODULE=/opt/node22/lib/node_modules/playwright GAME_URL=http://127.0.0.1:4812/ \
 *   SPACETIME_URI=ws://127.0.0.1:4637 npx tsx scripts/ambient-hit-capture.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DbConnection, tables } from '../src/module_bindings';

const { chromium } = createRequire(path.join(__dirname, 'ambient-hit-capture.ts'))(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const URL = process.env.GAME_URL ?? 'http://127.0.0.1:5173/';
const URI = process.env.SPACETIME_URI ?? 'ws://127.0.0.1:3000';
const OUT = path.resolve(process.env.CAPTURE_DIR ?? '../docs/art/game-review/hit-reactions-ambient');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(label: string, fn: () => T | Promise<T>, timeout = 30_000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = await fn(); if (v) return v; await sleep(100); }
  throw new Error(`timeout: ${label}`);
}
function connect(): Promise<any> {
  return new Promise((resolve, reject) => {
    DbConnection.builder().withUri(URI).withDatabaseName('berigame')
      .onConnectError((_c, e) => reject(e))
      .onConnect((conn, identity) => {
        conn.subscriptionBuilder().onApplied(() => resolve({ conn, identity, hex: identity.toHexString() }))
          .subscribe([tables.player]);
      }).build();
  });
}

async function main() {
  const actor = await connect();
  const row = () => actor.conn.db.player.identity.find(actor.identity);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 960, height: 640 }, recordVideo: process.env.VIDEO ? { dir: OUT, size: { width: 960, height: 640 } } : undefined });
  const page = await context.newPage();
  page.setDefaultTimeout(180_000);
  await page.addInitScript({ content: 'window.__name = value => value;' });
  await page.goto(URL);
  await page.waitForFunction(() => !!(window as any).__berigame?.me && !document.querySelector('.loading-screen'), null, { timeout: 120_000 });
  const me = () => page.evaluate(() => (window as any).__berigame.me);
  const project = (x: number, z: number, y = 0) => page.evaluate(([x, z, y]: number[]) => (window as any).__berigameProject(x, z, y), [x, z, y]);
  const walk = async (x: number, z: number) => { const p = await project(x, z); await page.mouse.click(p.x, p.y); await waitFor('arrive', async () => { const m = await me(); return m.x === x && m.z === z; }); };

  // ---- perf: AmbientLife's own useFrame cost, real clock
  await page.mouse.move(480, 320); await page.mouse.wheel(0, -500);
  await sleep(3000);
  const perf = await page.evaluate(async () => {
    const s = (window as any).__berigameAmbient; s.frames = 0; s.ms = 0;
    const f0 = performance.now(); let n = 0;
    await new Promise<void>((done) => { const loop = () => { n++; if (performance.now() - f0 < 5000) requestAnimationFrame(loop); else done(); }; requestAnimationFrame(loop); });
    return { frames: s.frames, msPerFrame: s.ms / Math.max(1, s.frames), fps: n / 5 };
  });
  console.log('ambient perf', JSON.stringify(perf));
  fs.writeFileSync(path.join(OUT, 'perf.json'), JSON.stringify(perf, null, 1));

  // ---- the actor walks up beside the player (south of the safe ring)
  const HOME = { x: 25, z: 30 };
  await walk(HOME.x, HOME.z);
  await actor.conn.reducers.setTarget({ x: 26, z: 29 });
  await waitFor('actor beside', () => row()?.x === 26 && row()?.z === 29);
  await sleep(2500);
  await page.screenshot({ path: path.join(OUT, '00-overview.png') });

  // ---- knockback + hitstop: a club blow from the player lands on the actor (client-side presentation event)
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 500);
  const self = (await me()).hex;
  await page.evaluate(async ([att, def]: string[]) => {
    const { useCombatFxStore } = await import('/src/spacetime/stores/combatFxStore.ts');
    const id = (hex: string) => ({ toHexString: () => hex });
    useCombatFxStore.getState().pushEvent({ kind: 0, attacker: id(att), defender: id(def), damage: 4, itemId: 'stone_club' } as any);
  }, [self, actor.hex]);
  for (let i = 0; i < 24; i++) {
    await page.clock.runFor(33);
    const pos = await page.evaluate((hex: string) => { const a = (window as any).__berigameAvatars().find((v: any) => v.identity === hex); return a?.position; }, actor.hex);
    const p = await project(26, 29, 1);
    await page.screenshot({ path: path.join(OUT, `hit-${String(i).padStart(2, '0')}.png`), clip: { x: Math.max(0, p.x - 200), y: Math.max(0, p.y - 170), width: 400, height: 300 } });
    console.log('frame', i, JSON.stringify(pos));
  }
  await page.clock.resume();

  // ---- birds: the actor walks into the nearest flock member
  const bird = await page.evaluate(() => {
    const st = (window as any).__berigameAmbient.state; let best = 0, bd = 1e9;
    for (let i = 0; i < 12; i++) { const d = Math.hypot(st.bHome[i * 2], st.bHome[i * 2 + 1] - 5); if (d < bd) { bd = d; best = i; } }
    return { x: Math.round(st.bHome[best * 2]) + 25, z: Math.round(st.bHome[best * 2 + 1]) + 25 };
  });
  console.log('bird near tile', bird);
  await walk(bird.x + 3, bird.z + 3);
  await sleep(3000);
  await page.screenshot({ path: path.join(OUT, 'birds-00-perched.png') });
  await actor.conn.reducers.setTarget({ x: bird.x, z: bird.z });
  await waitFor('actor near bird', () => Math.max(Math.abs(row().x - bird.x), Math.abs(row().z - bird.z)) <= 3, 40_000);
  for (let i = 1; i <= 8; i++) { await sleep(250); await page.screenshot({ path: path.join(OUT, `birds-${String(i).padStart(2, '0')}.png`) }); }

  await page.screenshot({ path: path.join(OUT, 'grove-motes.png') });
  // ---- crabs: look out over the hedge at the east beach, then the actor strolls by
  await walk(40, 25);
  await sleep(3000);
  await page.screenshot({ path: path.join(OUT, 'coast-crabs.png') });
  await context.close();
  await browser.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
