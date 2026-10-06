/**
 * The compact danger feed (FINAL_SPEC 8.3; CORE_SCOPE: no long poll, no
 * downed state, no practice): the agent gateway's GET /danger, WebMCP's
 * inspect_danger and the browser overlay share it.
 *
 * Pure: everything comes from the persistent rows (`spire_run`, `spire_fight`,
 * `spire_member`, `clatterhorn`) and the reader's own player. The Spire's
 * survival table is built once per pattern rotation (`spireSafetyCached`).
 */
import { CLATTER_GLADE, CLATTER_STONES, SPIRE_FLOOR, inSpireFloor, spireStandable } from './bossZones';
import { BulletGrid, movesWithin, type BulletMove } from './bullets';
import {
  CLATTER_REACH, ClatterState, clatterHitsMove, clatterSwarmFreeLines, clatterTelegraph,
  identityKey32, type ClatterRowLike, type ClatterTelegraph,
} from './clatterhorn';
import { GRID_SIZE } from './constants';
import { LAND_MASK } from './grid';
import {
  SPIRE_BOSS_NAME, SPIRE_BOX, SPIRE_ENRAGE_TICKS, SPIRE_IFRAME_TICKS, SPIRE_INTRO_TICKS, SPIRE_MAX_PARTY, SPIRE_MEALS,
  SPIRE_PATTERNS, SPIRE_PHASE_NAMES, SPIRE_STAR_PERIOD, SpireMemberState, SpireStage, inSpireCourt, spireEnraged,
  spireFightBullets, spireKnownUntil, spireSafety, spireSlot, spireStarWave, spireStars,
  type SpireFightLike, type SpireRunLike, type SpireSafety,
} from './spire';
import type { Tile } from './types';

export interface DangerMemberInput {
  slot: number;
  state: number;
  awaySinceTick: number;
  meals: number;
  name: string;
  player: { identity: string; x: number; z: number; hp: number } | null;
}

export interface DangerInput {
  tick: number;
  tickMs: number;
  /** ms since this tick reached the reader. */
  ageMs: number;
  /** SPIRE_RULES_VERSION of the reader's bundle. */
  rulesVersion: number;
  me: { identity: string; x: number; z: number; hp: number; maxHp: number; eatCooldownUntilTick: number };
  /** The world's blocked set (pass a stable instance: move tables are cached per Set). */
  blocked: Set<number>;
  /**
   * Tiles you move per tick (default 2): 1 while you carry the giant berry (`cargoMovementSteps`). Clatterhorn's
   * moves, best and escapes keep to it; the Spire refuses carriers, so its feed always uses 2.
   */
  maxSteps?: 1 | 2;
  /** Your run (any stage) while you have a member row; the gateway passes null otherwise. */
  spire?: { run: SpireRunLike; fight: SpireFightLike; members: readonly DangerMemberInput[]; mySlot: number; safety: SpireSafety | null } | null;
  /** The Clatterhorn row (null outside Bramblewild). */
  clatter?: ClatterRowLike | null;
}

export type DangerXZ = [number, number];

export interface DangerMove {
  to: DangerXZ;
  /** The canonical middle tile (equals `to` for 0- and 1-step moves). */
  via: DangerXZ;
  steps: 0 | 1 | 2;
  /** 1..3: the largest k with a hit-free continuation through tick + k. */
  horizon: number;
  winning: boolean;
  star: boolean;
  court: boolean;
}

export interface DangerTelegraph {
  attack: 'charge' | 'spin' | 'drum';
  landsInTicks: number;
  damage: number;
  end: 'flip' | 'glance' | 'skid' | null;
  /** Charge only: your full player id when you are the target, else the last 8 hex digits of the target's id. */
  bait: string | null;
  tiles: DangerXZ[];
  youAreInside: boolean;
  escape: DangerXZ[];
}

