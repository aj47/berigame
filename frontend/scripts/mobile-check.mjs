/** Touch interaction and visual evidence against the running local game. */
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const out=process.env.SHOT_DIR ?? '../docs/art/game-review';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome'});
const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
const page=await ctx.newPage();const errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
const check=(name,value)=>{checks.push({name,passed:Boolean(value)});if(!value)throw new Error(name);};
try {
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5173');
  await page.waitForFunction(()=>window.__berigame?.me && !document.querySelector('.loading-screen'));
  await page.waitForTimeout(1000);
  await page.screenshot({path:`${out}/phone-strike.png`});
  for(const [name,stance] of [['Grab',1],['Guard',2],['Strike',0]]) {
    await page.locator('.stance-button').filter({has:page.getByText(name,{exact:true})}).tap();
    await page.waitForFunction(s=>window.__berigame.me.stance===s,stance);
    await page.waitForTimeout(600);await page.screenshot({path:`${out}/phone-${name.toLowerCase()}.png`});
  }
  check('all three stances usable by touch',true);
  const me=await page.evaluate(()=>window.__berigame.me);
  const target=await page.evaluate(([x,z])=>window.__berigameProject(x,z,0),[me.x,me.z+2]);
  await page.touchscreen.tap(target.x,target.y);
  await page.waitForFunction(z=>window.__berigame.me.z===z,me.z+2,{timeout:7000});
  check('touch ground movement reaches chosen tile',true);
  await page.locator('.gather-shortcut').tap();
  await page.getByRole('button',{name:/^Bag/}).tap();
  await page.locator('.inventory-slot.filled').first().waitFor({timeout:16000});
  check('Gather shortcut harvests a real berry',true);
  await page.locator('.inventory-slot.filled').first().tap();
  await page.screenshot({path:`${out}/phone-inventory.png`});
  await page.getByRole('button',{name:'Move',exact:true}).tap();
  await page.locator('.inventory-slot').nth(3).tap();
  await page.waitForFunction(()=>document.querySelectorAll('.inventory-slot')[3]?.classList.contains('filled'));
  check('touch item selection and Move persist',true);
  await page.getByRole('button',{name:'Close inventory'}).tap();
  await page.getByRole('button',{name:/^Chat/}).tap();
  await page.getByRole('textbox',{name:'Message',exact:true}).fill('A readable bubble on a small screen.');
  await page.getByRole('button',{name:'Send',exact:true}).tap();
  await page.getByRole('button',{name:'Close chat'}).tap();
  await page.locator('.player-chat-bubble').filter({hasText:'A readable bubble'}).waitFor();
  const bubble=await page.locator('.player-chat-bubble').filter({hasText:'A readable bubble'}).boundingBox();
  check('chat bubble wraps across a readable width',bubble.width>100 && bubble.height<150);
  await page.screenshot({path:`${out}/phone-chat.png`});
  await page.getByRole('button',{name:/^Help/}).tap();
  await page.getByRole('button',{name:/Reset view/}).tap();
  await page.screenshot({path:`${out}/phone-help.png`});
  await page.getByRole('button',{name:'Close help'}).tap();
  await page.setViewportSize({width:844,height:390});
  await page.waitForTimeout(1500);
  await page.getByRole('button',{name:/^Bag/}).tap();
  await page.locator('.inventory-slot.filled').first().tap();
  const eat=await page.getByRole('button',{name:/^Eat/}).boundingBox();
  check('landscape item actions remain visible',eat.y>=0 && eat.y+eat.height<=390);
  await page.screenshot({path:`${out}/phone-landscape.png`});
  await page.getByRole('button',{name:'Close inventory'}).tap();
  await page.setViewportSize({width:1440,height:900});
  await page.waitForTimeout(1600);await page.screenshot({path:`${out}/desktop-final.png`});
  check('no page errors',errors.length===0);
} finally {
  fs.writeFileSync(`${out}/mobile-validation.json`,JSON.stringify({qualification:'Touch/viewport emulation in desktop Chrome, not physical-phone testing.',checks,errors},null,2));
  await browser.close();
}
console.log(JSON.stringify({checks,errors},null,2));
