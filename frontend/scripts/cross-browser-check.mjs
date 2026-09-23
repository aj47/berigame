/** Installed-engine smoke. No browser downloads. Run with PLAYWRIGHT_MODULE and
 * optional WEBKIT_EXECUTABLE/FIREFOX_EXECUTABLE; output is cross-browser.json. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const modulePath = process.env.PLAYWRIGHT_MODULE ?? 'playwright';
const playwright = require(modulePath);
const output = process.env.SHOT_DIR ?? '../docs/art/game-review/cross-browser';
fs.mkdirSync(output, { recursive: true });
const report = { playwrightVersion: require(`${modulePath}/package.json`).version, at: new Date().toISOString(), qualification: 'Desktop browser engines with mobile viewport/touch emulation; not physical phones.', url: process.env.GAME_URL ?? 'http://127.0.0.1:5173', engines: [] };
const engines = (process.env.ENGINES ?? 'webkit,firefox').split(',');
for (const name of engines) {
  const result = { engine: name, version: null, status: 'running', checks: [], pageErrors: [], consoleErrors: [], consoleWarnings: [] };
  report.engines.push(result);
  let browser;
  let page;
  const check = (label, pass, detail) => { result.checks.push({ label, pass: Boolean(pass), ...(detail === undefined ? {} : { detail }) }); if (!pass) throw new Error(label); console.log(name, 'PASS', label); };
  try {
    const executablePath = process.env[`${name.toUpperCase()}_EXECUTABLE`];
    browser = await playwright[name].launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    result.version = browser.version();
    result.executable = executablePath ?? playwright[name].executablePath();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, ...(name === 'webkit' ? { isMobile: true } : {}) });
    page = await ctx.newPage();
    page.on('pageerror', error => result.pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push(message.text()); if (message.type() === 'warning') result.consoleWarnings.push(message.text()); });
    let socket;
    await page.routeWebSocket(/ws:\/\/.*:3000\//, route => { socket = route; route.connectToServer(); });
    const modelRequests = [];
    page.on('response', response => { if (response.url().includes('starter-adventurer.glb')) modelRequests.push(response.status()); });
    await page.goto(report.url);
    await page.waitForFunction(() => window.__berigame?.me && window.__berigameRender?.triangles > 1000 && !document.querySelector('.loading-screen'), null, { timeout: 30000 });
    check('world connected, animated model fetched and WebGL scene rendered', modelRequests.includes(200), await page.evaluate(() => window.__berigameRender));
    await page.screenshot({ path: path.join(output, `${name}-initial.png`) });
    for (const [label, value] of [['Grab', 1], ['Guard', 2], ['Strike', 0]]) {
      await page.locator('.stance-button').filter({ has: page.getByText(label, { exact: true }) }).tap();
      await page.waitForFunction(stance => window.__berigame.me.stance === stance, value, { timeout: 5000 });
    }
    check('three stance controls work via touch', true);
    const original = await page.evaluate(() => window.__berigame.me);
    const target = await page.evaluate(([x, z]) => window.__berigameProject(x, z, 0), [original.x, original.z + 2]);
    await page.touchscreen.tap(target.x, target.y);
    await page.waitForFunction(z => window.__berigame.me.z === z, original.z + 2, { timeout: 8000 });
    check('touch ground movement reaches chosen tile', true);
    // Reserve tree 2 for WebKit and tree 6 for Firefox; never consume trees 3/4.
    const tree = name === 'webkit' ? { id: 2, x: 30, z: 35 } : { id: 6, x: 25, z: 15 };
    // Move within a few tiles first, then select the actual visible tree.
    const approach = await page.evaluate(([x,z]) => window.__berigameProject(x,z,0), [tree.x, tree.z + (tree.z > 25 ? -3 : 3)]);
    if (approach.x >= 0 && approach.x <= 390 && approach.y >= 120 && approach.y < 680) await page.touchscreen.tap(approach.x, approach.y);
    // Zoom out through the game's Reset view if necessary; projection drives only real pointer events.
    for (let i = 0; i < 12; i++) {
      const state = await page.evaluate(() => window.__berigame.me);
      if (Math.max(Math.abs(state.x-tree.x),Math.abs(state.z-tree.z)) <= 4) break;
      const dx = Math.sign(tree.x-state.x)*Math.min(2,Math.abs(tree.x-state.x));
      const dz = Math.sign(tree.z-state.z)*Math.min(2,Math.abs(tree.z-state.z));
      const point = await page.evaluate(([x,z]) => window.__berigameProject(x,z,0), [state.x+dx,state.z+dz]);
      await page.touchscreen.tap(point.x, point.y);
      await page.waitForTimeout(1300);
    }
    const treePoint = await page.evaluate(([x,z]) => window.__berigameProject(x,z,1.5), [tree.x,tree.z]);
    await page.touchscreen.tap(treePoint.x,treePoint.y);
    await page.locator('.click-dropdown').waitFor({ timeout: 5000 });
    await page.locator('.context-action').filter({hasText:'Harvest'}).tap({timeout:5000});
    await page.getByRole('button',{name:/^Bag/}).tap();
    await page.locator('.inventory-slot.filled').first().waitFor({timeout:18000});
    check(`tree ${tree.id} harvest produces a berry`,true);
    await page.locator('.inventory-slot.filled').first().tap();
    await page.getByRole('button',{name:'Move',exact:true}).tap();
    await page.locator('.inventory-slot').nth(3).tap();
    await page.waitForFunction(() => document.querySelectorAll('.inventory-slot')[3]?.classList.contains('filled'));
    check('touch inventory Move persists',true);
    await page.screenshot({path:path.join(output,`${name}-inventory.png`)});
    await page.getByRole('button',{name:'Close inventory'}).tap();
    await page.getByRole('button',{name:/^Chat/}).tap();
    const message=`${name} engine check ${Date.now()}`;
    await page.getByRole('textbox',{name:'Message',exact:true}).fill(message);
    await page.getByRole('button',{name:'Send',exact:true}).tap();
    await page.getByRole('log').getByText(message,{exact:true}).waitFor();
    check('chat sends and appears in the log',true);
    await page.getByRole('button',{name:'Close chat'}).tap();
    const bubble=await page.locator('.player-chat-bubble').filter({hasText:message}).boundingBox();
    check('chat bubble retains readable width',bubble && bubble.width>100 && bubble.height<140,bubble);
    await page.screenshot({path:path.join(output,`${name}-chat.png`)});
    check('WebSocket interception available for real client disconnect',Boolean(socket));
    await socket.close({code:1001,reason:'Local engine reconnect check'});
    await page.getByRole('heading',{name:'Connection interrupted'}).waitFor({timeout:10000});
    check('connection loss shows recovery overlay',true);
    await page.screenshot({path:path.join(output,`${name}-disconnected.png`)});
    await page.getByRole('button',{name:'Rejoin island'}).tap();
    await page.waitForFunction(hex=>window.__berigame?.me?.hex===hex && !document.querySelector('.loading-screen'),original.hex,{timeout:20000});
    await page.getByRole('button',{name:/^Bag/}).tap();
    await page.locator('.inventory-slot.filled').first().waitFor();
    check('rejoin preserves identity and carried inventory',true);
    await page.setViewportSize({width:844,height:390});
    await page.waitForTimeout(1200); // Allow the responsive camera transition to settle.
    await page.locator('.inventory-slot.filled').first().tap();
    const action=await page.getByRole('button',{name:/^Eat/}).boundingBox();
    check('landscape inventory action fits viewport',action.y>=0 && action.y+action.height<=390,action);
    await page.screenshot({path:path.join(output,`${name}-landscape.png`)});
    check('no JavaScript page errors',result.pageErrors.length===0);
    check('no browser console errors',result.consoleErrors.length===0);
    result.status='passed';
  } catch(error) {
    result.status=page?'failed':browser?'engine-incompatible':'engine-unavailable';result.error=String(error?.stack ?? error);
    console.error(name,result.status,String(error));
    if(page) {await page.screenshot({path:path.join(output,`${name}-failure.png`)}).catch(()=>{});result.lastState=await page.evaluate(()=>({game:window.__berigame,render:window.__berigameRender,text:document.body.innerText})).catch(()=>null);}
  } finally {if(browser)await browser.close();fs.writeFileSync(path.join(output,'cross-browser.json'),JSON.stringify(report,null,2));}
}
console.log(JSON.stringify(report,null,2));
process.exitCode=report.engines.some(engine=>engine.status==='failed')?1:0;
