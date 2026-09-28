/** Touch interaction and visual evidence against the running local game. */
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const out=process.env.SHOT_DIR ?? '../docs/art/game-review';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome'});
const [vw,vh]=(process.env.MOBILE_VIEWPORT??'390x844').split('x').map(Number);
const ctx=await browser.newContext({viewport:{width:vw,height:vh},deviceScaleFactor:2,isMobile:true,hasTouch:true});
const page=await ctx.newPage();const errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
const check=(name,value)=>{checks.push({name,passed:Boolean(value)});if(!value)throw new Error(name);};
try {
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5173');
  await page.waitForFunction(()=>window.__berigame?.me && !document.querySelector('.loading-screen'));
  await page.waitForTimeout(1000);
  await page.screenshot({path:`${out}/phone-hud.png`});
  // The combat HUD now holds three quick slots (inventory slots 1-3) and Stop; a fresh character punches.
  const quick=await page.locator('.combat-hud .hotbar-slot').evaluateAll(els=>els.map(el=>el.getAttribute('aria-label')));
  check('three empty quick slots and the punch chip fit the phone HUD',quick.length===3&&quick.every((l,i)=>l===`Quick slot ${i+1}: empty`)&&/Punch/.test(await page.locator('.combat-hud').textContent()));
  for(const box of await page.locator('.combat-hud .hotbar-slot, .combat-hud .stop-button').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().toJSON())))
    check('quick slot and Stop touch targets are on screen and at least 40px tall',box.left>=0&&box.right<=vw&&box.bottom<=vh&&box.height>=40);
  const me=await page.evaluate(()=>window.__berigame.me);
  const target=await page.evaluate(([x,z])=>window.__berigameProject(x,z,0),[me.x,me.z+2]);
  await page.touchscreen.tap(target.x,target.y);
  await page.waitForFunction(z=>window.__berigame.me.z===z,me.z+2,{timeout:7000});
  check('touch ground movement reaches chosen tile',true);
  await page.locator('.goal-chip').tap();
  await page.getByRole('button',{name:/^Bag/}).tap();
  await page.locator('.inventory-slot.filled').first().waitFor({timeout:16000});
  // A harvest may add a stick next to the berry in the same update, so pick rows by name.
  check('Goal chip harvests a real berry',/^Slot 1: \w+berry, 1\b/.test(await page.locator('.inventory-slot').first().getAttribute('aria-label')));
  const stickFound=await page.locator('.inventory-slot[aria-label*=": Stick"]').count()>0;
  await page.locator('.inventory-slot.filled').first().tap();
  await page.screenshot({path:`${out}/phone-inventory.png`});
  await page.getByRole('button',{name:'Move',exact:true}).tap();
  await page.locator('.inventory-slot').nth(3).tap();
  await page.waitForFunction(()=>document.querySelectorAll('.inventory-slot')[3]?.classList.contains('filled'));
  check('touch item selection and Move persist',true);
  await page.getByRole('button',{name:'Close inventory'}).tap();
  if(stickFound) {
    // The bonus stick landed in a quick slot: tapping it wields it, tapping again puts it away.
    const slot=page.locator('.combat-hud .hotbar-slot[aria-label^="Quick slot"][aria-label*="Stick"]').first();
    await slot.tap();
    await page.waitForFunction(()=>window.__berigame.me.weapon==='stick');
    await page.waitForTimeout(600);await page.screenshot({path:`${out}/phone-stick.png`});
    check('tapping the stick quick slot wields it',await slot.getAttribute('aria-pressed')==='true');
    await slot.tap();
    await page.waitForFunction(()=>window.__berigame.me.weapon==='');
    check('tapping it again returns to punching',true);
  }
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
  await page.locator('.inventory-slot.filled[aria-label*="berry"]').first().tap();
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
