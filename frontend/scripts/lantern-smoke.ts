/**
 * End-to-end Lanternmaw check against an isolated local SpacetimeDB with this
 * module published: closed by default, the owner switch and its announcement,
 * crafting Fen Bait, the entry rules (weapon, bait, coins), a two-player lobby
 * at the Fen Gate, the start (bait and fee spent, teleport, fight row), a fight
 * played on the shared simulation's hazard tiles (dodges, swings, the cap at
 * the surfacing tick, meals), the clear (fenlight, Fighting XP, eject), and the
 * owner close refund.
 *
 * Never point it at a shared world: it opens and closes Lanternmaw, teleports
 * the test characters and seeds items and coins through owner SQL. Use a fresh
 * database (the publisher's token drives the owner calls):
 *
 *   spacetime publish --server http://127.0.0.1:3177 --module-path spacetimedb --delete-data=never --yes lantern-e2e
 *   cd frontend && SPACETIME_URI=ws://127.0.0.1:3177 SPACETIME_DB=lantern-e2e \
 *     BOSS_CLI_CONFIG=<the publisher's cli.toml> npx tsx scripts/lantern-smoke.ts
 */
import { readFileSync } from 'node:fs';
import { Identity } from 'spacetimedb';
import { DbConnection, tables } from '../src/module_bindings';
import { playerView } from '../src/spacetime/playerView';
import type { BossEvent, BossNotice, Player } from '../src/module_bindings/types';
import {
  BossEventKind, BossId, BossNoticeKind, HOTBAR_SIZE, HurtSource, LANTERN_BAIT, LANTERN_MEALS, LANTERN_ENTRY_FEE, LANTERN_EXIT, LANTERN_GATE,
  LANTERN_RULES_VERSION, LANTERN_SPAWNS, LANTERN_SPRINGS, LanternStage, STONE_CLUB_ITEM_ID, SpireMemberState, SpireOutcome, SpireStage,
  TICK_MS, lanternHazardMask, lanternInCourt, lanternLocal, lanternMoves, lanternNearSpring, lanternTile, nodeCell, playerCell,
  type LanternFightLike, type Tile,
} from '../../shared/sim';
import { newProfile } from '../../shared/sim/frontier/model';

const URI = process.env.SPACETIME_URI ?? 'ws://127.0.0.1:3177';
const DB = process.env.SPACETIME_DB ?? 'lantern-e2e';
const HTTP = URI.replace(/^ws/, 'http');

function ownerToken(): string {
  if (process.env.BOSS_OWNER_TOKEN) return process.env.BOSS_OWNER_TOKEN;
  const path = process.env.BOSS_CLI_CONFIG;
  if (!path) throw new Error('Set BOSS_OWNER_TOKEN (or BOSS_CLI_CONFIG) to the publishing identity\'s token');
  const match = /spacetimedb_token\s*=\s*"([^"]+)"/.exec(readFileSync(path, 'utf8'));
  if (!match) throw new Error(`No spacetimedb_token in ${path}`);
  return match[1];
}

interface Client { name: string; conn: DbConnection; r: DbConnection['reducers']; identity: string; notices: BossNotice[]; events: BossEvent[] }