/** The exact JSON of GET /api/agent/v1/danger. */
export interface DangerFeed {
  v: 1;
  tick: number;
  tickMs: number;
  ageMs: number;
  /** max(0, tickMs - ageMs - 120): send a dodge by then to land in tick + 1. */
  sendWithinMs: number;
  rulesVersion: number;
  /** Your run's rules differ from this reader's bundle: map, moves and path are omitted. */
  rulesMismatch: boolean;
  where: 'spire' | 'clatterhorn' | null;
  you: { x: number; z: number; hp: number; maxHp: number; state: string | null; immuneTicks: number; eatReadyInTicks: number; mealsLeft: number | null };
  grid?: { x0: number; z0: number; w: number; h: number };
  /** h strings of w chars: '.' safe at +1..+3, '1'..'7' bitmask of unsafe ticks, '#' not standable, '*' a live star on a safe tile. */
  map?: string[];
  moves: DangerMove[];
  best: { to: DangerXZ; via: DangerXZ } | null;
  /** Your end tile for tick + 1, tick + 2, ... (<= 16). */
  path: DangerXZ[];
  knownUntilTick: number | null;
  stars?: { x: number; z: number; ticksLeft: number }[];
  nextStars?: { inTicks: number };
  boss?: { name: string; hp: number; maxHp: number; phase: number; phaseName: string; pattern: string | null; enraged: boolean; enrageInTicks: number; timeoutInTicks: number };
  party?: { id: string; name: string; x: number | null; z: number | null; hp: number | null; state: string; stars: number; away: boolean }[];
  telegraph: DangerTelegraph | null;
}

/** `moves` is truncated first, then `path`. */
export const DANGER_FEED_MAX_BYTES = 4096;
/** Most moves listed (best first). */
export const DANGER_MAX_MOVES = 12;
/** Longest survival path. */
export const DANGER_MAX_PATH = 16;
/** Look-ahead of `horizon` and of the map digits. */
export const DANGER_HORIZON = 3;
/** Network margin of `sendWithinMs`. */
export const DANGER_SEND_MARGIN_MS = 120;

/** Names by enum value (index = SpireStage / SpireMemberState / SpireOutcome). */
export const SPIRE_STAGE_NAMES: readonly string[] = ['lobby', 'queued', 'active', 'cleared', 'failed'];
export const SPIRE_MEMBER_STATE_NAMES: readonly string[] = ['lobby', 'in', 'downed', 'out', 'left', 'done'];
export const SPIRE_OUTCOME_NAMES: readonly string[] = ['none', 'cleared', 'wiped', 'timed_out', 'abandoned', 'closed', 'reset'];
/** Index = ClatterEndKind. */
export const CLATTER_END_NAMES: readonly ('flip' | 'glance' | 'skid' | null)[] = [null, 'skid', 'glance', 'flip'];
/** Index = CLATTER_DIR8 (Facing order). */
export const CLATTER_DIR_NAMES: readonly string[] = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'];

const key = (x: number, z: number) => z * GRID_SIZE + x;
const xz = (t: Tile): DangerXZ => [t.x, t.z];
const unkey = (k: number): DangerXZ => [k % GRID_SIZE, Math.floor(k / GRID_SIZE)];
const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

// ---- Stars ---------------------------------------------------------------------------------------------------------

export interface SpireLiveStars {
  wave: number;
  /** Uncaught stars of the wave (j = index in the wave, the starMask bit). */
  stars: { x: number; z: number; j: number }[];
  /** The last tick this wave's stars can be caught. */
  lastTick: number;
  /** The tick the next wave lands (it may be past the run's end). */
  nextTick: number;
}

/** The stars a present In member can catch in tick T (null outside an Active run's fight window). */
export function spireLiveStars(run: SpireRunLike, f: SpireFightLike, T: number): SpireLiveStars | null {
  if (run.stage !== SpireStage.Active || T < run.startTick || T >= run.endTick) return null;
  const wave = spireStarWave(run.startTick, T);
  const K = Math.max(1, Math.min(SPIRE_MAX_PARTY, run.partySize)) + 2;
  const mask = f.starWave === wave ? f.starMask : 0;
  const stars = spireStars(f.seed, wave, K).map((t, j) => ({ x: t.x, z: t.z, j })).filter((s) => ((mask >>> s.j) & 1) === 0);
  const nextTick = run.startTick + (wave + 1) * SPIRE_STAR_PERIOD;
  return { wave, stars, lastTick: Math.min(nextTick, run.endTick) - 1, nextTick };
}

