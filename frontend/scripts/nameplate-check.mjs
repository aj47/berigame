import fs from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),pw=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const out=process.env.SHOT_DIR??'docs/art/game-review/nameplates';fs.mkdirSync(out,{recursive:true});
const browser=await pw.chromium.launch({channel:'chrome'}),report={version:browser.version(),checks:[],errors:[]};
const check=(name,pass,detail)=>{report.checks.push({name,pass,detail});if(!pass)throw Error(name);console.log('PASS',name)};
const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2}),page=await ctx.newPage();
page.on('pageerror',e=>report.errors.push(e.message));
try{
 await page.goto(process.env.GAME_URL??'http://127.0.0.1:5173/play');await page.waitForFunction(()=>window.__berigame?.me&&!document.querySelector('.loading-screen'));
 const others=[];for(let i=0;i<2;i++){const c=await browser.newContext();const p=await c.newPage();await p.goto(process.env.GAME_URL??'http://127.0.0.1:5173/play');await p.waitForFunction(()=>window.__berigame?.me&&!document.querySelector('.loading-screen'));others.push(p)}
 await page.waitForTimeout(700);
 const labels=()=>page.evaluate(()=>[...document.querySelectorAll('[data-player-name]')].map(e=>({id:e.dataset.playerName,text:e.textContent,visibility:getComputedStyle(e).visibility,rect:e.getBoundingClientRect().toJSON()})));
 const spawn=await labels();check('shared spawn preserves You and hides overlapping ambient names',spawn.filter(e=>e.visibility==='visible').length===1&&spawn.find(e=>e.visibility==='visible').text==='You',spawn);
 await page.screenshot({path:out+'/same-spawn.png'});
 // M1: spawn is a safe ring (Chebyshev radius 3) and newcomers are in grace for up to 3:00, so the two
 // others share a tile just south of the ring and the target is attacked once its grace runs out.
 const ring={x:25,z:29};
 for(const p of others){const at=await p.evaluate(([x,z])=>window.__berigameProject(x,z,0),[ring.x,ring.z]);await p.mouse.click(at.x,at.y);await p.waitForFunction(([x,z])=>window.__berigame.me.x===x&&window.__berigame.me.z===z,[ring.x,ring.z],{timeout:15000})}
 const initial=await page.evaluate(()=>window.__berigame.me),point=await page.evaluate(([x,z])=>window.__berigameProject(x,z,0),[ring.x,ring.z+2]);await page.touchscreen.tap(point.x,point.y);await page.waitForFunction(z=>window.__berigame.me.z===z,ring.z+2,{timeout:15000});
 await page.waitForTimeout(1500);
 const graceEnds=Date.now()+200000;
 for(;;){const targetPoint=await page.evaluate(([x,z])=>window.__berigameProject(x,z,1),[ring.x,ring.z]);await page.touchscreen.tap(targetPoint.x,targetPoint.y);await page.getByRole('button',{name:'Attack',exact:true}).tap();
  if(await page.waitForFunction(()=>window.__berigame.me.hostile,null,{timeout:4000}).then(()=>true,()=>false))break;
  if(Date.now()>graceEnds)throw Error('the target never left first-spawn grace');await page.waitForTimeout(5000)}
 await page.waitForTimeout(200);const target=await page.evaluate(()=>window.__berigame.me.target),targetLabels=await labels();check('target label wins ambient collision',targetLabels.find(e=>e.id===target)?.visibility==='visible',targetLabels);
 await page.screenshot({path:out+'/target.png'});
 await page.getByRole('button',{name:/Stop/}).tap();
 await page.getByRole('button',{name:'Style',exact:true}).tap();await page.getByRole('button',{name:'Topknot',exact:true}).tap();await page.waitForTimeout(1000);await page.screenshot({path:out+'/topknot-clearance.png'});
 check('no page errors',report.errors.length===0,report.errors);report.status='passed';
}catch(e){report.status='failed';report.failure=String(e.stack??e);await page.screenshot({path:out+'/failure.png'});process.exitCode=1;console.error(e)}finally{fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));await browser.close()}