const SUBSCRIBE = [
  tables.world, tables.player, tables.playerPos, tables.groundItem, tables.inventorySlot, tables.adventureProfile,
  tables.lanternConfig, tables.lanternRun, tables.lanternMember, tables.lanternFight, tables.lanternReadiness, tables.bossEvent,
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function retrying<R extends object>(reducers: R): R {
  return new Proxy(reducers, {
    get(target, key) {
      const f = (target as any)[key];
      if (typeof f !== 'function') return f;
      return async (...args: unknown[]) => {
        for (let i = 0; ; i++) {
          try { return await f.apply(target, args); } catch (e: any) {
            if (i < 8 && /slow down/.test(String(e?.message ?? e))) { await sleep(TICK_MS); continue; }
            throw e;
          }
        }
      };
    },
  });
}
function connect(name: string, token?: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const notices: BossNotice[] = [], events: BossEvent[] = [];
    const timer = setTimeout(() => reject(new Error(`${name}: connect timeout`)), 10_000);
    DbConnection.builder().withUri(URI).withDatabaseName(DB).withToken(token)
      .onConnectError((_c, err) => { clearTimeout(timer); reject(err); })
      .onConnect((conn, identity) => {
        const me = identity.toHexString();
        conn.db.bossNotice.onInsert((_c, row) => { if (row.player.toHexString() === me) notices.push(row); });
        conn.db.bossEvent.onInsert((_c, row) => events.push(row));
        conn.subscriptionBuilder()
          .onApplied(() => { clearTimeout(timer); resolve({ name, conn, r: retrying(conn.reducers), identity: me, notices, events }); })
          .onError((ctx) => { clearTimeout(timer); reject((ctx as any).event ?? new Error(`${name}: subscribe failed`)); })
          .subscribe([...SUBSCRIBE, tables.bossNotice.where((row) => row.player.eq(identity))]);
      }).build();
  });
}
async function admittedToken(owner: Client): Promise<string> {
  const res = await fetch(`${HTTP}/v1/identity`, { method: 'POST' });
  if (!res.ok) throw new Error(`identity mint failed ${res.status}`);
  const { identity, token } = await res.json() as { identity: string; token: string };
  await owner.r.grantPlayer({ identity: Identity.fromString(identity), lifetimeSeconds: 7200, combat: true, chat: true });
  return token;
}
async function waitFor(label: string, pred: () => boolean, timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (pred()) return; await sleep(40); }
  throw new Error(`timeout waiting for: ${label}`);
}
async function rejection(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); return ''; } catch (e: any) { return String(e?.message ?? e); }
}
let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  (' + extra + ')' : ''}`);
  if (!ok) failures++;
}

const tick = (c: Client) => c.conn.db.world.id.find(0)?.tick ?? 0;
function me(c: Client): Player {
  for (const p of playerView(c.conn).iter()) if (p.identity.toHexString() === c.identity) return p;
  throw new Error(`${c.name}: own player row missing`);
}
const inv = (c: Client) => [...c.conn.db.inventorySlot.iter()].filter((r) => r.owner.toHexString() === c.identity);
const countOf = (c: Client, itemId: string) => inv(c).filter((r) => r.itemId === itemId).reduce((n, r) => n + r.quantity, 0);
const member = (c: Client) => [...c.conn.db.lanternMember.iter()].find((m) => m.identity.toHexString() === c.identity);
const runOf = (c: Client, id: bigint) => c.conn.db.lanternRun.id.find(id);
const fightOf = (c: Client, id: bigint) => c.conn.db.lanternFight.runId.find(id);
const fightingXp = (c: Client) => c.conn.db.adventureProfile.identity.find(me(c).identity)?.fightingXp ?? 0;

async function sql(token: string, query: string): Promise<any> {
  const res = await fetch(`${HTTP}/v1/database/${DB}/sql`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: query });
  if (!res.ok) throw new Error(`sql failed ${res.status}: ${await res.text()}`);
  return res.json();
}
async function seedGround(token: string, owner: string, at: Tile, marker: number, items: [string, number][]): Promise<void> {
  for (const [itemId, quantity] of items) {
    await sql(token, `INSERT INTO ground_item (id, item_id, quantity, x, z, dropped_by, dropped_tick, expires_tick, dropped_on_death, cell) `
      + `VALUES (0, '${itemId}', ${quantity}, ${at.x}, ${at.z}, 0x${owner}, ${marker}, 4000000000, false, ${nodeCell(at.x, at.z)})`);
  }
}
async function pickUpAll(c: Client, marker: number, itemIds: string[]): Promise<void> {
  for (const itemId of itemIds) {
    const before = countOf(c, itemId);
    const item = [...c.conn.db.groundItem.iter()].find((g) => g.itemId === itemId && g.droppedTick === marker);
    if (!item) throw new Error(`${c.name}: no ${itemId} on the ground nearby`);
    await c.r.pickupItem({ id: item.id });
    await waitFor(`${c.name} picks up ${itemId}`, () => countOf(c, itemId) > before, 15_000);
  }
}
/** Owner SQL: puts a character on a tile (the player row and its live player_pos row, with its interest cell). */
async function teleport(token: string, c: Client, t: Tile): Promise<void> {
  await sql(token, `UPDATE player SET x = ${t.x}, z = ${t.z} WHERE identity = 0x${c.identity}`);
  await sql(token, `UPDATE player_pos SET x = ${t.x}, z = ${t.z}, cell = ${playerCell('bramblewild', t.x, t.z)} WHERE identity = 0x${c.identity}`);
  await waitFor(`${c.name} at ${t.x},${t.z}`, () => me(c).x === t.x && me(c).z === t.z);
}
/** Owner SQL: a frontier profile with `coins` (fresh test identities only: it replaces the profile). */
async function setCoins(token: string, c: Client, coins: number): Promise<void> {
  const key = `profile:${c.identity}`;
  await sql(token, `DELETE FROM frontier_private WHERE key = '${key}'`);
  await sql(token, `INSERT INTO frontier_private (key, kind, data) VALUES ('${key}', 'profile', '${JSON.stringify({ ...newProfile(c.identity), coins })}')`);
}
async function coinsOf(token: string, c: Client): Promise<number> {
  const out = await sql(token, `SELECT data FROM frontier_private WHERE key = 'profile:${c.identity}'`);
  const row = out?.[0]?.rows?.[0];
  return row ? JSON.parse(row[0]).coins : 0;
}
async function wield(c: Client, itemId: string): Promise<void> {
  let row = inv(c).find((r) => r.itemId === itemId)!;
  if (row.slot >= HOTBAR_SIZE) {
    const free = [0, 1, 2].find((s) => !inv(c).some((r) => r.slot === s)) ?? 0;
    await c.r.moveItem({ from: row.slot, to: free });
    await waitFor(`${itemId} in the quick bar`, () => inv(c).some((r) => r.itemId === itemId && r.slot === free));
    row = inv(c).find((r) => r.itemId === itemId)!;
  }
  await c.r.wieldItem({ slot: row.slot });
  await waitFor(`${c.name} wields ${itemId}`, () => me(c).weapon === itemId);
}

