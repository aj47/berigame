import fs from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),pw=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const out='docs/art/game-review/nameplates';fs.mkdirSync(out,{recursive:true});
const browser=await pw.chromium.launch({channel:'chrome'}),report={version:browser.version(),checks:[],errors:[]};
const check=(name,pass,detail)=>{report.checks.push({name,pass,detail});if(!pass)throw Error(name);console.log('PASS',name)};
const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2}),page=await ctx.newPage();
page.on('pageerror',e=>report.errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>window.__berigame?.me&&!document.querySelector('.loading-screen'));
 const others=[];for(let i=0;i<2;i++){const c=await browser.newContext();const p=await c.newPage();await p.goto('http://127.0.0.1:5173');await p.waitForFunction(()=>window.__berigame?.me&&!document.querySelector('.loading-screen'));others.push(p)}
 await page.waitForTimeout(700);
 const labels=()=>page.evaluate(()=>[...document.querySelectorAll('[data-player-name]')].map(e=>({id:e.dataset.playerName,text:e.textContent,visibility:getComputedStyle(e).visibility,rect:e.getBoundingClientRect().toJSON()})));
 const spawn=await labels();check('shared spawn preserves You and hides overlapping ambient names',spawn.filter(e=>e.visibility==='visible').length===1&&spawn.find(e=>e.visibility==='visible').text==='You',spawn);
 await page.screenshot({path:out+'/same-spawn.png'});
 const initial=await page.evaluate(()=>window.__berigame.me),point=await page.evaluate(([x,z])=>window.__berigameProject(x,z,0),[initial.x,initial.z+3]);await page.touchscreen.tap(point.x,point.y);await page.waitForFunction(z=>window.__berigame.me.z===z,initial.z+3);
 const targetPoint=await page.evaluate(([x,z])=>window.__berigameProject(x,z,1),[initial.x,initial.z]);await page.touchscreen.tap(targetPoint.x,targetPoint.y);await page.getByRole('button',{name:'Attack',exact:true}).tap();await page.waitForFunction(()=>window.__berigame.me.hostile);
 await page.waitForTimeout(200);const target=await page.evaluate(()=>window.__berigame.me.target),targetLabels=await labels();check('target label wins ambient collision',targetLabels.find(e=>e.id===target)?.visibility==='visible',targetLabels);
 await page.screenshot({path:out+'/target.png'});
 await page.getByRole('button',{name:/Stop/}).tap();
 await page.getByRole('button',{name:'Style',exact:true}).tap();await page.getByRole('button',{name:'Topknot',exact:true}).tap();await page.waitForTimeout(1000);await page.screenshot({path:out+'/topknot-clearance.png'});
 check('no page errors',report.errors.length===0,report.errors);report.status='passed';
}catch(e){report.status='failed';report.failure=String(e.stack??e);await page.screenshot({path:out+'/failure.png'});process.exitCode=1;console.error(e)}finally{fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));await browser.close()}