// ---- Move tables ---------------------------------------------------------------------------------------------------

type Standable = (t: Tile) => boolean;
interface MoveTable { standable: Standable; at(t: Tile): BulletMove[] }

/** Moves of at most `maxSteps` steps from each standable tile, memoized per tile. */
function moveTable(standable: Standable, maxSteps: 1 | 2 = 2): MoveTable {
  const memo = new Map<number, BulletMove[]>();
  return {
    standable,
    at(t) {
      const k = key(t.x, t.z);
      let ms = memo.get(k);
      if (!ms) {
        ms = standable(t) ? movesWithin(t, standable) : [];
        if (maxSteps < 2) ms = ms.filter((m) => m.steps <= maxSteps);
        memo.set(k, ms);
      }
      return ms;
    },
  };
}

const spireTables = new WeakMap<Set<number>, MoveTable>();
const gladeTables = new WeakMap<Set<number>, MoveTable>();
const gladeTables1 = new WeakMap<Set<number>, MoveTable>();

function spireMoves(blocked: Set<number>): MoveTable {
  let m = spireTables.get(blocked);
  if (!m) { m = moveTable((t) => spireStandable(t) && !blocked.has(key(t.x, t.z))); spireTables.set(blocked, m); }
  return m;
}

const G = CLATTER_GLADE;
const STONE_KEYS: ReadonlySet<number> = new Set(CLATTER_STONES.map((t) => key(t.x, t.z)));
const inGladeXZ = (x: number, z: number) => x >= G.x0 && x <= G.x1 && z >= G.z0 && z <= G.z1;

/** Glade tiles minus the stones; outside it plain land (never the Spire floor). Moves of at most `maxSteps`. */
function gladeMoves(blocked: Set<number>, maxSteps: 1 | 2 = 2): MoveTable {
  const tables = maxSteps === 1 ? gladeTables1 : gladeTables;
  let m = tables.get(blocked);
  if (!m) {
    m = moveTable((t) => {
      if (!Number.isInteger(t.x) || !Number.isInteger(t.z) || t.x < 0 || t.z < 0 || t.x >= GRID_SIZE || t.z >= GRID_SIZE) return false;
      const k = key(t.x, t.z);
      if (blocked.has(k) || STONE_KEYS.has(k)) return false;
      return inGladeXZ(t.x, t.z) || (LAND_MASK[k] === 1 && !inSpireFloor(t));
    }, maxSteps);
    tables.set(blocked, m);
  }
  return m;
}

/**
 * The move from `from` that ends on `to` (BFS order, so its `mid` is the canonical middle), using the same
 * standable rule and step cap as the /danger move tables; null when `to` cannot be reached within one tick.
 */
export function dangerMoveTo(where: 'spire' | 'clatterhorn', from: Tile, to: Tile, blocked: Set<number>, maxSteps: 1 | 2 = 2): BulletMove | null {
  const table = where === 'spire' ? spireMoves(blocked) : gladeMoves(blocked, maxSteps);
  const ms = table.standable(from) ? table.at(from) : movesWithin(from, table.standable).filter((m) => m.steps <= maxSteps);
  return ms.find((m) => m.end.x === to.x && m.end.z === to.z && m.steps <= maxSteps) ?? null;
}

type HitFn = (k: number, p0: Tile, p1: Tile, p2: Tile) => number;

/**
 * Every move hit-free in tick + 1 with its horizon (1..3): 3 when some continuation is hit-free through tick + 3,
 * 2 when one is hit-free in tick + 2, else 1. `hit(k, ...)` tests tick + k.
 */
