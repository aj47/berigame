/** Live V4 animation acceptance. Two fresh SDK actors + one isolated Chrome spectator.
 * SPACETIME_DB=berigame-graphics-review PLAYWRIGHT_MODULE=/path/to/playwright npx tsx scripts/combat-animation-check.ts
 * Never deletes data; disconnects every fixture and browser. No credentials in report.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { DbConnection, tables } from '../src/module_bindings';
const { chromium } = createRequire(path.join(__dirname, 'combat-animation-check.ts'))(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const URL = process.env.GAME_URL ?? 'http://127.0.0.1:5173/';
const DB = process.env.SPACETIME_DB ?? 'berigame-graphics-review';
const URI = process.env.SPACETIME_URI ?? 'ws://127.0.0.1:3000';
const OUT = path.resolve(process.env.COMBAT_REPORT_DIR ?? '../docs/art/game-review/combat-v4');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const hash = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const freeze = () => Object.fromEntries([
  'frontend/public/models/starter-adventurer.glb', 'frontend/src/animation/combatPresentation.ts',
  'frontend/src/Components/3D/AdventurerModel.tsx', 'frontend/src/hooks/useTileMotion.ts',
  'spacetimedb/src/reducers/tick.ts', 'shared/sim/constants.ts',
].map(p => [p, hash(path.resolve('..', p))]));
const report: any = { createdAt: new Date().toISOString(), url: URL, database: DB, qualification: 'Real local authoritative events and rendered Chrome RAF observations. Clip routing is measured; screenshots/video still require visual contact review. This is desktop Chrome, not physical-phone evidence.', sourceStart: freeze(), cases: [], errors: [], failures: [], cleanup: {} };
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
          .subscribe([tables.world, tables.player, tables.tree, tables.combatEvent]);
      }).build();
    connections.push(c);
  });
}
const row = (c: any) => c.conn.db.player.identity.find(c.identity);
function check(label: string, ok: boolean) { console.log(`${ok?'PASS':'FAIL'} ${label}`); if (!ok) report.failures.push(label); }
const stances = ['Strike', 'Grab', 'Guard'];
// Independent acceptance matrix: initial actor pair, optional loser reaction, authoritative kind.
const matrix = [
  { a: 1, b: 2, kind: 0, clips: ['Grab','Block'], reaction: [null,'Grabbed'], impact: 224, diagonal: true },
  { a: 0, b: 0, kind: 1, clips: ['Strike','Strike'], reaction: [null,null], impact: 160 },
  { a: 0, b: 1, kind: 0, clips: ['Strike','Grab'], reaction: [null,'Hit'], impact: 160 },
  { a: 0, b: 2, kind: 2, clips: ['Strike','BlockCounter'], reaction: ['Stagger',null], impact: 288 },
  { a: 1, b: 0, kind: 2, clips: ['Grab','Strike'], reaction: ['Hit',null], impact: 160 },
  { a: 1, b: 1, kind: 1, clips: ['GrabReady','GrabReady'], reaction: [null,null], impact: 160 },
  { a: 2, b: 0, kind: 0, clips: ['BlockCounter','Strike'], reaction: [null,'Stagger'], impact: 288 },
  { a: 2, b: 1, kind: 2, clips: ['Block','Grab'], reaction: ['Grabbed',null], impact: 224 },
  { a: 2, b: 2, kind: 1, clips: ['Block','Block'], reaction: [null,null], impact: 160 },
];
let browser: any, context: any;
async function main() {
try {
  const a = await connect(), b = await connect();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: { dir: OUT, size: { width: 1280, height: 900 } } });
  const page = await context.newPage();
  await page.addInitScript({ content: 'window.__name = value => value;' });
  page.on('pageerror', (e: Error) => report.errors.push(e.message));
  page.on('console', (m: any) => { if(m.type()==='error') report.errors.push(m.text()); });
  await page.goto(URL);
  await page.waitForFunction(() => !!(window as any).__berigameAvatars && !(document.querySelector('.loading-screen')), null, { timeout: 25000 });
  await page.mouse.move(650,450); await page.mouse.wheel(0,-350); await sleep(500);
  for (const item of matrix) {
    const label = `${stances[item.a]}-vs-${stances[item.b]}${item.diagonal?'-diagonal':''}`;
    await a.conn.reducers.cancel(); await b.conn.reducers.cancel();
    await a.conn.reducers.setTarget({ x: 24, z: 27 });
    await b.conn.reducers.setTarget({ x: 25, z: item.diagonal?28:27 });
    await waitFor('actors in place', () => row(a)?.x===24 && row(a)?.z===27 && row(b)?.x===25 && row(b)?.z===(item.diagonal?28:27));
    await a.conn.reducers.setStance({ stance: item.a }); await b.conn.reducers.setStance({ stance: item.b });
    await sleep(850); // Let confirmed travel and its short animation hold finish.
    const before = a.events.length;
    const beforeRows = [row(a),row(b)].map(p => ({ x:p.x,z:p.z,hp:p.hp,stance:p.stance }));
    await page.evaluate(({ identities, impact }: any) => {
      const w=window as any; w.__combatFrames=[]; w.__combatDone=false; w.__combatContact=false;
      const started=performance.now(); let cueAt: number|null=null;
      const frame=(now: number) => {
        const actors=identities.map((hex: string) => w.__berigameAvatars().find((p: any)=>p.identity===hex));
        if(cueAt===null && actors.every((p: any)=>p?.cue)) cueAt=now;
        w.__combatFrames.push({ at:now-started, cueElapsed:cueAt===null?null:now-cueAt, actors });
        if(cueAt!==null && now-cueAt>=impact-25) w.__combatContact=true;
        if((cueAt!==null && now-cueAt>950)||now-started>6000) w.__combatDone=true;
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }, { identities:[a.hex,b.hex], impact:item.impact });
    await a.conn.reducers.attack({ target:b.identity });
    await waitFor('authoritative exchange',()=>a.events.slice(before).some((e:any)=>e.attacker.toHexString()===a.hex && e.defender.toHexString()===b.hex && e.kind<=2));
    const event = a.events.slice(before).find((e:any)=>e.attacker.toHexString()===a.hex && e.defender.toHexString()===b.hex && e.kind<=2);
    await a.conn.reducers.cancel(); await b.conn.reducers.cancel();
    await page.waitForFunction(()=>(window as any).__combatContact,null,{polling:'raf',timeout:6000});
    const screenshotAt = await page.evaluate(()=>(window as any).__combatFrames.at(-1));
    await page.screenshot({path:path.join(OUT,`${label}-contact.png`)});
    await page.waitForFunction(()=>(window as any).__combatDone,null,{polling:'raf',timeout:6000});
    const frames = await page.evaluate(()=>(window as any).__combatFrames);
    const active = frames.filter((f:any)=>f.cueElapsed!==null);
    const sequences = [0,1].map(index => active.reduce((out:any[], f:any) => {
      const p=f.actors[index]; if(p && (out.at(-1)?.clip!==p.clip || out.at(-1)?.cue!==p.cue)) out.push({ atMs:f.cueElapsed,clip:p.clip,cue:p.cue,position:p.position,yaw:p.yaw }); return out;
    },[]));
    check(`${label}: authoritative kind + stance snapshots`,event.kind===item.kind && event.attackerStance===item.a && event.defenderStance===item.b);
    for(let index=0;index<2;index++) {
      const actions=sequences[index].filter((s:any)=>s.cue?.endsWith(':action'));
      check(`${label}: ${index?'defender':'attacker'} starts ${item.clips[index]}`,actions[0]?.clip===item.clips[index]);
      const reaction=item.reaction[index];
      if(reaction) check(`${label}: ${index?'defender':'attacker'} then ${reaction}`,sequences[index].some((s:any)=>s.clip===reaction && s.cue?.endsWith(':reaction') && s.atMs>0));
    }
    report.cases.push({label,expected:item,initial:beforeRows,event:{tick:event.tick,kind:event.kind,attackerStance:event.attackerStance,defenderStance:event.defenderStance,damage:event.damage},sequences,screenshot:path.join(OUT,`${label}-contact.png`),screenshotRequestedAtMs:screenshotAt.cueElapsed,frames:active.length});
    fs.writeFileSync(path.join(OUT,`${label}-raf.json`),JSON.stringify(frames,null,2));
  }
  check('all nine distinct pairs observed',report.cases.length===9);
  check('zero browser errors',report.errors.length===0);
  report.sourceEnd=freeze(); check('source unchanged during run',JSON.stringify(report.sourceStart)===JSON.stringify(report.sourceEnd));
} catch(error) { report.failures.push(String(error)); console.error(error); }
finally {
  for(const c of connections) { try { await c.reducers.cancel(); } catch {} c.disconnect(); }
  report.cleanup.sdkConnectionsClosed=connections.length;
  if(context) { await context.close(); report.cleanup.browserContextClosed=true; }
  if(browser) await browser.close();
  report.videos=fs.readdirSync(OUT).filter(p=>p.endsWith('.webm'));
  fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));
}
if(report.failures.length) process.exitCode=1;

}
void main();
