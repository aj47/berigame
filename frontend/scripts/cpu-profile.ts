/** Optional diagnostic (profiling overhead means this is not an FPS benchmark).
 * PLAYWRIGHT_MODULE=/path/to/playwright SPACETIME_DB=berigame-graphics-review npx tsx scripts/cpu-profile.ts
 * At most32 online players; closes every connection this script creates.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { DbConnection, tables } from '../src/module_bindings';
const requireModule = createRequire(path.join(__dirname, 'cpu-profile.ts'));
const { chromium } = requireModule(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const output = path.resolve(__dirname, '../../docs/art/game-review/cpu-investigation');
fs.mkdirSync(output, { recursive: true });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const fixtures: DbConnection[] = [];
const errors: string[] = [];
const report: any = { createdAt: new Date().toISOString(), qualification: 'Diagnostic Chrome CPU profile with4x CPU throttle on the host GPU. Includes profiler overhead; not physical phone evidence or an FPS benchmark.', errors };
function digest() {
  const root = path.resolve(__dirname, '../src');
  const walk = (dir: string): string[] => fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
  const h=createHash('sha256');for(const file of walk(root).sort())h.update(path.relative(root,file)).update(fs.readFileSync(file));return h.digest('hex');
}
async function fixture() {
  return new Promise<DbConnection>((resolve, reject) => {
    const timer=setTimeout(()=>reject(new Error('fixture timeout')),10000);
    const c=DbConnection.builder().withUri(process.env.SPACETIME_URI??'ws://127.0.0.1:3000').withDatabaseName(process.env.SPACETIME_DB??'berigame-graphics-review')
      .onConnectError((_ctx,e)=>{clearTimeout(timer);reject(e);})
      .onConnect(c=>c.subscriptionBuilder().onApplied(()=>{clearTimeout(timer);resolve(c);}).onError((_ctx,e)=>{clearTimeout(timer);reject(e);}).subscribe([tables.player,tables.appearance])).build();
    fixtures.push(c);
  });
}
function summarize(profile: any) {
  const nodes = new Map<number,any>(profile.nodes.map((node:any)=>[node.id,node]));
  const parents = new Map<number,number>();
  for(const node of profile.nodes)for(const child of node.children??[])parents.set(child,node.id);
  const self = new Map<number,number>(), inclusive = new Map<number,number>();
  for(let i=0;i<profile.samples.length;i++) {
    const id=profile.samples[i],time=profile.timeDeltas[i]??0;
    self.set(id,(self.get(id)??0)+time);
    let cursor:number|undefined=id;const seen=new Set<number>();
    while(cursor!==undefined&&!seen.has(cursor)) { seen.add(cursor);inclusive.set(cursor,(inclusive.get(cursor)??0)+time);cursor=parents.get(cursor); }
  }
  const total=profile.timeDeltas.reduce((a:number,b:number)=>a+b,0);
  const rows=[...nodes.values()].map((node:any)=>({id:node.id,function:node.callFrame.functionName||'(anonymous)',url:node.callFrame.url,line:node.callFrame.lineNumber+1,selfMs:+((self.get(node.id)??0)/1000).toFixed(2),inclusiveMs:+((inclusive.get(node.id)??0)/1000).toFixed(2),selfPercent:+(100*(self.get(node.id)??0)/total).toFixed(2)}));
  const grouped = new Map<string,any>();
  for (const row of rows) { const key = [row.function,row.url,row.line].join(':'); const value=grouped.get(key)??{function:row.function,url:row.url,line:row.line,selfMs:0,selfPercent:0};value.selfMs+=row.selfMs;value.selfPercent+=row.selfPercent;grouped.set(key,value); }
  return {durationMs:total/1000,samples:profile.samples.length,aggregateSelf:[...grouped.values()].sort((a,b)=>b.selfMs-a.selfMs).slice(0,35),topSelf:rows.sort((a,b)=>b.selfMs-a.selfMs).slice(0,35),topInclusive:rows.sort((a,b)=>b.inclusiveMs-a.inclusiveMs).slice(0,40)};
}
async function main() {
  let browser:any,page:any,timer:ReturnType<typeof setInterval>|undefined;
  let round=0;let movement:Promise<unknown>=Promise.resolve();
  try {
    report.sourceBefore=digest();
    browser=await chromium.launch({channel:'chrome'});
    const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
    page=await context.newPage();
    await page.addInitScript({content:'window.__name=function(value){return value}'});
    page.on('pageerror',(e:Error)=>errors.push(e.message));
    await page.goto(process.env.GAME_URL??'http://127.0.0.1:5173');
    await page.waitForFunction(()=>!!(window as any).__berigame?.me&&!(document.querySelector('.loading-screen')),null,{timeout:25000});
    report.baselineOnline=await page.evaluate(()=>(window as any).__berigame.players.filter((p:any)=>p.online).length);
    const count=Math.max(0,32-report.baselineOnline);
    for(let i=0;i<count;i++) {
      const c=await fixture();await c.reducers.setAppearance({hairStyle:i%3,skinTone:i%6,hairColor:i%4,robeColor:i%5,wrapColor:i%3});
    }
    const move=async()=>{const offset=round++%2;await Promise.all(fixtures.map((c,i)=>c.reducers.setTarget({x:22+i%6+offset,z:22+Math.floor(i/6)}).catch(e=>errors.push(String(e)))));};
    await move();await sleep(4500);
    const cdp=await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    timer=setInterval(()=>{movement=move()},1400);
    await sleep(2000);
    report.onlineDuringProfile=await page.evaluate(()=>(window as any).__berigame.players.filter((p:any)=>p.online).length);
    report.totalPlayerRows=await page.evaluate(()=>(window as any).__berigame.players.length);
    report.offlinePlayerRows=report.totalPlayerRows-report.onlineDuringProfile;
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval',{interval:1000});
    await cdp.send('Profiler.start');
    await sleep(12000);
    const {profile}=await cdp.send('Profiler.stop');
    await cdp.send('Profiler.disable');
    clearInterval(timer);timer=undefined;await movement;
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
    fs.writeFileSync(path.join(output,'moving-32-4x.cpuprofile'),JSON.stringify(profile));
    report.profile=summarize(profile);
    report.render=await page.evaluate(()=>({...(window as any).__berigameRender,...(window as any).__berigameResources?.()}));
    for(const c of fixtures)c.disconnect();
    const ids=fixtures.map(c=>c.identity?.toHexString());
    await page.waitForFunction((ids:string[])=>!(window as any).__berigame.players.some((p:any)=>p.online&&ids.includes(p.hex)),ids,{timeout:15000});
    report.fixturesVerifiedOffline=true;
  } catch(e) {errors.push(String(e));process.exitCode=1;}
  finally {
    if(timer)clearInterval(timer);
    for(const c of fixtures)c.disconnect();
    await browser?.close();
    report.fixturesCreated=fixtures.length;report.browserClosed=true;report.sourceAfter=digest();report.sourceUnchanged=report.sourceBefore===report.sourceAfter;
    fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({output,errors,online:report.onlineDuringProfile,fixturesOffline:report.fixturesVerifiedOffline,topSelf:report.profile?.topSelf.slice(0,15)}));
  }
}
void main();