function horizonMoves(from: Tile, table: MoveTable, hit: HitFn): { m: BulletMove; horizon: number }[] {
  const free3 = new Map<number, boolean>(), free2 = new Map<number, boolean>(), any2 = new Map<number, boolean>();
  const isFree3 = (t: Tile) => {
    const k = key(t.x, t.z);
    let v = free3.get(k);
    if (v === undefined) { v = table.at(t).some((m) => !hit(3, t, m.mid, m.end)); free3.set(k, v); }
    return v;
  };
  const isFree2 = (t: Tile) => {
    const k = key(t.x, t.z);
    let v = free2.get(k);
    if (v === undefined) {
      let any = false;
      v = false;
      for (const m of table.at(t)) {
        if (hit(2, t, m.mid, m.end)) continue;
        any = true;
        if (isFree3(m.end)) { v = true; break; }
      }
      free2.set(k, v);
      any2.set(k, any);
    }
    return v;
  };
  const out: { m: BulletMove; horizon: number }[] = [];
  for (const m of table.at(from)) {
    if (hit(1, from, m.mid, m.end)) continue;
    const h = isFree2(m.end) ? 3 : any2.get(key(m.end.x, m.end.z)) ? 2 : 1;
    out.push({ m, horizon: h });
  }
  return out;
}

const byPreference = (a: DangerMove, b: DangerMove) =>
  (+b.star - +a.star) || (+b.winning - +a.winning) || (b.horizon - a.horizon) || (+b.court - +a.court) || (a.steps - b.steps);

// ---- Clatterhorn telegraph -----------------------------------------------------------------------------------------

/** The charge target as shown to `meIdentity` (see DangerTelegraph.bait). */
export function clatterBaitId(bait: number, meIdentity: string): string | null {
  if (!bait) return null;
  if (meIdentity && identityKey32(meIdentity) === bait) return meIdentity;
  return (bait >>> 0).toString(16).padStart(8, '0');
}

/**
 * Whether `t` can be hit by the telegraphed attack (charge and spin: its tiles; drum: any glade tile off the free
 * lines), and up to 4 tiles within 2 steps of `me` that cannot, nearest first (BFS order).
 */
export function clatterEscape(row: ClatterRowLike, tel: ClatterTelegraph, me: Tile, blocked: Set<number>, maxSteps: 1 | 2 = 2): { inside: boolean; escape: DangerXZ[] } {
  let hazard: (t: Tile) => boolean;
  if (tel.attack === 'drum') {
    const free = new Set(clatterSwarmFreeLines(row));
    const alongX = (row.swarmSide & 1) === 0;
    hazard = (t) => inGladeXZ(t.x, t.z) && !free.has(alongX ? t.x : t.z);
  } else {
    const tiles = new Set(tel.tiles);
    hazard = (t) => tiles.has(key(t.x, t.z));
  }
  const inside = hazard(me);
  if (!inside) return { inside, escape: [] };
  const table = gladeMoves(blocked, maxSteps);
  const from = { x: me.x, z: me.z };
  const ms = table.standable(from) ? table.at(from) : movesWithin(from, table.standable);
  const escape: DangerXZ[] = [];
  for (const steps of maxSteps === 1 ? [1] : [1, 2]) for (const m of ms) {
    if (m.steps === steps && !hazard(m.end) && escape.length < 4) escape.push(xz(m.end));
  }
  return { inside, escape };
}

/**
 * The Clatterhorn telegraph block shared by /danger and state.clatterhorn. Both pass the world's blocked set and
 * your step cap, so they list the same escapes.
 */
export function clatterTelegraphView(row: ClatterRowLike, me: { x: number; z: number; identity: string }, tick: number, blocked: Set<number>, maxSteps: 1 | 2 = 2) {
  const tel = clatterTelegraph(row);
  if (!tel) return null;
  const { inside, escape } = clatterEscape(row, tel, me, blocked, maxSteps);
  return {
    tel,
    view: {
      attack: tel.attack,
      landsInTicks: Math.max(0, tel.landsAtTick - tick),
      damage: tel.damage,
      end: tel.attack === 'charge' ? CLATTER_END_NAMES[tel.endKind] ?? null : null,
      bait: tel.attack === 'charge' ? clatterBaitId(tel.bait, me.identity) : null,
      tiles: tel.tiles.map(unkey),
      youAreInside: inside,
      escape,
    } satisfies DangerTelegraph,
  };
}

/** You stand in the glade or within 2 tiles of it. */
export function atClatterhorn(t: Tile): boolean {
  return t.x >= G.x0 - 2 && t.x <= G.x1 + 2 && t.z >= G.z0 - 2 && t.z <= G.z1 + 2;
}

// ---- Safety cache --------------------------------------------------------------------------------------------------