/** Depth-3 lookahead over the published hazards: a move that keeps a hit-free path for the next 3 ticks, if any. */
function safeMoves(f: LanternFightLike, startTick: number, T: number, from: number): number[] {
  const masks = [0, 1, 2].map((k) => lanternHazardMask(f, T + k, startTick));
  const ok = (i: number, k: number): boolean => !masks[k][i] && (k === 2 || lanternMoves(i).some((j) => ok(j, k + 1)));
  const safe = lanternMoves(from).filter((i) => ok(i, 0));
  return safe.length ? safe : lanternMoves(from).filter((i) => !masks[0][i]);
}
function chooseMove(f: LanternFightLike, startTick: number, T: number, from: number, capper: boolean): number {
  const moves = safeMoves(f, startTick, T, from);
  if (!moves.length) return from;
  const spring = LANTERN_SPRINGS[f.spring];
  const toward = (goal: (i: number) => boolean, target: number) => moves.find(goal)
    ?? moves.slice().sort((a, b) => Math.max(Math.abs((a % 15) - (target % 15)), Math.abs(Math.floor(a / 15) - Math.floor(target / 15)))
      - Math.max(Math.abs((b % 15) - (target % 15)), Math.abs(Math.floor(b / 15) - Math.floor(target / 15))))[0];
  if (f.stage === LanternStage.Dive && capper) return toward((i) => i === spring, spring);
  if (f.stage === LanternStage.Tide) return toward((i) => lanternNearSpring(i, f.spring), spring);
  if (f.stage === LanternStage.Den) return toward((i) => lanternInCourt(i), 112);
  return moves[0];
}

