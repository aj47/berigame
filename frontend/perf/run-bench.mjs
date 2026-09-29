/**
 * Headless avatar render benchmark.
 *   npx vite --config perf/vite.bench.config.ts --port 6010 &   (from frontend/)
 *   PLAYWRIGHT_MODULE=$(npm root -g)/playwright BENCH_OUT=out.json SHOTS=dir node perf/run-bench.mjs
 * For each avatar count: draw calls, triangles, frame time (rAF delta) over BENCH_MS,
 * and optional game-camera screenshots (?still).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = process.env.BENCH_URL ?? 'http://127.0.0.1:6010/perf/avatar-bench.html';
const counts = (process.env.BENCH_COUNTS ?? '8,32,64').split(',').map(Number);
const ms = Number(process.env.BENCH_MS ?? 8000);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 }, deviceScaleFactor: Number(process.env.BENCH_DPR ?? 1) });
page.on('pageerror', (e) => console.error('pageerror', e.message));
const results = [];
for (const n of counts) {
  await page.goto(`${base}?n=${n}${process.env.BENCH_QUERY ?? ''}`, { timeout: 180_000 });
  await page.waitForFunction(() => window.__bench?.ready && window.__berigameRender, null, { timeout: 120_000 });
  await page.waitForTimeout(3000);
  const frame = await page.evaluate((t) => window.__bench.frames(t), ms);
  const render = await page.evaluate(() => window.__berigameRender);
  const domNodes = await page.evaluate(() => document.querySelectorAll('*').length);
  results.push({ avatars: n, calls: render.calls, triangles: render.triangles, pixelRatio: render.pixelRatio, domNodes, frameMs: frame.interval, cpuFrameMs: frame.work, useFrameMs: frame.update, reactCommitMsPerSecond: frame.reactMsPerSecond, reactCommits: frame.reactCommits, skippedAnimatorUpdates: frame.skippedAnimatorUpdates });
  console.log(JSON.stringify(results.at(-1)));
  if (process.env.SHOTS) {
    await page.goto(`${base}?n=${n}&still`, { timeout: 180_000 });
    await page.waitForFunction(() => window.__bench?.ready, null, { timeout: 120_000 });
    await page.waitForTimeout(3000);
    fs.mkdirSync(process.env.SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(process.env.SHOTS, `avatars-${n}.png`), timeout: 180_000 });
  }
}
if (process.env.BENCH_OUT) fs.writeFileSync(process.env.BENCH_OUT, JSON.stringify({ createdAt: new Date().toISOString(), ms, results }, null, 2));
await browser.close();
