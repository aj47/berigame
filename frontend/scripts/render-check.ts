/** Optional bounded render check against a running local dev client/server.
 * PLAYWRIGHT_MODULE=/path/to/playwright SPACETIME_DB=berigame-graphics-review \
 *   npx tsx scripts/render-check.ts
 * RENDER_APPEARANCE=1 additionally varies hairstyles/palettes, checks disposal,
 * and runs a 4x CPU-throttled viewport profile; writes a separate report.
 * Uses at most 32 online players including the browser and existing players.
 * Phone results emulate viewport/touch/DPR on this computer, not phone hardware.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { DbConnection, tables } from '../src/module_bindings';
import { DEFAULT_APPEARANCE, HAIR_STYLES, SKIN_TONES, HAIR_COLORS, ROBE_COLORS, WRAP_COLORS, type Appearance } from '../../shared/sim/appearance';

const loadModule = createRequire(path.join(__dirname, 'render-check.ts'));
const { chromium } = loadModule(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const URL = process.env.GAME_URL ?? 'http://127.0.0.1:5173/';
const DB = process.env.SPACETIME_DB ?? 'berigame';
const URI = process.env.SPACETIME_URI ?? 'ws://127.0.0.1:3000';
const APPEARANCE = process.env.RENDER_APPEARANCE === '1';
const OUT = path.resolve(process.env.RENDER_REPORT ?? path.join(__dirname, APPEARANCE ? '../../docs/art/game-review/appearance-render-validation.json' : '../../docs/art/game-review/render-validation.json'));
const TARGET = Math.max(1, Math.min(32, Number(process.env.RENDER_PLAYERS ?? 32)));
function sourceDigest() {
  const base = path.resolve(__dirname, '..');
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
  const files = [...walk(path.join(base, 'src')), ...walk(path.join(base, 'public')), ...walk(path.resolve(base, '../shared/sim'))].sort();
  const hash = createHash('sha256');
  for (const file of files) hash.update(path.relative(base, file)).update(fs.readFileSync(file));
  return hash.digest('hex');
}
const fixtures: DbConnection[] = [];
const connections: DbConnection[] = [];
let controller: DbConnection | undefined;
let cpuThrottleRate = 1;
let cdp: any;
const failures: string[] = [];
const errors: string[] = [];
const report: any = {
  createdAt: new Date().toISOString(), url: URL, database: DB,
  host: { platform: os.platform(), architecture: os.arch(), cpu: os.cpus()[0]?.model },
  qualification: 'The optional 4x CPU throttling profile is a browser CPU-throughput proxy using the same host GPU; it does not emulate a phone CPU/GPU or establish physical-phone performance. Local development build, headless desktop Chrome. Phone profile emulates viewport, touch, and device pixel ratio on the same computer; it is not physical-phone performance evidence. Frame data includes browser and machine scheduling noise.',
  sourceSha256: sourceDigest(), modelSha256: createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '../public/models/starter-adventurer.glb'))).digest('hex'),
  appearanceMode: APPEARANCE,
  assetSha256: Object.fromEntries(fs.readdirSync(path.resolve(__dirname, '../public/models')).filter((name) => name.endsWith('.glb')).sort().map((name) => [name, createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '../public/models', name))).digest('hex')])),
  paletteSha256: createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '../src/appearance/palette.ts'))).digest('hex'),
  catalogSha256: createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '../../shared/sim/appearance.ts'))).digest('hex'),
  targetOnlinePlayers: TARGET, samples: [], movementClicks: null, cleanup: null,
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function check(label: string, ok: boolean) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
}
async function until(label: string, predicate: () => Promise<boolean>, timeout = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await predicate()) return;
    await sleep(100);
  }
  throw new Error(`timeout: ${label}`);
}
function fixture(token?: string, crowd = true) {
  return new Promise<DbConnection>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fixture connection timeout')), 10_000);
    const connection = DbConnection.builder().withUri(URI).withDatabaseName(DB).withToken(token)
      .onConnectError((_ctx, error) => { clearTimeout(timer); reject(error); })
      .onConnect((c) => {
        c.subscriptionBuilder().onApplied(() => { clearTimeout(timer); resolve(c); })
          .onError((_ctx, error) => { clearTimeout(timer); reject(error); })
          .subscribe([tables.world, tables.player, tables.appearance]);
      }).build();
    connections.push(connection);
    if (crowd) fixtures.push(connection);
  });
}

let browser: any;
let context: any;
let page: any;
let movementTimer: ReturnType<typeof setInterval> | undefined;
let moveRound = 0;
async function open(profile: 'desktop' | 'phone') {
  if (context) { await context.close(); await sleep(600); }
  context = await browser.newContext(profile === 'desktop'
    ? { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }
    : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  page = await context.newPage();
  // tsx preserves function names with this helper in serialized evaluate callbacks.
  await page.addInitScript({ content: 'window.__name = function(value) { return value; };' });
  page.on('pageerror', (error: Error) => errors.push(`${profile}: ${error.message}`));
  page.on('console', (message: any) => { if (message.type() === 'error') errors.push(`${profile}: ${message.text()}`); });
  cdp = await context.newCDPSession(page);
  cpuThrottleRate = 1;
  await page.goto(URL);
  await page.waitForFunction(() => !!(window as any).__berigame?.me && !!(window as any).__berigameRender && !document.querySelector('.loading-screen'), null, { timeout: 25_000 });
  await sleep(1500);
}
async function sample(label: string) {
  const measurement = await page.evaluate(async () => {
    const frames: number[] = [];
    const render: any[] = [];
    let previous: number | null = null;
    const started = performance.now();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('RAF sampling stalled')), 12_000);
      const frame = (time: number) => {
        if (previous !== null) frames.push(time - previous);
        previous = time;
        render.push({ ...(window as any).__berigameRender });
        if (time - started < 6000) requestAnimationFrame(frame);
        else { clearTimeout(timeout); resolve(); }
      };
      requestAnimationFrame(frame);
    });
    const sorted = [...frames].sort((a, b) => a - b);
    const percentile = (p: number) => Number((sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0).toFixed(2));
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
    const range = (key: string) => ({ min: Math.min(...render.map((s) => s[key])), max: Math.max(...render.map((s) => s[key])) });
    const canvas = document.querySelector('canvas');
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    const extension = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      onlinePlayers: (window as any).__berigame.players.filter((p: any) => p.online).length,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      frames: { count: frames.length, averageMs: Number(avg.toFixed(2)), estimatedFps: Number((1000 / avg).toFixed(1)), p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99), maxMs: percentile(1), over33ms: frames.filter((ms) => ms > 33.5).length },
      renderer: { calls: range('calls'), triangles: range('triangles'), geometries: range('geometries'), textures: range('textures'), pixelRatio: range('pixelRatio') },
      gpu: extension ? gl?.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unavailable',
    };
  });
  const resources = APPEARANCE ? await rendererSnapshot() : undefined;
  report.samples.push({ label, cpuThrottleRate, ...measurement, resources });
  console.log(JSON.stringify({ label, ...measurement }));
  check(`${label}: bounded online player count`, measurement.onlinePlayers <= 32);
  check(`${label}: delivered at least 30 rendered frames`, measurement.frames.count >= 30);
}
async function moveFixtures() {
  const targets = fixtures.map((connection, index) => ({ connection, x: 22 + index % 6 + moveRound % 2, z: 22 + Math.floor(index / 6) }));
  moveRound++;
  await Promise.all(targets.map(({ connection, x, z }) => connection.reducers.setTarget({ x, z }).catch((error) => errors.push(`fixture movement: ${error}`))));
}
async function markerCheck() {
  const click = async (index: number) => {
    const point = await page.evaluate(([x, z]: number[]) => (window as any).__berigameProject(x, z, 0), [25 + index % 2, 31]);
    const viewport = page.viewportSize();
    if (point.x < 0 || point.y < 65 || point.x > viewport.width || point.y > viewport.height - 160) throw new Error('marker target outside unobstructed viewport');
    await page.mouse.click(point.x, point.y);
    await sleep(180);
    if (await page.locator('.click-dropdown').count()) throw new Error('ground-click ray was intercepted by an object; choose an unobstructed marker-test tile');
  };
  // Visit both endpoints first: camera movement can legitimately upload newly
  // visible scenery geometry. Only measure repeated clicks after that warmup.
  for (const index of [1, 0]) {
    await click(index);
    await until('marker warmup destination reached', () => page.evaluate((x: number) => (window as any).__berigame.me.x === x && (window as any).__berigame.me.z === 31, 25 + index));
    await sleep(1200);
  }
  const initialTile = await page.evaluate(() => ({ x: (window as any).__berigame.me.x, z: (window as any).__berigame.me.z }));
  const before = await page.evaluate(() => ({ ...(window as any).__berigameRender }));
  const counts: number[] = [];
  for (let i = 0; i < 24; i++) {
    await click(i);
    counts.push(await page.evaluate(() => (window as any).__berigameRender.geometries));
  }
  await sleep(1200);
  const after = await page.evaluate(() => ({ ...(window as any).__berigameRender }));
  const finalTile = await page.evaluate(() => ({ x: (window as any).__berigame.me.x, z: (window as any).__berigame.me.z }));
  report.movementClicks = { count: 24, initialTile, finalTile, before, after, geometryCounts: counts };
  check('ground clicks actually move the authoritative player', initialTile.x !== finalTile.x || initialTile.z !== finalTile.z);
  check('24 movement clicks do not increase geometry allocations', Math.max(...counts, after.geometries) <= before.geometries);
}

function appearanceFor(index: number): Appearance {
  return { hairStyle: index % HAIR_STYLES.length, skinTone: index % SKIN_TONES.length,
    hairColor: index % HAIR_COLORS.length, robeColor: index % ROBE_COLORS.length, wrapColor: index % WRAP_COLORS.length };
}
async function rendererSnapshot() {
  return page.evaluate(() => ({ ...(window as any).__berigameRender, ...(window as any).__berigameResources?.() }));
}
async function appearanceObserved(value: Appearance) {
  await until('local appearance rendered', () => page.evaluate((expected: Appearance) => {
    const avatar = (window as any).__berigameAvatars().find((a: any) => a.identity === (window as any).__berigame.me.hex);
    return avatar && Object.entries(expected).every(([key, entry]) => avatar.appearance[key] === entry);
  }, value));
  await sleep(180);
}
function resourceCheck(label: string, baseline: any, after: any) {
  for (const key of ['textures', 'sceneMaterialCount', 'paletteEntries', 'paletteUsers']) {
    check(`${label}: ${key} returns to baseline`, Number.isFinite(after[key]) && after[key] <= baseline[key]);
  }
}
async function appearanceResources() {
  // Reuse the browser identity only during this solitary phase. Closing this
  // extra SDK connection before spawning the crowd keeps the total <=32.
  const token = await page.evaluate(async () => {
    const { TOKEN_KEY } = await import('/src/spacetime/connection.ts');
    return localStorage.getItem(TOKEN_KEY);
  });
  if (!token) throw new Error('browser scoped token unavailable');
  controller = await fixture(token, false);
  for (let index = 0; index < 3; index++) {
    const appearance = appearanceFor(index);
    await controller.reducers.setAppearance(appearance);
    await appearanceObserved(appearance);
  }
  await controller.reducers.setAppearance({ ...DEFAULT_APPEARANCE });
  await appearanceObserved({ ...DEFAULT_APPEARANCE });
  await sleep(1200);
  const before = await rendererSnapshot();
  check('material/palette diagnostics are available', Number.isFinite(before.sceneMaterialCount) && Number.isFinite(before.paletteEntries) && Number.isFinite(before.paletteUsers));
  const sdkSamples: any[] = [];
  for (let index = 1; index <= 24; index++) {
    const appearance = appearanceFor(index);
    await controller.reducers.setAppearance(appearance);
    await appearanceObserved(appearance);
    sdkSamples.push({ index, appearance, renderer: await rendererSnapshot() });
  }
  await controller.reducers.setAppearance({ ...DEFAULT_APPEARANCE });
  await appearanceObserved({ ...DEFAULT_APPEARANCE });
  await sleep(1200);
  const afterSDK = await rendererSnapshot();
  resourceCheck('24 authoritative appearance changes', before, afterSDK);
  const previewSamples: any[] = [];
  for (let index = 1; index <= 24; index++) {
    const appearance = appearanceFor(index);
    await page.getByRole('button', { name: 'Style', exact: true }).click();
    for (const name of [HAIR_STYLES[appearance.hairStyle].name, `Skin tone: ${SKIN_TONES[appearance.skinTone].name}`,
      `Hair color: ${HAIR_COLORS[appearance.hairColor].name}`, `Robe: ${ROBE_COLORS[appearance.robeColor].name}`, `Wraps: ${WRAP_COLORS[appearance.wrapColor].name}`]) {
      await page.getByRole('button', { name, exact: true }).click();
    }
    await appearanceObserved(appearance);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await appearanceObserved({ ...DEFAULT_APPEARANCE });
    previewSamples.push({ index, renderer: await rendererSnapshot() });
  }
  await sleep(1200);
  const afterPreview = await rendererSnapshot();
  resourceCheck('24 editor preview/cancel cycles', before, afterPreview);
  report.appearanceCycles = { sdkChanges: 24, previewCancelCycles: 24, before, afterSDK, afterPreview, sdkSamples, previewSamples };
  controller.disconnect(); controller = undefined;
  await sleep(600);
}

async function main() {
try {
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'chrome' });
  report.browserVersion = browser.version();
  await open('desktop');
  if (APPEARANCE) { await appearanceResources(); await markerCheck(); }
  await sample('desktop baseline');
  const desktopResourceBaseline = await rendererSnapshot();
  const baselineOnline = await page.evaluate(() => (window as any).__berigame.players.filter((p: any) => p.online).length);
  report.fixtureCount = Math.max(0, TARGET - baselineOnline);
  report.baselineOnlinePlayers = baselineOnline;
  report.maximumHarnessConcurrentConnections = 1 + report.fixtureCount;
  report.fixtureAppearanceVariants = [];
  check('fixture count plus browser stays within 32 connections', 1 + report.fixtureCount <= 32);
  for (let i = 0; i < report.fixtureCount; i++) {
    const connection = await fixture();
    if (APPEARANCE) {
      const appearance = appearanceFor(i);
      await connection.reducers.setAppearance(appearance);
      report.fixtureAppearanceVariants.push(appearance);
    }
    if (i % 8 === 7) await sleep(100);
  }
  await until('all crowd players observed', () => page.evaluate((count: number) => (window as any).__berigame.players.filter((p: any) => p.online).length >= count, baselineOnline + report.fixtureCount));
  if (APPEARANCE) {
    await until('crowd hairstyles rendered', () => page.evaluate(() => new Set((window as any).__berigameAvatars().map((a: any) => a.appearance.hairStyle)).size === 3));
  }
  await moveFixtures();
  await sleep(4000);
  await sample('desktop crowd idle');
  movementTimer = setInterval(() => { void moveFixtures(); }, 1400);
  await sample('desktop crowd moving');
  clearInterval(movementTimer); movementTimer = undefined;
  if (!APPEARANCE) await markerCheck();
  if (APPEARANCE) {
    // Keep this browser and identity alive; no transition opens an extra socket.
    await page.setViewportSize({ width: 390, height: 844 });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await sleep(1500);
  } else await open('phone');
  await sample('390px phone emulation crowd idle');
  movementTimer = setInterval(() => { void moveFixtures(); }, 1400);
  await sample('390px phone emulation crowd moving');
  clearInterval(movementTimer); movementTimer = undefined;
  if (APPEARANCE) {
    cpuThrottleRate = 4;
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottleRate });
    await sleep(1500);
    await sample('390px mobile viewport, 4x CPU throttle, crowd idle');
    movementTimer = setInterval(() => { void moveFixtures(); }, 1400);
    await sample('390px mobile viewport, 4x CPU throttle, crowd moving');
    clearInterval(movementTimer); movementTimer = undefined;
    cpuThrottleRate = 1;
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
  for (const connection of fixtures) connection.disconnect();
  await until('fixture connections offline', async () => {
    const ids = fixtures.map((connection) => connection.identity?.toHexString());
    return page.evaluate((fixtureIds: string[]) => !(window as any).__berigame.players.some((p: any) => p.online && fixtureIds.includes(p.hex)), ids);
  });
  report.cleanup = { sdkFixturesOffline: true, fixtureCount: fixtures.length };
  await sample('390px phone emulation after crowd disconnected');
  if (APPEARANCE) {
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await page.setViewportSize({ width: 1280, height: 800 });
    await sleep(2000);
    const after = await rendererSnapshot();
    report.crowdResourceCleanup = { before: desktopResourceBaseline, after };
    resourceCheck('crowd disconnected and desktop restored', desktopResourceBaseline, after);
    await sample('desktop after appearance crowd disconnected');
  }
  check('no browser or fixture errors', errors.length === 0);
} catch (error) {
  failures.push(String(error));
  console.error(error);
} finally {
  if (movementTimer) clearInterval(movementTimer);
  for (const connection of connections) connection.disconnect();
  await browser?.close();
  report.cleanup = { ...(report.cleanup ?? {}), disconnectCalledForAllFixtures: true, browserClosed: true };
  report.finishedAt = new Date().toISOString();
  report.finalSourceSha256 = sourceDigest();
  check('render source stayed unchanged during measurement', report.sourceSha256 === report.finalSourceSha256);
  report.errors = errors;
  report.failures = failures;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(`Report: ${OUT}`);
}
process.exitCode = failures.length ? 1 : 0;
}
void main();