async function main() {
  const token = ownerToken();
  const owner = await connect('owner', token);
  const A = await connect('A', await admittedToken(owner));
  const B = await connect('B', await admittedToken(owner));
  await waitFor('a running world', () => tick(A) > 0);
  await A.r.setName({ name: `Fen${A.identity.slice(-4)}` });
  await B.r.setName({ name: `Mire${B.identity.slice(-4)}` });
  const cfg = (open: boolean) => ({ lanternOpen: open, lanternMaxRuns: 12, lanternHpBase: 810, lanternHpPerMember: 970 });

  // ---- Closed by default ----------------------------------------------------------------------------------------
  if ([...owner.conn.db.lanternConfig.iter()].some((r) => r.lanternOpen)) await owner.r.configureLanternmaw(cfg(false));
  check('lantern_open is refused while sealed', /sealed/.test(await rejection(() => A.r.lanternOpen({ clientRules: LANTERN_RULES_VERSION }))));
  check('configure_lanternmaw is owner-only', /owner required/.test(await rejection(() => A.r.configureLanternmaw(cfg(true)))));

  // ---- Kit: a stone club, bait inputs, food; coins; at the Fen Gate ---------------------------------------------
  const markers = new Map([[A, 1_000_000_000 + Math.floor(Math.random() * 1e9)], [B, 3_000_000_000 + Math.floor(Math.random() * 1e9)]]);
  for (const c of [A, B]) {
    await teleport(token, c, LANTERN_EXIT);
    await seedGround(token, owner.identity, LANTERN_EXIT, markers.get(c)!, [[STONE_CLUB_ITEM_ID, 1], ['gleamshell', 2], ['obsidian', 2], ['driftwood', 4], ['berry_goldberry', 10]]);
  }
  await waitFor('seeded items arrive', () => [...A.conn.db.groundItem.iter()].filter((g) => g.droppedTick === markers.get(B)).length >= 5);
  for (const c of [A, B]) {
    await pickUpAll(c, markers.get(c)!, [STONE_CLUB_ITEM_ID, 'gleamshell', 'obsidian', 'driftwood', 'berry_goldberry']);
    await setCoins(token, c, 12);
  }
  check('Fen Bait cannot be crafted while sealed', /only be made while the Drowned Hollow is open/.test(await rejection(() => A.r.craft({ recipe: LANTERN_BAIT.itemId }))));
  await owner.r.configureLanternmaw(cfg(true));
  await waitFor('LanternOpened announced', () => A.events.some((e) => e.boss === BossId.Lanternmaw && e.kind === BossEventKind.LanternOpened));
  check('opening announces it world-wide', true);
  check('no bait: refused', /Fen Bait/.test(await rejection(() => A.r.lanternOpen({ clientRules: LANTERN_RULES_VERSION }))));
  for (const c of [A, B]) {
    await c.r.craft({ recipe: LANTERN_BAIT.itemId });
    await waitFor(`${c.name} crafts Fen Bait`, () => countOf(c, LANTERN_BAIT.itemId) === 1);
    await wield(c, STONE_CLUB_ITEM_ID);
  }
  check('Fen Bait crafts from 1 gleamshell + 1 obsidian + 2 driftwood', [A, B].every((c) => countOf(c, 'gleamshell') === 1 && countOf(c, 'driftwood') === 2));

  // ---- Lobby and start ------------------------------------------------------------------------------------------
  await A.r.lanternOpen({ clientRules: LANTERN_RULES_VERSION });
  await waitFor('A leads a lobby', () => member(A)?.state === SpireMemberState.Lobby);
  const runId = member(A)!.runId;
  await B.r.lanternJoin({ runId: 0n, clientRules: LANTERN_RULES_VERSION });
  await waitFor('B quick-joins', () => member(B)?.runId === runId);
  check('quick join fills slot 1', member(B)!.slot === 1);
  check('a party start waits for the ready check', /send ready/.test(await rejection(() => A.r.lanternStart({ clientRules: LANTERN_RULES_VERSION }))));
  await B.r.lanternReady({});
  await waitFor('B is ready', () => [...A.conn.db.lanternReadiness.iter()].some((r) => r.identity.toHexString() === B.identity));
  await A.r.lanternStart({ clientRules: LANTERN_RULES_VERSION });
  await waitFor('the run starts', () => runOf(A, runId)?.stage === SpireStage.Active && !!fightOf(A, runId));
  const run = runOf(A, runId)!;
  check('bait spent and fee debited', countOf(A, LANTERN_BAIT.itemId) === 0 && (await coinsOf(token, A)) === 12 - LANTERN_ENTRY_FEE && (await coinsOf(token, B)) === 12 - LANTERN_ENTRY_FEE);
  check('both teleported to their spawns', lanternLocal(me(A)) === LANTERN_SPAWNS[0] && lanternLocal(me(B)) === LANTERN_SPAWNS[1]);
  check('the fight row starts at 1780 HP', fightOf(A, runId)!.hp === 1780 && fightOf(A, runId)!.maxHp === 1780);
  check('LanternRunStart announced', A.events.some((e) => e.kind === BossEventKind.LanternRunStart && e.runId === runId));

  // ---- The fight ------------------------------------------------------------------------------------------------
  // Short enough for a smoke test: 12% HP left. A caps the spring each dive, B swings; both dodge on the shared hazard tiles.
  await owner.r.bossDebug({ op: 'lantern_hp', runId, value: 12 });
  let last = tick(A), cleared = false, sawTide = false;
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    await waitFor('the next tick', () => tick(A) > last, 5_000);
    last = tick(A);
    const r = runOf(A, runId);
    if (!r || r.stage !== SpireStage.Active) { cleared = r?.stage === SpireStage.Cleared; break; }
    const f = fightOf(A, runId) as unknown as LanternFightLike;
    if (f.stage === LanternStage.Tide) sawTide = true;
    for (const c of [A, B]) {
      if (member(c)?.state !== SpireMemberState.In) continue;
      const p = me(c), from = lanternLocal(p);
      if (from < 0) continue;
      if (p.hp < 16 && (member(c)?.meals ?? 0) < LANTERN_MEALS && p.eatCooldownUntilTick <= last) {
        const berry = inv(c).find((x) => x.itemId === 'berry_goldberry');
        if (berry) c.r.eatBerry({ slot: berry.slot }).catch(() => {});
      }
      const to = chooseMove(f, run.startTick, last + 1, from, c === A);
      if (to !== from) { const t = lanternTile(to); c.r.setTarget({ x: t.x, z: t.z }).catch(() => {}); }
    }
  }
  const outcome = runOf(A, runId)?.outcome;
  check('the run ends in a clear', cleared, `outcome=${outcome} sawTide=${sawTide}`);
  const hurtSources = new Set([...A.notices, ...B.notices].filter((n) => n.kind === BossNoticeKind.Hurt).map((n) => n.quantity));
  console.log(`      hurt sources seen: ${[...hurtSources].map((q) => Object.entries(HurtSource).find(([, v]) => v === q)?.[0]).join(', ') || 'none'}`);
  if (cleared) {
    await waitFor('rewards arrive', () => countOf(A, 'fenlight') + countOf(B, 'fenlight') > 0, 5_000).catch(() => {});
    const f = fightOf(A, runId)!;
    for (const [c, dealt] of [[A, f.dmg0], [B, f.dmg1]] as const) {
      const paid = dealt >= 40;
      check(`${c.name}: ${dealt} damage dealt, ${paid ? '2 fenlight and 120 Fighting XP' : 'no reward (under 40)'}`,
        countOf(c, 'fenlight') === (paid ? 2 : 0) && fightingXp(c) === (paid ? 120 : 0));
      check(`${c.name} ejected to the Fen Gate`, Math.max(Math.abs(me(c).x - LANTERN_GATE.x), Math.abs(me(c).z - LANTERN_GATE.z)) <= 1);
    }
    check('LanternClear announced', A.events.some((e) => e.kind === BossEventKind.LanternClear && e.runId === runId));
  }

  // ---- The owner close refunds ----------------------------------------------------------------------------------
  await waitFor('the old run is cleaned up', () => !runOf(A, runId), 20_000);
  await A.r.craft({ recipe: LANTERN_BAIT.itemId });
  await waitFor('A crafts another bait', () => countOf(A, LANTERN_BAIT.itemId) === 1);
  await setCoins(token, A, 5);
  await A.r.lanternOpen({ clientRules: LANTERN_RULES_VERSION });
  await waitFor('A leads a lobby again', () => member(A)?.state === SpireMemberState.Lobby);
  const solo = member(A)!.runId;
  // A live HP change (no deploy): the next run uses it.
  await owner.r.configureLanternmaw({ lanternOpen: true, lanternMaxRuns: 12, lanternHpBase: 600, lanternHpPerMember: 700 });
  await waitFor('the new HP knobs land', () => [...A.conn.db.lanternConfig.iter()].some((r) => r.lanternHpBase === 600));
  await A.r.lanternStart({ clientRules: LANTERN_RULES_VERSION });
  await waitFor('the solo run starts', () => runOf(A, solo)?.stage === SpireStage.Active && !!fightOf(A, solo));
  check('configure_lanternmaw changed the next run\'s HP live (600 solo)', fightOf(A, solo)!.maxHp === 600, `maxHp ${fightOf(A, solo)!.maxHp}`);
  await owner.r.configureLanternmaw(cfg(false));
  await waitFor('the close fails the run', () => runOf(A, solo)?.stage === SpireStage.Failed);
  check('the owner close refunds bait and fee', runOf(A, solo)!.outcome === SpireOutcome.Closed && countOf(A, LANTERN_BAIT.itemId) === 1 && (await coinsOf(token, A)) === 5);
  check('sealed again', /sealed/.test(await rejection(() => B.r.lanternOpen({ clientRules: LANTERN_RULES_VERSION }))));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll Lanternmaw checks passed');
  for (const c of [owner, A, B]) c.conn.disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
