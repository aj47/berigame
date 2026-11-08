/**
 * Lanternmaw over the agent HTTP API, end to end: a running Node gateway (`npm run agent:serve`) in front of an
 * isolated local SpacetimeDB with this module. One agent session moves (including the move onto the Fen Gate
 * tile that used to crash with "Do not know how to serialize a BigInt"), crafts Fen Bait, wields, opens and
 * starts a solo run, reads /state and /danger and dodges every tick, then leaves.
 *
 * Owner SQL seeds the kit, coins and the position: never point it at a shared world.
 *
 *   AGENT_BASE=http://127.0.0.1:3931/api/agent/v1 AGENT_INVITE=<code from agent:invite --combat> \
 *     SPACETIME_HTTP=http://127.0.0.1:3917 SPACETIME_DB=lantern-http BOSS_CLI_CONFIG=<publisher cli.toml> \
 *     npx tsx scripts/lantern-http-smoke.ts
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { LANTERN_BAIT, LANTERN_EXIT, LANTERN_GATE, lanternTile, LANTERN_SPAWNS, nodeCell, playerCell, type Tile } from '../../shared/sim';
import { newProfile } from '../../shared/sim/frontier/model';

const BASE = process.env.AGENT_BASE ?? 'http://127.0.0.1:3931/api/agent/v1';
const HTTP = process.env.SPACETIME_HTTP ?? 'http://127.0.0.1:3917';
const DB = process.env.SPACETIME_DB ?? 'lantern-http';
const ownerToken = (() => {
  if (process.env.BOSS_OWNER_TOKEN) return process.env.BOSS_OWNER_TOKEN;
  const m = /spacetimedb_token\s*=\s*"([^"]+)"/.exec(readFileSync(process.env.BOSS_CLI_CONFIG ?? '', 'utf8'));
  if (!m) throw new Error('Set BOSS_OWNER_TOKEN or BOSS_CLI_CONFIG');
  return m[1];
})();

let failures = 0, requests = 0;
const statusCounts: Record<string, number> = {};
function check(label: string, ok: boolean, extra = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  (' + extra + ')' : ''}`);
  if (!ok) failures++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(path: string, token: string, body?: unknown): Promise<{ status: number; json: any }> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(BASE + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    requests++;
    const json = await res.json().catch(() => null);
    if (res.status === 429 && attempt < 10) { await sleep(Number(res.headers.get('Retry-After') ?? 1) * 1000); continue; }
    statusCounts[res.status] = (statusCounts[res.status] ?? 0) + 1;
    return { status: res.status, json };
  }
}
async function sql(query: string): Promise<any> {
  const res = await fetch(`${HTTP}/v1/database/${DB}/sql`, { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: query });
  if (!res.ok) throw new Error(`sql failed ${res.status}: ${await res.text()}`);
  return res.json();
}
async function call(reducer: string, args: unknown[]): Promise<void> {
  const res = await fetch(`${HTTP}/v1/database/${DB}/call/${reducer}`, { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  if (!res.ok) throw new Error(`call ${reducer} failed ${res.status}: ${await res.text()}`);
}
async function teleport(hex: string, t: Tile): Promise<void> {
  await sql(`UPDATE player SET x = ${t.x}, z = ${t.z}, target_x = NONE, target_z = NONE WHERE identity = 0x${hex}`).catch(async () => sql(`UPDATE player SET x = ${t.x}, z = ${t.z} WHERE identity = 0x${hex}`));
  await sql(`UPDATE player_pos SET x = ${t.x}, z = ${t.z}, cell = ${playerCell('bramblewild', t.x, t.z)} WHERE identity = 0x${hex}`);
}

async function main() {
  const invite = process.env.AGENT_INVITE;
  if (!invite) throw new Error('Set AGENT_INVITE');
  const session = await fetch(`${BASE}/sessions`, { method: 'POST', headers: { Authorization: `Bearer ${invite}`, 'Content-Type': 'application/json' }, body: '{}' });
  check('session created', session.status === 201, String(session.status));
  const { token } = await session.json() as { token: string };
  let state = (await api('/state', token)).json;
  const hex: string = state.player.id;
  await api('/actions/name', token, { name: `Http${hex.slice(-4)}` });

  // Kit at the Fen Gate exit: a stone club, bait inputs, food; coins.
  await teleport(hex, LANTERN_EXIT);
  const marker = 2_000_000_000 + Math.floor(Math.random() * 1e8);
  for (const [itemId, quantity] of [['stone_club', 1], ['gleamshell', 1], ['obsidian', 1], ['driftwood', 2], ['berry_goldberry', 8]] as const) {
    await sql(`INSERT INTO ground_item (id, item_id, quantity, x, z, dropped_by, dropped_tick, expires_tick, dropped_on_death, cell) VALUES (0, '${itemId}', ${quantity}, ${LANTERN_EXIT.x}, ${LANTERN_EXIT.z}, 0x${hex}, ${marker}, 4000000000, false, ${nodeCell(LANTERN_EXIT.x, LANTERN_EXIT.z)})`);
  }
  await sql(`DELETE FROM frontier_private WHERE key = 'profile:${hex}'`);
  await sql(`INSERT INTO frontier_private (key, kind, data) VALUES ('profile:${hex}', 'profile', '${JSON.stringify({ ...newProfile(hex), coins: 10 })}')`);
  await call('configure_lanternmaw', [true, 12, 810, 970]);
  await sleep(1500);
  state = (await api('/state', token)).json;
  for (const g of state.groundItems ?? []) if (g.droppedTick === marker || g.id) await api('/actions/pickup', token, { id: String(g.id) });
  await sleep(1500);

  // Moves, including the one that used to crash: onto the (blocked) Fen Gate tile, where no tile is nearer than yours.
  for (const [label, to] of [['onto the Fen Gate tile', LANTERN_GATE], ['into the strait', { x: 52, z: 140 }], ['onto the Hollow floor', lanternTile(LANTERN_SPAWNS[0])], ['back to the exit', LANTERN_EXIT]] as const) {
    const r = await api('/actions/move', token, to);
    check(`move ${label} answers 200 with a plain destination`, r.status === 200 && (r.json.destination === undefined || Object.keys(r.json.destination).sort().join() === 'x,z'),
      `${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
    await sleep(700);
  }
  await teleport(hex, LANTERN_EXIT);
  await sleep(700);

  const crafted = await api('/actions/craft', token, { recipe: LANTERN_BAIT.itemId });
  check('craft fen_bait', crafted.status === 200, `${crafted.status} ${JSON.stringify(crafted.json).slice(0, 120)}`);
  await sleep(700);
  state = (await api('/state', token)).json;
  const club = (state.inventory ?? []).find((s: any) => s?.itemId === 'stone_club');
  check('state.lantern shows the full entry block at the gate', state.lantern?.open === true && !!state.lantern?.entry, JSON.stringify(state.lantern?.entry?.problem ?? null));

  const opened = await api('/actions/lantern', token, { op: 'open' });
  check('lantern open returns a string runId', opened.status === 200 && typeof opened.json.runId === 'string', `${opened.status} ${JSON.stringify(opened.json).slice(0, 120)}`);
  const solo = await api('/actions/lantern', token, { op: 'ready' });
  check('lantern ready answers 200 in a lobby', solo.status === 200 && solo.json.ready === true, `${solo.status} ${JSON.stringify(solo.json).slice(0, 120)}`);
  const started = await api('/actions/lantern', token, { op: 'start' });
  check('lantern start', started.status === 200 && started.json.stage === 'active', `${started.status} ${JSON.stringify(started.json).slice(0, 160)}`);
  await sleep(700);
  state = (await api('/state', token)).json;
  check('the start drew the club from the bag', state.player?.weapon?.itemId === 'stone_club' || (state.notices ?? []).some((n: any) => n.kind === 'wielded'),
    `weapon=${state.player?.weapon?.itemId} clubSlot was ${club?.slot}`);
  check('the water stills before the fight', state.lantern?.run?.fightStage === 'still', String(state.lantern?.run?.fightStage));

  // Dodge every tick for about 45 ticks through /danger, eating when low.
  let dodges = 0, stages = new Set<string>(), lastTick = -1, spring = false;
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    const d = await api('/danger', token);
    if (d.status !== 200) { check('/danger answers 200', false, String(d.status)); break; }
    const f = d.json;
    if (f.where !== 'lantern') break;
    stages.add(f.boss?.stage);
    if (f.spring) spring = spring || !!f.spring.tile;
    if (f.tick !== lastTick) {
      lastTick = f.tick;
      // best / moves[] are { to: [x, z], via: [x, z] } (DangerXZ is an [x, z] pair).
      const pick = (f.best ?? f.moves?.[0])?.to;
      const to = Array.isArray(pick) ? { x: pick[0], z: pick[1] } : null;
      if (to) { const r = await api('/actions/dodge', token, to); if (r.status === 200) dodges++; }
      if (f.you?.hp !== undefined && f.you.hp < 14) {
        const s = (await api('/state', token)).json;
        const berry = (s.inventory ?? []).find((x: any) => x?.itemId === 'berry_goldberry');
        if (berry) await api('/actions/eat', token, { slot: berry.slot });
      }
    }
    await sleep(250);
  }
  state = (await api('/state', token)).json;
  check('/danger and dodge ran through the fight', dodges > 20, `${dodges} dodges, stages ${[...stages].join('/')}${spring ? ', spring.tile seen' : ''}`);
  check('/state answers with lantern rows present', !!state.lantern, `fightStage ${state.lantern?.run?.fightStage}`);
  const left = await api('/actions/lantern', token, { op: 'leave' });
  check('lantern leave', left.status === 200, `${left.status} ${JSON.stringify(left.json).slice(0, 120)}`);
  await call('configure_lanternmaw', [false, 12, 810, 970]);
  check('no 5xx over the whole run', !Object.keys(statusCounts).some((s) => Number(s) >= 500), JSON.stringify(statusCounts));
  console.log(`${requests} requests`);
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll Lanternmaw HTTP checks passed');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
