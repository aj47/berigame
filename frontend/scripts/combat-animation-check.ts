/** Live punch/stick animation acceptance. Two fresh SDK actors + one isolated Chrome spectator.
 * SPACETIME_DB=berigame-graphics-review PLAYWRIGHT_MODULE=/path/to/playwright npx tsx scripts/combat-animation-check.ts
 * Never deletes data; disconnects every fixture and browser. No credentials in report.
 * The stick is obtained the way players get one: harvest trees until the
 * STICK_DROP_CHANCE roll finds it (allow several minutes), then hand it over
 * by dropping it for the other actor.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { DbConnection, tables } from '../src/module_bindings';
import { chebyshev, EventKind, getItemDef, HOTBAR_SIZE, inGrace, PUNCH_DAMAGE, STICK_ITEM_ID, TICK_MS } from '../../shared/sim';
import { STICK_SWING_CLIP, STICK_SWING_IMPACT_MS } from '../src/animation/stickSwing';
const { chromium } = createRequire(path.join(__dirname, 'combat-animation-check.ts'))(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const URL = process.env.GAME_URL ?? 'http://127.0.0.1:5173/';
const DB = process.env.SPACETIME_DB ?? 'berigame-graphics-review';
const URI = process.env.SPACETIME_URI ?? 'ws://127.0.0.1:3000';
const OUT = path.resolve(process.env.COMBAT_REPORT_DIR ?? '../docs/art/game-review/combat-stick');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const hash = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const freeze = () => Object.fromEntries([
  'frontend/public/models/starter-adventurer.glb', 'frontend/src/animation/combatPresentation.ts', 'frontend/src/animation/stickSwing.ts',
  'frontend/src/Components/3D/AdventurerModel.tsx', 'frontend/src/hooks/useTileMotion.ts',
  'spacetimedb/src/reducers/tick.ts', 'shared/sim/constants.ts', 'shared/sim/items.ts',
].map(p => [p, hash(path.resolve('..', p))]));
const report: any = { createdAt: new Date().toISOString(), url: URL, database: DB, qualification: 'Real local authoritative events and rendered Chrome RAF observations. Clip routing and the visible held weapon are measured; screenshots/video still require visual contact review. This is desktop Chrome, not physical-phone evidence.', sourceStart: freeze(), cases: [], stick: {}, errors: [], failures: [], cleanup: {} };
const connections: DbConnection[] = [];
async function waitFor(label: string, fn: () => boolean | Promise<boolean>, timeout = 15000) {
  const start = Date.now();
  while (Date.now()-start < timeout) { if (await fn()) return; await sleep(25); }
  throw new Error(`Timeout: ${label}`);
}
async function connect() {
  return new Promise<any>((resolve, reject) => {
    const events: any[] = [];
    const timer = setTimeout(() => reject(new Error('SDK connection timeout')), 10000);
    const c = DbConnection.builder().withUri(URI).withDatabaseName(DB)
      .onConnectError((_c, e) => { clearTimeout(timer); reject(e); })
      .onConnect((conn, identity) => {
        conn.db.combatEvent.onInsert((_ctx, event) => events.push(event));
        conn.subscriptionBuilder().onApplied(() => { clearTimeout(timer); resolve({ conn, identity, hex: identity.toHexString(), events }); })
          .onError((_ctx, e) => { clearTimeout(timer); reject(e); })
          .subscribe([tables.world, tables.player, tables.tree, tables.combatEvent, tables.inventorySlot, tables.groundItem]);
      }).build();
    connections.push(c);
  });
}
const row = (c: any) => c.conn.db.player.identity.find(c.identity);
const tick = (c: any) => c.conn.db.world.id.find(0)?.tick ?? 0;
const sticks = (c: any) => [...c.conn.db.inventorySlot.iter()].filter((r: any) => r.owner.toHexString() === c.hex && r.itemId === STICK_ITEM_ID);
function check(label: string, ok: boolean) { console.log(`${ok?'PASS':'FAIL'} ${label}`); if (!ok) report.failures.push(label); }
const berries = (c: any) => [...c.conn.db.inventorySlot.iter()].filter((r: any) => r.owner.toHexString() === c.hex && r.itemId.startsWith('berry_'));
const berryCount = (c: any) => berries(c).reduce((n: number, r: any) => n + r.quantity, 0);
/** Harvest the nearest ready tree until a stick turns up. Returns the number of completed harvests. */
const findStick = (c: any) => harvestUntil(c, () => sticks(c).length > 0, 'no stick');
/** Harvest the nearest ready tree until `enough()`. Returns the number of completed harvests. */
async function harvestUntil(c: any, enough: () => boolean, failure: string, timeout = 420_000) {
  const start = Date.now(); let harvests = 0;
  const done = () => c.events.filter((e: any) => e.kind === EventKind.HarvestDone && e.attacker.toHexString() === c.hex).length;
  while (!enough()) {
    if (Date.now() - start > timeout) throw new Error(`${failure} after ${harvests} harvests`);
    const me = row(c), T = tick(c);
    const tree = [...c.conn.db.tree.iter()].filter((t: any) => !t.harvester && t.cooldownUntilTick <= T)
      .sort((x: any, y: any) => chebyshev(me, x) - chebyshev(me, y) || x.id - y.id)[0];
    if (!tree) { await sleep(TICK_MS); continue; }
    const before = done();
    try { await c.conn.reducers.startHarvest({ treeId: tree.id }); } catch { await sleep(TICK_MS); continue; }
    try { await waitFor('stick-hunt harvest', () => done() > before, 20000); harvests++; } catch { await c.conn.reducers.cancel({}); }
  }
  return harvests;
}
/** New characters start on 20 HP (M1): eat back up so a retried case cannot kill the defender. */
async function topUp(c: any) {
  while (row(c).hp <= 16 && berries(c).length) {
    const hp = row(c).hp;
    await c.conn.reducers.eatBerry({ slot: berries(c)[0].slot }).catch(() => {});
    await waitFor('ate', () => row(c).hp > hp, 5000).catch(() => {});
  }
}
/** Put the actor's stick into a quick slot (if needed) and wield it. */
async function wieldStick(c: any) {
  let slot = sticks(c)[0].slot;
  if (slot >= HOTBAR_SIZE) {
    await c.conn.reducers.moveItem({ from: slot, to: 0 });
    await waitFor('stick in quick slot', () => sticks(c).some((r: any) => r.slot === 0));
    slot = 0;
  }
  await c.conn.reducers.wieldItem({ slot });
  await waitFor('stick wielded', () => row(c)?.weapon === STICK_ITEM_ID);
}
const STICK_DAMAGE = getItemDef(STICK_ITEM_ID)!.weaponDamage;
const PUNCH_IMPACT_MS = 160; // Strike's baked punch peak (combatPresentation.ts)
// Every swing is a Hit. The attacker's clip follows the event's itemId; the defender always reacts with Hit.
const cases = [
  { label: 'punch-vs-punch', holder: null, weapon: '', attackerClip: 'Strike', damage: PUNCH_DAMAGE, impact: PUNCH_IMPACT_MS },
  { label: 'stick-vs-punch', holder: 'a', weapon: STICK_ITEM_ID, attackerClip: STICK_SWING_CLIP, damage: STICK_DAMAGE, impact: STICK_SWING_IMPACT_MS },
  { label: 'punch-vs-stick', holder: 'b', weapon: '', attackerClip: 'Strike', damage: PUNCH_DAMAGE, impact: PUNCH_IMPACT_MS },
] as const;
let browser: any, context: any;
async function main() {
try {
  const a = await connect(), b = await connect();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  // COMBAT_VIEWPORT=WxH shrinks the page on slow software-GL hosts; COMBAT_VIDEO=0 skips the recording.
  const [vw, vh] = (process.env.COMBAT_VIEWPORT ?? '1280x900').split('x').map(Number);
  context = await browser.newContext({ viewport: { width: vw, height: vh }, ...(process.env.COMBAT_VIDEO === '0' ? {} : { recordVideo: { dir: OUT, size: { width: vw, height: vh } } }) });
  const page = await context.newPage();
  await page.addInitScript({ content: 'window.__name = value => value;' });
  page.on('pageerror', (e: Error) => report.errors.push(e.message));
  page.on('console', (m: any) => { if(m.type()==='error') report.errors.push(m.text()); });
  await page.goto(URL);
  await page.waitForFunction(() => !!(window as any).__berigameAvatars && !(document.querySelector('.loading-screen')), null, { timeout: 25000 });
  await page.mouse.move(vw/2,vh/2); await page.mouse.wheel(0,-350); await sleep(500);
  // M1: new characters are in first-spawn grace (nobody can attack them) until they find or pick up
  // a stick, attack, or 3:00 passes. A finds a stick, hands it to B and gets it back: each pickup
  // ends that actor's grace 10 ticks later. The stick stays in A's bag (unwielded) for the punch case.
  // Meanwhile B gathers berries to eat between cases.
  [report.stick.harvestsForA] = await Promise.all([findStick(a), harvestUntil(b, () => berryCount(b) >= 4, 'too few berries')]);
  const handOver = async (from: any, to: any) => {
    await from.conn.reducers.dropItem({ slot: sticks(from)[0].slot, quantity: 1 });
    let ground: any;
    await waitFor('stick on the ground', () => !!(ground = [...to.conn.db.groundItem.iter()].find((g: any) => g.itemId === STICK_ITEM_ID && g.droppedBy.toHexString() === from.hex)));
    await to.conn.reducers.pickupItem({ id: ground.id });
    await waitFor('stick picked up', () => sticks(to).length > 0, 30000);
  };
  await handOver(a, b);
  await handOver(b, a);
  await waitFor('both actors out of grace', () => [a, b].every(c => !inGrace(row(c), tick(c))), 20000);
  for (const item of cases) {
    const label = item.label;
    if (item.holder === 'a') {
      await a.conn.reducers.cancel({}); await b.conn.reducers.cancel({});
      await wieldStick(a);
    }
    if (item.holder === 'b') {
      // Hand the stick over: dropping it puts it away, and the other actor picks it up and wields it.
      await a.conn.reducers.cancel({}); await b.conn.reducers.cancel({});
      await a.conn.reducers.dropItem({ slot: sticks(a)[0].slot, quantity: 1 });
      await waitFor('dropping unwields the stick', () => row(a)?.weapon === '' && !sticks(a).length);
      let ground: any;
      await waitFor('stick on the ground', () => !!(ground = [...b.conn.db.groundItem.iter()].find((g: any) => g.itemId === STICK_ITEM_ID && g.droppedBy.toHexString() === a.hex)));
      await b.conn.reducers.pickupItem({ id: ground.id });
      await waitFor('b picks up the stick', () => sticks(b).length > 0, 20000);
      await wieldStick(b);
      report.stick.handedToB = true;
    }
    await a.conn.reducers.cancel({}); await b.conn.reducers.cancel({});
    // Just south of the safe ring (Chebyshev radius 2 around spawn), in view of the spawn camera.
    await a.conn.reducers.setTarget({ x: 24, z: 28 });
    await b.conn.reducers.setTarget({ x: 25, z: 28 });
    await waitFor('actors in place', () => row(a)?.x===24 && row(a)?.z===28 && row(b)?.x===25 && row(b)?.z===28, 30000);
    await sleep(850); // Let confirmed travel and its short animation hold finish.
    let before = 0, beforeRows: any[] = [], event: any;
    // Software GL can stall for over a second between frames, longer than the 1.4 s cue: a swing
    // can then come and go between two samples. Retry such a case (the defender has HP to spare).
    for (let attempt = 1; ; attempt++) {
      await topUp(a); await topUp(b);
      before = a.events.length;
      beforeRows = [row(a),row(b)].map(p => ({ x:p.x,z:p.z,hp:p.hp,weapon:p.weapon }));
      await page.evaluate(({ identities, impact }: any) => {
        const w=window as any; w.__combatFrames=[]; w.__combatDone=false; w.__combatContact=false;
        const started=performance.now(); let cueAt: number|null=null;
        const frame=(now: number) => {
          const actors=identities.map((hex: string) => w.__berigameAvatars().find((p: any)=>p.identity===hex));
          if(cueAt===null && actors.some((p: any)=>p?.cue)) cueAt=now;
          w.__combatFrames.push({ at:now-started, cueElapsed:cueAt===null?null:now-cueAt, actors });
          if(cueAt!==null && now-cueAt>=impact-25) w.__combatContact=true;
          if((cueAt!==null && now-cueAt>1100)||now-started>20000) w.__combatDone=true; // software GL can take ~1s a frame
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }, { identities:[a.hex,b.hex], impact:item.impact });
      await a.conn.reducers.attack({ target:b.identity });
      const isSwing = (e:any)=>e.attacker.toHexString()===a.hex && e.defender.toHexString()===b.hex && e.kind===EventKind.Hit;
      await waitFor('authoritative swing',()=>a.events.slice(before).some(isSwing));
      event = a.events.slice(before).find(isSwing);
      await a.conn.reducers.cancel({}); await b.conn.reducers.cancel({});
      const contact = await page.waitForFunction(()=>(window as any).__combatContact,null,{polling:'raf',timeout:30000}).then(()=>true,()=>false);
      if (contact) break;
      const info = await page.evaluate(()=>{ const f=(window as any).__combatFrames; return { frames:f.length, maxGapMs:Math.max(0,...f.slice(1).map((x:any,i:number)=>x.at-f[i].at)) }; });
      if (attempt < 3 && info.maxGapMs > 1000) { console.log(`RETRY ${label}: no cue sampled (${info.frames} frames, max gap ${Math.round(info.maxGapMs)}ms)`); await sleep(3000); continue; }
      throw new Error(`${label}: the spectator never showed a cue (${JSON.stringify(info)})`);
    }
    const screenshotAt = await page.evaluate(()=>(window as any).__combatFrames.at(-1));
    await page.screenshot({path:path.join(OUT,`${label}-contact.png`)});
    await page.waitForFunction(()=>(window as any).__combatDone,null,{polling:'raf',timeout:30000});
    const frames = await page.evaluate(()=>(window as any).__combatFrames);
    const active = frames.filter((f:any)=>f.cueElapsed!==null);
    const sequences = [0,1].map(index => active.reduce((out:any[], f:any) => {
      const p=f.actors[index]; if(p && (out.at(-1)?.clip!==p.clip || out.at(-1)?.cue!==p.cue || out.at(-1)?.weapon!==p.weapon)) out.push({ atMs:f.cueElapsed,clip:p.clip,cue:p.cue,weapon:p.weapon,position:p.position,yaw:p.yaw }); return out;
    },[]));
    check(`${label}: authoritative Hit names the attacker's weapon`, event.kind===EventKind.Hit && event.itemId===item.weapon);
    check(`${label}: damage ${item.damage}`, event.damage===item.damage);
    const attackerAction = sequences[0].find((s:any)=>s.cue?.endsWith(':action'));
    check(`${label}: attacker plays ${item.attackerClip}`, attackerAction?.clip===item.attackerClip);
    const reaction = sequences[1].find((s:any)=>['Hit','HitHeavy','HitBack'].includes(s.clip) && s.cue?.endsWith(':reaction'));
    // The reaction waits for impact. Only assert the delay when frames are fine enough to resolve it:
    // software-GL headless Chrome can render every ~400ms, so swing and reaction share the first sample.
    const gaps = active.slice(1).map((f:any,i:number)=>f.cueElapsed-active[i].cueElapsed).sort((x:number,y:number)=>x-y);
    const frameMs = gaps.length ? gaps[Math.floor(gaps.length/2)] : Infinity;
    const maxGapMs = gaps.length ? gaps[gaps.length-1] : Infinity;
    report.frameMs = Math.max(report.frameMs ?? 0, frameMs);
    // The reaction cue is live from impact until the 1.4 s cue expiry; a coarser sampling can miss it.
    if (reaction || maxGapMs < 1400 - item.impact) check(`${label}: defender reacts with a hit clip`, !!reaction && reaction.atMs >= (attackerAction?.atMs ?? 0));
    else console.log(`SKIP ${label}: defender reaction not sampled (frames up to ${Math.round(maxGapMs)}ms apart)`);
    if (frameMs < item.impact / 2) check(`${label}: defender reaction waits for impact`, !!reaction && reaction.atMs > 0);
    else console.log(`SKIP ${label}: reaction delay not resolvable at ${Math.round(frameMs)}ms per frame`);
    check(`${label}: defender does not swing`, !sequences[1].some((s:any)=>s.clip==='Strike' || s.clip===STICK_SWING_CLIP));
    // The spectator must see the stick in the holder's hand, and only there.
    const seen = [0,1].map(index => active.filter((f:any)=>f.actors[index]).map((f:any)=>f.actors[index].weapon));
    const expected = [item.holder==='a' ? STICK_ITEM_ID : '', item.holder==='b' ? STICK_ITEM_ID : ''];
    check(`${label}: spectator sees attacker weapon ${JSON.stringify(expected[0])}`, seen[0].length>0 && seen[0].every((w:any)=>(w ?? '')===expected[0]));
    check(`${label}: spectator sees defender weapon ${JSON.stringify(expected[1])}`, seen[1].length>0 && seen[1].every((w:any)=>(w ?? '')===expected[1]));
    report.cases.push({label,expected:item,initial:beforeRows,event:{tick:event.tick,kind:event.kind,itemId:event.itemId,damage:event.damage,defenderHp:event.defenderHp},sequences,screenshot:path.join(OUT,`${label}-contact.png`),screenshotRequestedAtMs:screenshotAt.cueElapsed,frames:active.length});
    fs.writeFileSync(path.join(OUT,`${label}-raf.json`),JSON.stringify(frames,null,2));
  }
  check('all three punch/stick cases observed',report.cases.length===3);
  check('zero browser errors',report.errors.length===0);
  report.sourceEnd=freeze(); check('source unchanged during run',JSON.stringify(report.sourceStart)===JSON.stringify(report.sourceEnd));
} catch(error) { report.failures.push(String(error)); console.error(error); }
finally {
  for(const c of connections) { try { await c.reducers.cancel({}); } catch {} c.disconnect(); }
  report.cleanup.sdkConnectionsClosed=connections.length;
  if(context) { await context.close(); report.cleanup.browserContextClosed=true; }
  if(browser) await browser.close();
  report.videos=fs.readdirSync(OUT).filter(p=>p.endsWith('.webm'));
  fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));
}
if(report.failures.length) process.exitCode=1;

}
void main();