const SAFETY_CAP = 64;
const safetyMemo = new Map<string, SpireSafety>();

/**
 * Module-level memo (at most 64 entries) keyed `${runId}:${curStart}:${prevStart}:${rules}`: one build per pattern
 * rotation per process, shared by every gateway session in a Durable Object and by the browser overlay, hover and WebMCP.
 * The table starts SPIRE_INTRO_TICKS before `curStart`, so the intro (whose first pattern is published at startTick)
 * is covered. `blocked` is not part of the key: pass the world's blocked set.
 */
export function spireSafetyCached(runId: string, f: SpireFightLike, rules: number, blocked: Set<number>): SpireSafety {
  const k = `${runId}:${f.curStart}:${f.prevStart}:${rules}`;
  const hit = safetyMemo.get(k);
  if (hit) return hit;
  if (safetyMemo.size >= SAFETY_CAP) safetyMemo.delete(safetyMemo.keys().next().value as string);
  const s = spireSafety(spireFightBullets(f), Math.max(0, f.curStart - SPIRE_INTRO_TICKS), blocked);
  safetyMemo.set(k, s);
  return s;
}

// ---- The feed ------------------------------------------------------------------------------------------------------

/** UTF-8 byte length (names may hold non-ASCII characters). */
function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/** Byte size of the feed's JSON (what the gateway sends). */
export function dangerFeedBytes(feed: DangerFeed): number {
  return utf8Bytes(JSON.stringify(feed));
}

function fit(feed: DangerFeed): DangerFeed {
  if (dangerFeedBytes(feed) <= DANGER_FEED_MAX_BYTES) return feed;
  while (feed.moves.length > 1 && dangerFeedBytes(feed) > DANGER_FEED_MAX_BYTES) feed.moves.pop();
  while (feed.path.length > 0 && dangerFeedBytes(feed) > DANGER_FEED_MAX_BYTES) feed.path.pop();
  if (dangerFeedBytes(feed) > DANGER_FEED_MAX_BYTES) feed.moves.length = 0;
  return feed;
}

/** The feed of GET /api/agent/v1/danger (section 8.3). Pure; `where` is chosen in this order: on the Spire floor,
 * at Clatterhorn (in or within 2 of the glade, beetle not Closed), in a started Spire run, else null. */
export function buildDangerFeed(input: DangerInput): DangerFeed {
  const { tick, me } = input;
  const feed: DangerFeed = {
    v: 1, tick, tickMs: input.tickMs, ageMs: input.ageMs,
    sendWithinMs: Math.max(0, input.tickMs - input.ageMs - DANGER_SEND_MARGIN_MS),
    rulesVersion: input.rulesVersion, rulesMismatch: false, where: null,
    you: {
      x: me.x, z: me.z, hp: me.hp, maxHp: me.maxHp, state: null, immuneTicks: 0,
      eatReadyInTicks: Math.max(0, me.eatCooldownUntilTick - tick), mealsLeft: null,
    },
    moves: [], best: null, path: [], knownUntilTick: null, telegraph: null,
  };
  const meTile = { x: me.x, z: me.z };
  const sp = input.spire ?? null, row = input.clatter ?? null;
  if (sp && inSpireFloor(meTile)) spireFeed(feed, input, sp);
  else if (row && row.state !== ClatterState.Closed && atClatterhorn(meTile)) clatterFeed(feed, input, row);
  else if (sp && sp.run.stage >= SpireStage.Active) spireFeed(feed, input, sp);
  return fit(feed);
}

