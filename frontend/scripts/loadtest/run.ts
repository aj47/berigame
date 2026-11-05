/**
 * BeriGame load test: N headless SDK clients against a SpacetimeDB server.
 *
 *   npm run loadtest -- --n 250 --mode interest --db berigame --seconds 60
 *
 * See docs/LOAD_TEST.md for the options, what is measured and the baselines.
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir, cpus, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TICK_MS } from '../../../shared/sim';
import type { FromWorker, SubscribeMode, WorkerConfig, WorkerResult } from './protocol';

const here = dirname(fileURLToPath(import.meta.url));

// ---- options --------------------------------------------------------------------------
function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split('=', 2);
    if (v !== undefined) out[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
    else out[k] = 'true';
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`usage: npm run loadtest -- [options]
  --n <count>            clients (default 50)
  --mode full|interest   subscription mode (default full; --subscribe is an alias)
  --db <name>            database (default berigame)
  --uri <ws url>         server (default ws://127.0.0.1:3000)
  --seconds <s>          measure window (default 60)
  --warmup <s>           settle time after everyone joined (default 10)
  --per-worker <count>   clients per worker process (default 125)
  --batch <count>        clients each worker connects at once (default 10)
  --batch-ms <ms>        pause between batches (default 500)
  --think <ms>           mean time between two actions of one client (default 2500)
  --compression gzip|none  (default gzip, like the browser)
  --view sdk|sink        interest mode: decode the nearby cells in each bot (sdk, default), or subscribe them on a
                         second connection per bot that only counts bytes (sink: the server's work is the same, the
                         load generator's is a fraction; bots then choose targets from static seeds and their
                         worker's own bots)
  --player-block <c>x<r> interest mode: player block of r chunks of c tiles around the centre chunk (default 16x2)
  --no-scatter           leave new characters in the Grove (default: move them to random Coast tiles via owner SQL)
  --fresh                new identities instead of reusing saved ones
  --tokens <file>        identity cache (default $TMPDIR/berigame-loadtest/<db>.tokens.json)
  --out <file>           JSON report (default scripts/loadtest/results/<time>-<mode>-<n>.json)
  --label <text>         note stored in the report`);
  process.exit(0);
}
const N = Number(args.n ?? 50);
const mode = (args.mode ?? args.subscribe ?? 'full') as SubscribeMode;
if (mode !== 'full' && mode !== 'interest') throw new Error(`--mode must be full or interest, not ${mode}`);
const DB = args.db ?? 'berigame';
const URI = args.uri ?? process.env.SPACETIME_URI ?? 'ws://127.0.0.1:3000';
const SECONDS = Number(args.seconds ?? 60);
const WARMUP = Number(args.warmup ?? 10);
const PER_WORKER = Number(args['per-worker'] ?? 125);
const BATCH = Number(args.batch ?? 10);
const BATCH_MS = Number(args['batch-ms'] ?? 500);
const THINK = Number(args.think ?? 2500);
const COMPRESSION = (args.compression ?? 'gzip') as 'gzip' | 'none';
const VIEW = (args.view ?? 'sdk') as 'sdk' | 'sink';
if (VIEW !== 'sdk' && VIEW !== 'sink') throw new Error(`--view must be sdk or sink, not ${VIEW}`);
const SCATTER = args['no-scatter'] === undefined;
const PLAYER_BLOCK = args['player-block'];
if (PLAYER_BLOCK !== undefined && !/^\d+x\d+$/.test(PLAYER_BLOCK)) throw new Error('--player-block wants <chunk>x<radius>, e.g. 16x2');
const TOKENS = args.tokens ?? join(tmpdir(), 'berigame-loadtest', `${DB}.tokens.json`);
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = args.out ?? join(here, 'results', `${stamp}-${mode}-${N}.json`);

// ---- identities ------------------------------------------------------------------------------
let tokens: string[] = [];
if (!args.fresh && existsSync(TOKENS)) tokens = JSON.parse(readFileSync(TOKENS, 'utf8'));
function saveTokens(): void {
  mkdirSync(dirname(TOKENS), { recursive: true });
  writeFileSync(TOKENS, JSON.stringify(tokens));
}

function ownerToken(): string {
  if (!SCATTER) return '';
  if (process.env.LOADTEST_OWNER_TOKEN) return process.env.LOADTEST_OWNER_TOKEN;
  try {
    const toml = readFileSync(join(homedir(), '.config', 'spacetime', 'cli.toml'), 'utf8');
    return /spacetimedb_token\s*=\s*"([^"]+)"/.exec(toml)?.[1] ?? '';
  } catch { return ''; }
}

// ---- server process sampling -------------------------------------------------------------------
function serverPid(): number | undefined {
  try {
    const out = execFileSync('pgrep', ['-f', 'spacetimedb-standalone start'], { encoding: 'utf8' }).trim().split('\n')[0];
    return out ? Number(out) : undefined;
  } catch { return undefined; }
}
function parseCpuTime(s: string): number {
  // ps time: [[dd-]hh:]mm:ss.cc
  const parts = s.trim().split(':').map(Number);
  let secs = 0;
  for (const p of parts) secs = secs * 60 + p;
  return secs;
}
interface ProcSample { at: number; cpuSec: number; rssKb: number }
function sampleProc(pid: number): ProcSample | undefined {
  try {
    const [time, rss] = execFileSync('ps', ['-o', 'time=,rss=', '-p', String(pid)], { encoding: 'utf8' }).trim().split(/\s+/);
    return { at: Date.now(), cpuSec: parseCpuTime(time), rssKb: Number(rss) };
  } catch { return undefined; }
}

// ---- stats ---------------------------------------------------------------------------------------
function pct(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

// ---- run -----------------------------------------------------------------------------------------
const children: ChildProcess[] = [];
function killAll(): void {
  for (const c of children) if (c.exitCode === null && !c.killed) { try { c.kill('SIGKILL'); } catch { /* gone */ } }
}
process.on('exit', killAll);
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { killAll(); process.exit(130); });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const workers = Math.max(1, Math.ceil(N / PER_WORKER));
  const owner = ownerToken();
  if (SCATTER && !owner) console.warn('no owner token found (~/.config/spacetime/cli.toml or LOADTEST_OWNER_TOKEN): characters stay in the Grove');
  console.log(`loadtest: ${N} clients, mode=${mode}${mode === 'interest' ? `, view=${VIEW}` : ''}, db=${DB}, ${workers} worker(s), measure ${SECONDS}s, think ${THINK}ms, scatter=${SCATTER && !!owner}`);

  const connectErrors: Record<string, number> = {};
  let connected = 0, failed = 0;
  const joinMs: number[] = [];
  const results: WorkerResult[] = [];
  let ready = 0;
  const t0 = Date.now();

  for (let w = 0; w < workers; w++) {
    const bots: WorkerConfig['bots'] = [];
    for (let i = w; i < N; i += workers) bots.push({ index: i, token: tokens[i] });
    const cfg: WorkerConfig = {
      worker: w, uri: URI, db: DB, mode, bots, batch: BATCH, batchMs: BATCH_MS, connectTimeoutMs: 45_000,
      thinkMs: THINK, ownerToken: owner, compression: COMPRESSION, playerBlock: PLAYER_BLOCK, view: VIEW, totalBots: N,
    };
    const child = spawn(process.execPath, ['--import', 'tsx', join(here, 'worker.ts')], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      env: { ...process.env, LOADTEST_CONFIG: JSON.stringify(cfg) },
      cwd: resolve(here, '../..'),
    });
    children.push(child);
    child.on('message', (m: FromWorker) => {
      if (m.type === 'connected') {
        if (m.ok) { connected++; joinMs.push(m.ms); if (m.token) tokens[m.index] = m.token; }
        else { failed++; connectErrors[m.error ?? '?'] = (connectErrors[m.error ?? '?'] ?? 0) + 1; }
        const n = connected + failed;
        if (n % 50 === 0 || n === N) console.log(`  joined ${connected}, failed ${failed} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
      } else if (m.type === 'ready') ready++;
      else if (m.type === 'result') results.push(m);
    });
    child.on('exit', (code) => { if (code) console.error(`worker ${w} exited with ${code}`); });
  }

  // Ramp: wait until every worker attempted all its clients (bounded).
  const rampDeadline = Date.now() + 60_000 + N * 200;
  while (ready < workers && Date.now() < rampDeadline && children.some((c) => c.exitCode === null)) await sleep(250);
  const rampSec = (Date.now() - t0) / 1000;
  saveTokens();
  console.log(`ramp done in ${rampSec.toFixed(0)}s: ${connected} connected, ${failed} failed; warming up ${WARMUP}s`);
  await sleep(WARMUP * 1000);

  const pid = serverPid();
  const procSamples: ProcSample[] = [];
  const sampler = setInterval(() => { if (pid) { const s = sampleProc(pid); if (s) procSamples.push(s); } }, 2_000);
  if (pid) { const s = sampleProc(pid); if (s) procSamples.push(s); }

  for (const c of children) c.connected && c.send({ type: 'measure' });
  console.log(`measuring for ${SECONDS}s...`);
  await sleep(SECONDS * 1000);
  if (pid) { const s = sampleProc(pid); if (s) procSamples.push(s); }
  clearInterval(sampler);
  const live = children.filter((c) => c.connected);
  for (const c of live) c.send({ type: 'stop' });
  const stopDeadline = Date.now() + 30_000;
  while (results.length < live.length && Date.now() < stopDeadline) await sleep(200);
  await sleep(2_000);
  killAll();

  if (!results.length) {
    console.error('no worker reported results (server down, or every client failed to join); see the errors above');
    process.exitCode = 1;
  }

  // ---- aggregate ----
  const measuredSec = results.length ? mean(results.map((r) => r.measuredMs)) / 1000 : SECONDS;
  const clients = results.flatMap((r) => r.clients);
  const per = (k: 'wireIn' | 'rawIn' | 'msgsIn' | 'wireOut') => clients.map((c) => c[k] / measuredSec);
  const wireIn = per('wireIn'), rawIn = per('rawIn'), msgsIn = per('msgsIn');
  const tickLag = results.flatMap((r) => r.tickLagMs);
  // Tick rate from the observer with the longest series.
  const series = results.map((r) => r.ticks).sort((a, b) => b.length - a.length)[0] ?? [];
  let tickRate = NaN;
  const intervals: number[] = [];
  if (series.length >= 2) {
    const [first, last] = [series[0], series[series.length - 1]];
    tickRate = (last[0] - first[0]) / ((last[2] - first[2]) / 1000);
    for (let i = 1; i < series.length; i++) {
      const dt = series[i][0] - series[i - 1][0];
      if (dt > 0) intervals.push((series[i][1] - series[i - 1][1]) / dt);
    }
  }
  // Lag over time (5 s buckets) and per worker: spikes on every worker at once point at the server,
  // spikes on one worker at the load generator.
  // Reduced, not spread: 2000 clients x 1.67 ticks/s x 45 s of samples overflow the call stack as arguments.
  const lagStart = results.flatMap((r) => r.tickLagAt).reduce((a, b) => Math.min(a, b), Infinity);
  const buckets: number[][] = [];
  for (const r of results) r.tickLagAt.forEach((at, i) => { (buckets[Math.floor((at - lagStart) / 5000)] ??= []).push(r.tickLagMs[i]); });
  const lagTimeline = [...buckets].map((b, i) => ({ fromSec: i * 5, p50: r1(pct(b ?? [], 50)), p95: r1(pct(b ?? [], 95)), max: r1(b?.length ? b.reduce((x, y) => Math.max(x, y), -Infinity) : NaN) }));
  const lagByWorker = results.map((r) => ({ worker: r.worker, p50: r1(pct(r.tickLagMs, 50)), p95: r1(pct(r.tickLagMs, 95)), loopDelayP95Ms: r1(r.loopDelayP95Ms), cpuCores: r2(r.cpuMs / r.measuredMs) }));
  const rtt: Record<string, { n: number; p50: number; p95: number }> = {};
  const allRtt: Record<string, number[]> = {};
  for (const r of results) for (const [k, v] of Object.entries(r.rttMs)) { const all = (allRtt[k] ??= []); for (const x of v) all.push(x); }
  for (const [k, v] of Object.entries(allRtt)) rtt[k] = { n: v.length, p50: r1(pct(v, 50)), p95: r1(pct(v, 95)) };
  const outcomes: Record<string, number> = {};
  for (const r of results) for (const [k, v] of Object.entries(r.outcomes)) outcomes[k] = (outcomes[k] ?? 0) + v;
  const moveEffect = results.flatMap((r) => r.moveEffectMs);
  const cpuCores = procSamples.length >= 2
    ? (procSamples[procSamples.length - 1].cpuSec - procSamples[0].cpuSec) / ((procSamples[procSamples.length - 1].at - procSamples[0].at) / 1000)
    : NaN;
  const coreSeries: number[] = [];
  for (let i = 1; i < procSamples.length; i++) coreSeries.push((procSamples[i].cpuSec - procSamples[i - 1].cpuSec) / ((procSamples[i].at - procSamples[i - 1].at) / 1000));
  const loadgenCpu = results.reduce((a, r) => a + r.cpuMs, 0) / 1000 / measuredSec;

  const report = {
    label: args.label ?? '',
    startedAt: new Date(t0).toISOString(),
    config: { n: N, mode, db: DB, uri: URI, seconds: SECONDS, warmup: WARMUP, workers, perWorker: PER_WORKER, batch: BATCH, batchMs: BATCH_MS, think: THINK, compression: COMPRESSION, scatter: SCATTER && !!owner, playerBlock: PLAYER_BLOCK ?? 'default', view: VIEW },
    machine: { cpus: cpus().length, model: cpus()[0]?.model, memGb: Math.round(totalmem() / 2 ** 30), node: process.version, platform: process.platform },
    connections: { requested: N, connected, failed, errors: connectErrors, rampSec: r1(rampSec), joinMsP50: r1(pct(joinMs, 50)), joinMsP95: r1(pct(joinMs, 95)), dropsDuringRun: results.reduce((a, r) => a + r.drops, 0), measuredClients: clients.length },
    tick: {
      targetPerSec: r2(1000 / TICK_MS),
      ratePerSec: r2(tickRate),
      rateVsTarget: r2((tickRate * TICK_MS) / 1000),
      intervalMsP50: r1(pct(intervals, 50)), intervalMsP95: r1(pct(intervals, 95)), intervalMsMax: r1(Math.max(...intervals)),
      lagMsP50: r1(pct(tickLag, 50)), lagMsP95: r1(pct(tickLag, 95)), lagMsP99: r1(pct(tickLag, 99)), lagSamples: tickLag.length,
      lagTimeline, lagByWorker,
    },
    perClientIn: {
      wireKBpsMean: r1(mean(wireIn) / 1024), wireKBpsP50: r1(pct(wireIn, 50) / 1024), wireKBpsP95: r1(pct(wireIn, 95) / 1024), wireKBpsMax: r1(Math.max(...wireIn) / 1024),
      rawKBpsMean: r1(mean(rawIn) / 1024), rawKBpsP95: r1(pct(rawIn, 95) / 1024),
      msgsPerSecMean: r1(mean(msgsIn)), msgsPerSecP95: r1(pct(msgsIn, 95)),
    },
    serverEgress: { wireMBps: r2(wireIn.reduce((a, b) => a + b, 0) / 2 ** 20), rawMBps: r2(rawIn.reduce((a, b) => a + b, 0) / 2 ** 20) },
    reducers: { rttMs: rtt, moveEffectMsP50: r1(pct(moveEffect, 50)), moveEffectMsP95: r1(pct(moveEffect, 95)), moveEffectSamples: moveEffect.length, outcomes },
    server: { pid, cpuCoresMean: r2(cpuCores), cpuCoresMax: r2(Math.max(...coreSeries)), rssMbMax: r1(Math.max(...procSamples.map((s) => s.rssKb)) / 1024), note: 'whole spacetimedb-standalone process (all databases on the server)' },
    loadgen: { cpuCores: r2(loadgenCpu), loopDelayP95Ms: r1(Math.max(...results.map((r) => r.loopDelayP95Ms))), resubscribes: results.reduce((a, r) => a + r.resubscribes, 0) },
    /** Row callbacks per second per observer client, by table and kind (one observer per worker, averaged). */
    observerRowsPerSec: (() => {
      const sum: Record<string, number> = {};
      for (const r of results) for (const [k, v] of Object.entries(r.rowEvents ?? {})) sum[k] = (sum[k] ?? 0) + v;
      const secs = Math.max(1, SECONDS) * Math.max(1, results.length);
      return Object.fromEntries(Object.entries(sum).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, r1(v / secs)]));
    })(),
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  const t = report.tick, c = report.connections, b = report.perClientIn;
  console.log(`
== ${mode} N=${N} (${clients.length} measured over ${measuredSec.toFixed(0)}s) ==
connections   ${c.connected}/${N} joined, ${c.failed} failed ${JSON.stringify(c.errors)}, ${c.dropsDuringRun} dropped during run; join p50/p95 ${c.joinMsP50}/${c.joinMsP95} ms
tick          ${t.ratePerSec}/s (target ${t.targetPerSec}/s, ${Math.round(t.rateVsTarget * 100)}%), interval p50/p95/max ${t.intervalMsP50}/${t.intervalMsP95}/${t.intervalMsMax} ms
tick lag      p50/p95/p99 ${t.lagMsP50}/${t.lagMsP95}/${t.lagMsP99} ms (world update arrival - tickStartedAt)
lag timeline  p95 per 5 s: ${t.lagTimeline.map((b) => b.p95).join(' ')}
lag by worker p95: ${t.lagByWorker.map((w) => `w${w.worker} ${w.p95}`).join(', ')}
per client in ${b.wireKBpsMean} KB/s mean, ${b.wireKBpsP95} p95, ${b.wireKBpsMax} max (wire); ${b.rawKBpsMean} KB/s decoded; ${b.msgsPerSecMean} msgs/s
server egress ${report.serverEgress.wireMBps} MB/s wire, ${report.serverEgress.rawMBps} MB/s decoded
reducer rtt   ${Object.entries(rtt).map(([k, v]) => `${k} ${v.p50}/${v.p95}`).join(', ')} ms (p50/p95)
move effect   p50/p95 ${report.reducers.moveEffectMsP50}/${report.reducers.moveEffectMsP95} ms (setTarget -> first own step)
server proc   ${report.server.cpuCoresMean} cores mean, ${report.server.cpuCoresMax} max, RSS ${report.server.rssMbMax} MB
load gen      ${report.loadgen.cpuCores} cores, event-loop delay p95 ${report.loadgen.loopDelayP95Ms} ms
report        ${OUT}`);
  const errs = Object.entries(outcomes).filter(([k]) => !k.endsWith(': ok')).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (errs.length) console.log('top reducer errors\n' + errs.map(([k, v]) => `  ${v}  ${k}`).join('\n'));
}

main().then(() => process.exit(0), (e) => { console.error(e); killAll(); process.exit(1); });
