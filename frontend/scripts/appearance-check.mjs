/** First-visit creator, multiplayer persistence, and responsive layout checks against a local dev server. */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require=createRequire(import.meta.url);
const playwright=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const engine=process.env.ENGINE??'chromium';
const out=process.env.SHOT_DIR??fileURLToPath(new URL('../../docs/art/game-review/character-creator',import.meta.url));
const gameUrl=process.env.GAME_URL??'http://127.0.0.1:5173';
fs.mkdirSync(out,{recursive:true});
(async()=>{
const browser=await playwright[engine].launch(engine==='chromium'?{channel:'chrome',headless:true}:{headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900}});
const page=await context.newPage();const errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name);console.log('PASS',name)};
try{
 await page.goto(gameUrl);await page.waitForFunction(()=>window.__berigame?.me&&!document.querySelector('.loading-screen'),null,{timeout:60000});
 check('first visit opens name and character setup',await page.getByRole('dialog').isVisible());
 const hex=await page.evaluate(()=>window.__berigame.me.hex);
 await page.getByLabel('What should we call you?').fill('Fern'+Date.now().toString().slice(-6));
 for(const name of ['Wayfarer','Woodland','Sunseeker','Tidewalker','Stargazer','Pathfinder']){
  await page.getByRole('button',{name:new RegExp(name)}).click();await page.waitForTimeout(700);
  await page.screenshot({path:`${out}/preset-${name.toLowerCase()}.png`});
 }
 // Cancel only exists on later edits. First setup saves the entire advanced look.
 await page.getByRole('button',{name:/Enter the island/}).click();
 await page.getByRole('dialog').waitFor({state:'hidden'});
 check('save closes first setup',true);
 const mine=await page.evaluate(hex=>window.__berigameAvatars().find(a=>a.identity===hex),hex);
 check('new details reach own world avatar',mine.appearance.bodyType===2&&mine.appearance.outfitStyle===3&&mine.appearance.accessory===4,mine);
 const observer=await browser.newPage({viewport:{width:1100,height:800}});await observer.goto(gameUrl);
 await observer.waitForFunction(hex=>window.__berigameAvatars?.().some(a=>a.identity===hex&&a.appearance.accessory===4),hex,{timeout:40000});
 check('another player receives the saved advanced appearance',true);
 await observer.close();await page.reload();await page.waitForFunction(()=>window.__berigame?.me&&!document.querySelector('.loading-screen'),null,{timeout:40000});
 check('reload keeps the saved setup closed',await page.getByRole('dialog').count()===0);
 await page.getByRole('button',{name:/Menu/}).click();await page.getByRole('button',{name:'Character',exact:true}).click();
 await page.getByRole('tab',{name:'Details',exact:true}).click();
 check('saved accessory survives reload',await page.getByRole('button',{name:'Eye patch',exact:true}).getAttribute('aria-pressed')==='true');
 await page.getByRole('button',{name:'Round glasses',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('button',{name:/Menu/}).click();await page.getByRole('button',{name:'Character',exact:true}).click();await page.getByRole('tab',{name:'Details',exact:true}).click();
 check('cancel restores saved accessory',await page.getByRole('button',{name:'Eye patch',exact:true}).getAttribute('aria-pressed')==='true');
 await page.getByRole('tab',{name:'Start',exact:true}).click();
 await page.getByLabel('What should we call you?').fill('Renamed'+Date.now().toString().slice(-6));await page.getByRole('button',{name:'Save character',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 check('rename-only edit succeeds',true);
 await page.getByRole('button',{name:/Menu/}).click();await page.getByRole('button',{name:'Character',exact:true}).click();
 for(const [width,height] of [[320,568],[360,640],[390,844],[768,1024],[844,390],[1024,768],[1440,900]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(250);
  for(const tab of ['Start','Face','Hair','Outfit','Details']){
   await page.getByRole('tab',{name:tab,exact:true}).click();
   const layout=await page.evaluate(()=>{const d=document.querySelector('.character-creator').getBoundingClientRect();const f=document.querySelector('.creator-footer').getBoundingClientRect();const s=document.querySelector('.creator-options-scroll');return {viewport:[innerWidth,innerHeight],dialog:[d.x,d.y,d.right,d.bottom],footer:[f.x,f.y,f.right,f.bottom],overflow:s.scrollWidth>s.clientWidth+1}});
   check(`${width}x${height} ${tab} fits with reachable actions`,layout.dialog[0]>=-1&&layout.dialog[1]>=-1&&layout.dialog[2]<=width+1&&layout.dialog[3]<=height+1&&layout.footer[3]<=height+1&&!layout.overflow,layout);
  }
 }
 check('no browser exceptions',errors.length===0,errors);
 fs.writeFileSync(`${out}/validation.json`,JSON.stringify({checks,errors},null,2));
}catch(e){await page.screenshot({path:`${out}/failure.png`});fs.writeFileSync(`${out}/validation.json`,JSON.stringify({checks,errors,error:String(e.stack)},null,2));throw e;}finally{await browser.close();}
})();
