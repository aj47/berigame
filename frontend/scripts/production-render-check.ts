/** Optional production-build RAF qualification. Start an isolated Vite preview first.
 * GAME_URL=http://127.0.0.1:4175 PLAYWRIGHT_MODULE=/path/to/playwright \
 * SPACETIME_DB=berigame-graphics-review npx tsx scripts/production-render-check.ts
 * Uses <=32 online players, closes all fixtures, and reads no browser credentials.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { DbConnection, tables } from '../src/module_bindings';
const requireModule=createRequire(path.join(__dirname,'production-render-check.ts'));
const {chromium}=requireModule(process.env.PLAYWRIGHT_MODULE??'playwright');
const OUT=process.env.RENDER_REPORT_PATH?path.resolve(process.env.RENDER_REPORT_PATH):path.resolve(__dirname,'../../docs/art/game-review/production-render-validation.json');
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const fixtures:DbConnection[]=[];
const errors:string[]=[];
const report:any={createdAt:new Date().toISOString(),url:process.env.GAME_URL??'http://127.0.0.1:4175',host:{cpu:os.cpus()[0]?.model,platform:os.platform(),arch:os.arch()},qualification:'Local production bundle in headless Chrome.390px touch viewport/DPR3 on host GPU;4x Chrome CPU throttle is only a CPU-throughput proxy, not physical phone hardware. No profiler attached. RAF intervals measure delivery cadence, not GPU execution time.',samples:[],errors};
function digest(dir:string){const hash=createHash('sha256');const walk=(dir:string):string[]=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);for(const file of walk(dir).sort())hash.update(path.relative(dir,file)).update(fs.readFileSync(file));return hash.digest('hex');}
async function fixture(){return new Promise<DbConnection>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('fixture timeout')),10000);const c=DbConnection.builder().withUri(process.env.SPACETIME_URI??'ws://127.0.0.1:3000').withDatabaseName(process.env.SPACETIME_DB??'berigame-graphics-review').onConnectError((_ctx,e)=>{clearTimeout(timeout);reject(e)}).onConnect(c=>c.subscriptionBuilder().onApplied(()=>{clearTimeout(timeout);resolve(c)}).onError((_ctx,e)=>{clearTimeout(timeout);reject(e)}).subscribe([tables.player,tables.appearance])).build();fixtures.push(c)})}
async function until(label:string,predicate:()=>boolean,timeout=15000){const start=Date.now();while(Date.now()-start<timeout){if(predicate())return;await sleep(100)}throw new Error(label)}
async function main(){
 let browser:any,page:any,timer:ReturnType<typeof setInterval>|undefined;let round=0;let moving:Promise<void>=Promise.resolve();
 try{
  report.distSha256=digest(path.resolve(__dirname,'../dist'));report.sourceSha256=digest(path.resolve(__dirname,'../src'));
  const observer=await fixture();
  const online=()=>[...observer.db.player.iter()].filter(p=>p.online).length;
  browser=await chromium.launch({channel:'chrome'});report.browserVersion=browser.version();
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
  page=await context.newPage();await page.addInitScript({content:'window.__name=function(value){return value}'});
  page.on('pageerror',(e:Error)=>errors.push(e.message));page.on('console',(m:any)=>{if(m.type()==='error')errors.push(m.text())});
  const beforeBrowser=online();await page.goto(report.url);
  await page.locator('canvas').waitFor();await page.locator('.loading-screen').waitFor({state:'hidden',timeout:30000});
  await until('browser joins production world',()=>online()>beforeBrowser);
  report.baselineOnlinePlayers=online();
  const toCreate=Math.max(0,32-online());
  for(let i=0;i<toCreate;i++)await fixture();
  for(let i=0;i<fixtures.length;i++)await fixtures[i].reducers.setAppearance({hairStyle:i%3,skinTone:i%6,hairColor:i%4,robeColor:i%5,wrapColor:i%3});
  await until('all crowd players online',()=>online()===32);
  report.totalPlayerRows=[...observer.db.player.iter()].length;report.onlinePlayers=online();
  const move=async()=>{const offset=round++%2;await Promise.all(fixtures.map((c,i)=>c.reducers.setTarget({x:22+i%6+offset,z:22+Math.floor(i/6)}).catch(e=>errors.push(String(e)))))};
  await move();await sleep(5000);
  const cdp=await context.newCDPSession(page);
  const sample=async(label:string,throttle:number)=>{
   const before=fixtures.map(c=>{const p=observer.db.player.identity.find(c.identity!);return{id:c.identity!.__identity__.toString(),x:p?.x,z:p?.z}});
   const value=await page.evaluate(async()=>{
    const intervals:number[]=[];let previous:number|undefined;const start=performance.now();
    await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('RAF stalled')),15000);const frame=(now:number)=>{if(previous!==undefined)intervals.push(now-previous);previous=now;if(now-start<8000)requestAnimationFrame(frame);else{clearTimeout(timeout);resolve()}};requestAnimationFrame(frame)});
    const sorted=[...intervals].sort((a,b)=>a-b),avg=intervals.reduce((a,b)=>a+b,0)/intervals.length,p=(fraction:number)=>+(sorted[Math.min(sorted.length-1,Math.floor(sorted.length*fraction))]??0).toFixed(2);
    const canvas=document.querySelector('canvas')!,gl=canvas.getContext('webgl2')??canvas.getContext('webgl');const ext=gl?.getExtension('WEBGL_debug_renderer_info');
    return{viewport:{width:innerWidth,height:innerHeight,devicePixelRatio},frames:{count:intervals.length,averageMs:+avg.toFixed(2),estimatedFps:+(1000/avg).toFixed(1),p50Ms:p(.5),p95Ms:p(.95),p99Ms:p(.99),maxMs:p(1),over33ms:intervals.filter(v=>v>33.5).length},gpu:ext?gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unavailable',debugGlobalsAbsent:!(window as any).__berigame&&!(window as any).__berigameRender};
   });
   const after=fixtures.map(c=>{const p=observer.db.player.identity.find(c.identity!);return{id:c.identity!.__identity__.toString(),x:p?.x,z:p?.z}});
   const entry={label,cpuThrottleRate:throttle,onlinePlayers:online(),...value,fixturePositionsBefore:before.map(({x,z})=>({x,z})),fixturePositionsAfter:after.map(({x,z})=>({x,z}))};
   report.samples.push(entry);console.log(JSON.stringify({label,...value,onlinePlayers:online()}));
  };
  timer=setInterval(()=>{moving=move()},1400);
  await sample('production390px crowd moving',1);
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await sleep(1200);
  await sample('production390px crowd moving,4x CPU throttle',4);
  clearInterval(timer);timer=undefined;await moving;
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
  for(const c of fixtures.slice(1))c.disconnect();
  await until('crowd fixtures offline',()=>fixtures.slice(1).every(c=>!observer.db.player.identity.find(c.identity!)?.online));
  report.fixtureCleanupVerified=fixtures.length-1;observer.disconnect();report.observerDisconnected=true;
 }catch(e){errors.push(String(e));process.exitCode=1}
 finally{if(timer)clearInterval(timer);for(const c of fixtures)c.disconnect();await browser?.close();report.fixturesCreated=fixtures.length;report.maximumHarnessConnections=fixtures.length+1;report.browserClosed=true;report.finalDistSha256=digest(path.resolve(__dirname,'../dist'));report.finalSourceSha256=digest(path.resolve(__dirname,'../src'));report.sourceUnchanged=report.sourceSha256===report.finalSourceSha256;report.bundleUnchanged=report.distSha256===report.finalDistSha256;fs.writeFileSync(OUT,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output:OUT,errors,cleanup:report.fixtureCleanupVerified,browserClosed:true}));}
}
void main();