function spireFeed(feed: DangerFeed, input: DangerInput, sp: NonNullable<DangerInput['spire']>): void {
  const { tick, me, blocked } = input;
  const { run, fight, members, mySlot } = sp;
  const mine = members.find((m) => m.slot === mySlot) ?? null;
  const active = run.stage === SpireStage.Active;
  const T1 = tick + 1;
  feed.where = 'spire';
  feed.rulesMismatch = run.rules !== input.rulesVersion;
  feed.you.state = mine ? SPIRE_MEMBER_STATE_NAMES[mine.state] ?? null : null;
  const hitTick = spireSlot(fight, 'hitTick', mySlot);
  feed.you.immuneTicks = hitTick > 0 ? Math.max(0, hitTick + SPIRE_IFRAME_TICKS - tick) : 0;
  feed.you.mealsLeft = mine ? Math.max(0, SPIRE_MEALS - mine.meals) : null;
  const enraged = active && spireEnraged(run.startTick, tick);
  feed.boss = {
    name: SPIRE_BOSS_NAME, hp: fight.hp, maxHp: fight.maxHp, phase: fight.phase, phaseName: SPIRE_PHASE_NAMES[fight.phase] ?? '',
    pattern: SPIRE_PATTERNS[fight.curKind]?.key ?? null, enraged,
    enrageInTicks: active ? Math.max(0, run.startTick + SPIRE_ENRAGE_TICKS - tick) : 0,
    timeoutInTicks: active ? Math.max(0, run.endTick - tick) : 0,
  };
  feed.party = members.filter((m) => m.slot !== mySlot).sort((a, b) => a.slot - b.slot).map((m) => ({
    id: m.player?.identity ?? '', name: m.name,
    x: m.player ? m.player.x : null, z: m.player ? m.player.z : null, hp: m.player ? m.player.hp : null,
    state: SPIRE_MEMBER_STATE_NAMES[m.state] ?? 'unknown', stars: spireSlot(fight, 'stars', m.slot), away: m.awaySinceTick > 0,
  }));
  const live = spireLiveStars(run, fight, T1);
  if (active) {
    feed.stars = live ? live.stars.map((s) => ({ x: s.x, z: s.z, ticksLeft: live.lastTick - tick })) : [];
    const next = live ? live.nextTick : run.startTick;
    if (next < run.endTick) feed.nextStars = { inTicks: Math.max(1, next - tick) };
  }
  feed.knownUntilTick = spireKnownUntil(fight);
  if (feed.rulesMismatch) return;

  const table = spireMoves(blocked);
  const bullets = spireFightBullets(fight);
  const grids = [1, 2, 3].map((k) => new BulletGrid(SPIRE_BOX.x0, SPIRE_BOX.z0, SPIRE_BOX.x1 - SPIRE_BOX.x0 + 1, SPIRE_BOX.z1 - SPIRE_BOX.z0 + 1).build(bullets, tick + k));
  const starKeys = new Set((live?.stars ?? []).map((s) => key(s.x, s.z)));
  const w = SPIRE_FLOOR.x1 - SPIRE_FLOOR.x0 + 1, h = SPIRE_FLOOR.z1 - SPIRE_FLOOR.z0 + 1;
  feed.grid = { x0: SPIRE_FLOOR.x0, z0: SPIRE_FLOOR.z0, w, h };
  feed.map = [];
  for (let z = SPIRE_FLOOR.z0; z <= SPIRE_FLOOR.z1; z++) {
    let line = '';
    for (let x = SPIRE_FLOOR.x0; x <= SPIRE_FLOOR.x1; x++) {
      if (!table.standable({ x, z })) { line += '#'; continue; }
      const bits = (grids[0].dangerAt(x, z) ? 1 : 0) | (grids[1].dangerAt(x, z) ? 2 : 0) | (grids[2].dangerAt(x, z) ? 4 : 0);
      line += bits ? String(bits) : starKeys.has(key(x, z)) ? '*' : '.';
    }
    feed.map.push(line);
  }

  const here = { x: me.x, z: me.z };
  const canMove = active && mine !== null && mine.state === SpireMemberState.In && mine.awaySinceTick === 0 && me.hp > 0
    && T1 < run.endTick && table.standable(here);
  if (!canMove) return;
  const safety = sp.safety ?? spireSafetyCached(String(run.id), fight, run.rules, blocked);
  const scored = horizonMoves(here, table, (k, p0, p1, p2) => grids[k - 1].hits(p0, p1, p2));
  const moves = scored.map(({ m, horizon }): DangerMove => ({
    to: xz(m.end), via: xz(m.mid), steps: m.steps, horizon,
    winning: safety.winning(T1, m.end),
    star: starKeys.has(key(m.mid.x, m.mid.z)) || starKeys.has(key(m.end.x, m.end.z)),
    court: inSpireCourt(m.end),
  }));
  moves.sort(byPreference);
  feed.moves = moves.slice(0, DANGER_MAX_MOVES);
  feed.best = feed.moves.length ? { to: feed.moves[0].to, via: feed.moves[0].via } : null;
  feed.path = spirePlan(here, tick, Math.min(DANGER_MAX_PATH, Math.max(0, feed.knownUntilTick - tick)), safety, run, fight);
}

