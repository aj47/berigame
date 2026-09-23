// Run using an existing Playwright installation, no install required.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const {chromium}=await import(pathToFileURL(process.argv[2]).href);
const out=path.dirname(fileURLToPath(import.meta.url));
const browser=await chromium.launch({headless:true,channel:'chrome'});
const context=await browser.newContext({viewport:{width:1100,height:800}});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:8766/viewer.html');await page.waitForFunction(()=>window.review?.ready,{timeout:30000});
const data=await page.evaluate(()=>({asset:review.asset,clips:review.clips,validation:review.validate()}));
for(const [clip,time] of [['Idle',0],['Run',.12],['Strike',.36],['Grab',.36],['Guard',.3],['Turn',.58],['Defeat',1.19]]){
 await page.evaluate(({clip,time})=>{review.setClip(clip);review.setTime(time)},{clip,time});await page.waitForTimeout(100);await page.screenshot({path:`${out}/web-${clip.toLowerCase()}.png`});
}
await page.evaluate(()=>{review.setCount(32);review.setClip('Run')});await page.click('#pause');await page.waitForTimeout(2500);data.crowd=await page.evaluate(()=>review.snapshot());data.crowd.animationPlaying=true;data.errors=errors;
await page.screenshot({path:`${out}/web-crowd.png`});
data.note='Desktop headless Chrome, Three.js 0.183.2, isolated asset viewer. Not the game runtime or a smartphone benchmark.';
fs.writeFileSync(`${out}/web-validation.json`,JSON.stringify(data,null,2));console.log(JSON.stringify(data,null,2));
if(errors.length||data.validation.some(r=>!r.finite||r.minY<-.02||r.maxExtent>3)||data.asset.triangles>2500||data.asset.materials!==1||data.clips.length!==11)throw new Error('Asset validation failed');
await browser.close();