/**
 * The survival plan: from `start` at the end of `tick`, one end tile per tick. Each step keeps to hit-free winning
 * moves (else hit-free, else anything) and prefers catching a live star, then the court, then nearing the closest
 * uncaught star; ties keep BFS order (stay first).
 */
function spirePlan(start: Tile, tick: number, len: number, safety: SpireSafety, run: SpireRunLike, fight: SpireFightLike): DangerXZ[] {
  const out: DangerXZ[] = [];
  const caught = new Set<string>();
  let at = start;
  for (let i = 0; i < len; i++) {
    const T = tick + i;
    const ms = safety.movesFrom(T, at);
    if (!ms.length) break;
    const live = spireLiveStars(run, fight, T + 1);
    const stars = (live?.stars ?? []).filter((s) => !caught.has(`${live!.wave}:${s.j}`));
    const starOf = (t: Tile) => stars.find((s) => s.x === t.x && s.z === t.z);
    const winning = ms.filter((m) => !m.hit && m.winning);
    const cands = winning.length ? winning : ms.filter((m) => !m.hit);
    const pool = cands.length ? cands : ms;
    let best = pool[0], bestScore = Infinity;
    for (const m of pool) {
      const catches = starOf(m.mid) ?? starOf(m.end);
      const near = stars.length ? Math.min(...stars.map((s) => cheb(s, m.end))) : 0;
      const score = (catches ? 0 : inSpireCourt(m.end) ? 1000 : 2000) + near;
      if (score < bestScore) { bestScore = score; best = m; }
    }
    for (const t of [best.mid, best.end]) { const s = starOf(t); if (s) caught.add(`${live!.wave}:${s.j}`); }
    at = best.end;
    out.push(xz(at));
  }
  return out;
}

function clatterFeed(feed: DangerFeed, input: DangerInput, row: ClatterRowLike): void {
  const { tick, me, blocked } = input;
  const maxSteps = input.maxSteps ?? 2;
  feed.where = 'clatterhorn';
  feed.knownUntilTick = tick + DANGER_HORIZON;
  const table = gladeMoves(blocked, maxSteps);
  const hit: HitFn = (k, p0, p1, p2) => clatterHitsMove(row, tick + k, p0, p1, p2);
  const w = G.x1 - G.x0 + 1, h = G.z1 - G.z0 + 1;
  feed.grid = { x0: G.x0, z0: G.z0, w, h };
  feed.map = [];
  for (let z = G.z0; z <= G.z1; z++) {
    let line = '';
    for (let x = G.x0; x <= G.x1; x++) {
      const t = { x, z };
      if (!table.standable(t)) { line += '#'; continue; }
      const bits = (hit(1, t, t, t) ? 1 : 0) | (hit(2, t, t, t) ? 2 : 0) | (hit(3, t, t, t) ? 4 : 0);
      line += bits ? String(bits) : '.';
    }
    feed.map.push(line);
  }
  const tv = clatterTelegraphView(row, me, tick, blocked, maxSteps);
  feed.telegraph = tv ? tv.view : null;
  const here = { x: me.x, z: me.z };
  if (me.hp <= 0 || !table.standable(here)) return;
  const beetle = { x: row.x, z: row.z };
  const moves = horizonMoves(here, table, hit).map(({ m, horizon }): DangerMove => ({
    to: xz(m.end), via: xz(m.mid), steps: m.steps, horizon, winning: horizon === DANGER_HORIZON, star: false,
    court: cheb(m.end, beetle) <= CLATTER_REACH,
  }));
  moves.sort(byPreference);
  feed.moves = moves.slice(0, DANGER_MAX_MOVES);
  feed.best = feed.moves.length ? { to: feed.moves[0].to, via: feed.moves[0].via } : null;
}
