/**
 * Clatterhorn, the overworld boss of Clatterhorn's Glade (FINAL_SPEC
 * section 2): lanes, the pure step function, the swarm, telegraphs and
 * reward qualification.
 *
 * Pure and integer-only (no trigonometry): the server, the browser and the
 * agent gateway resolve exactly the same tiles.
 */
import type { BossConfigLike } from './bossConfig';
import { CLATTER_GLADE, CLATTER_HOME, CLATTER_STONES } from './bossZones';
import { bulletsHitMove, mix32, type Vec } from './bullets';
import { GRID_SIZE } from './constants';
import { tileKey } from './grid';
import type { Tile } from './types';

export const CLATTERHORN_ID = 1;

export const ClatterState = {
  Dormant: 0, Idle: 1, ChargeWindup: 2, SpinWindup: 3, DrumWindup: 4, Drumming: 5,
  Recover: 6, Flipped: 7, Burrowed: 8, Closed: 9,
} as const;
export type ClatterState = (typeof ClatterState)[keyof typeof ClatterState];
export const ClatterAttack = { None: 0, Charge: 1, Spin: 2, Drum: 3 } as const;
export type ClatterAttack = (typeof ClatterAttack)[keyof typeof ClatterAttack];
export const ClatterEndKind = { None: 0, Skid: 1, Glance: 2, Flip: 3 } as const;
export type ClatterEndKind = (typeof ClatterEndKind)[keyof typeof ClatterEndKind];

/** Charge telegraph lead by phase (index 1..3). Never below 3 ticks. */
export const CLATTER_CHARGE_WINDUP = [0, 3, 3, 3] as const;
export const CLATTER_SPIN_WINDUP = 3;
export const CLATTER_DRUM_WINDUP = 3;
/** After a Skid/Glance with no chain left, after a Spin, after Drumming, or a shuffle. */
export const CLATTER_RECOVER_TICKS = 2;
/** The x2 damage window by phase. */
export const CLATTER_FLIP_TICKS = [0, 7, 6, 5] as const;
export const CLATTER_FRENZY_FLIP_TICKS = 4;
/** Extra charges after a Skid or Glance, by phase. */
export const CLATTER_CHAIN = [0, 1, 2, 3] as const;
/** Every Nth action is a Drum, by phase (0 = never). */
export const CLATTER_DRUM_EVERY = [0, 7, 5, 4] as const;
/** From this phase on, a seeded half of the spins are Shell Slams: the body (Chebyshev <= 1) is hit and ring 2 is safe. */
export const CLATTER_SLAM_PHASE = 2;
/** Drumming lasts from the fire tick F to F + 20. */
export const CLATTER_SWARM_TICKS = 20;
export const CLATTER_DAMAGE = { charge: 14, spin: 10, runner: 5 } as const;
export const CLATTER_LONELY_TICKS = 100;
export const CLATTER_RESPAWN_TICKS = 300;
export const CLATTER_FRENZY_TICKS = 450;
/** Swing reach: Chebyshev from its centre. */
export const CLATTER_REACH = 2;
export const CLATTER_MIN_CONTRIBUTION = 16;
export const CLATTER_CHALLENGER_CAP = 120;
export const CLATTER_REWARDS_PER_TICK = 25;
export const CLATTER_MAX_LANE = 14;
/** A qualifying contributor's last landed swing is at most this old at the defeat. */
export const CLATTER_RECENT_TICKS = 100;
/** Facing order of grid.ts: 0 S, 1 SW, 2 W, 3 NW, 4 N, 5 NE, 6 E, 7 SE. */
export const CLATTER_DIR8: readonly Vec[] = [[0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1]];
export const CLATTER_REWARD: { items: readonly { itemId: string; quantity: number }[]; fightingXp: 40; keepsake: 12 } = {
  items: [{ itemId: 'gleamshell', quantity: 2 }, { itemId: 'berry_goldberry', quantity: 2 }],
  fightingXp: 40,
  keepsake: 12,
};
/** Index = ClatterState. */
export const CLATTER_STATE_NAMES: readonly string[] = [
  'dormant', 'idle', 'charge_windup', 'spin_windup', 'drum_windup', 'drumming', 'recover', 'flipped', 'burrowed', 'closed',
];

export interface ClatterRowLike extends Tile {
  hp: number; maxHp: number; state: number; phase: number; stateUntilTick: number;
  attack: number; dir: number; endX: number; endZ: number; endKind: number; chain: number; attackCount: number; bait: number;
  swarmTick: number; swarmSide: number; swarmFree: number; engagedTick: number; lastHitTick: number; challengers: number;
  fightCount: number; defeats: number; owedLeft: number;
}
export interface ClatterCandidate extends Tile { order: number; key: number }


// ---- Small helpers ---------------------------------------------------------------

const G = CLATTER_GLADE;
const STONE_KEYS: ReadonlySet<number> = new Set(CLATTER_STONES.map(tileKey));
const isStone = (x: number, z: number) => STONE_KEYS.has(z * GRID_SIZE + x);
const inGlade = (x: number, z: number) => x >= G.x0 && x <= G.x1 && z >= G.z0 && z <= G.z1;
const near2 = (c: Tile, t: Tile) => Math.max(Math.abs(c.x - t.x), Math.abs(c.z - t.z));

/** A 3 x 3 around (x, z) that holds a standing stone. */
function bodyHasStone(x: number, z: number): boolean {
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (isStone(x + dx, z + dz)) return true;
  return false;
}

/** (parseInt(hex.slice(56, 64), 16) >>> 0) || 1 */
export function identityKey32(hex: string): number {
  return (parseInt(hex.slice(56, 64), 16) >>> 0) || 1;
}

export function clatterMaxHp(cfg: BossConfigLike, challengers: number): number {
  return Math.max(0, cfg.clatterHpBase + cfg.clatterHpPerChallenger * Math.max(0, Math.min(challengers, CLATTER_CHALLENGER_CAP)));
}

/**
 * The reset fields (section 2.2): Dormant at home with `hp = maxHp =
 * clatterHpBase`, no challengers, phase 1 and every attack field cleared
 * (`endX/endZ` point at home). Used by the lonely reset, the respawn and an
 * owner reopen; `fightCount`, `defeats`, `owedLeft`, `engagedTick` and
 * `lastHitTick` are kept.
 */
export function clatterReturnHome<R extends ClatterRowLike>(row: R, cfg: BossConfigLike, state: number = ClatterState.Dormant): R {
  const hp = clatterMaxHp(cfg, 0);
  return {
    ...row,
    state, x: CLATTER_HOME.x, z: CLATTER_HOME.z, hp, maxHp: hp, challengers: 0, phase: 1, stateUntilTick: 0,
    attack: ClatterAttack.None, dir: 0, endX: CLATTER_HOME.x, endZ: CLATTER_HOME.z, endKind: ClatterEndKind.None,
    chain: 0, attackCount: 0, bait: 0, swarmTick: 0, swarmSide: 0, swarmFree: 0,
  };
}

/** Dormant at home (Closed when !clatterhornOpen); used only to insert the missing row. */
export function freshClatterhorn(cfg: BossConfigLike): ClatterRowLike {
  const hp = clatterMaxHp(cfg, 0);
  return {
    x: CLATTER_HOME.x, z: CLATTER_HOME.z, hp, maxHp: hp,
    state: cfg.clatterhornOpen ? ClatterState.Dormant : ClatterState.Closed, phase: 1, stateUntilTick: 0,
    attack: ClatterAttack.None, dir: 0, endX: CLATTER_HOME.x, endZ: CLATTER_HOME.z, endKind: ClatterEndKind.None,
    chain: 0, attackCount: 0, bait: 0, swarmTick: 0, swarmSide: 0, swarmFree: 0,
    engagedTick: 0, lastHitTick: 0, challengers: 0, fightCount: 0, defeats: 0, owedLeft: 0,
  };
}

export function clatterFrenzy(row: ClatterRowLike, T: number): boolean {
  return T - row.engagedTick >= CLATTER_FRENZY_TICKS;
}

/** max(stored phase, frenzy ? 3 : the HP band); phases never go down. */
export function clatterPhase(row: ClatterRowLike, T: number): 1 | 2 | 3 {
  const band = clatterFrenzy(row, T) ? 3 : 3 * row.hp <= row.maxHp ? 3 : 3 * row.hp <= 2 * row.maxHp ? 2 : 1;
  return Math.min(3, Math.max(row.phase, band)) as 1 | 2 | 3;
}

/** Swings land in every state except Dormant, Burrowed and Closed. */
export function clatterAttackable(row: ClatterRowLike): boolean {
  return row.state !== ClatterState.Dormant && row.state !== ClatterState.Burrowed && row.state !== ClatterState.Closed;
}

/** The Facing-order octant of (dx, dz); `fallback` when both are 0. */
export function clatterOctant(dx: number, dz: number, fallback: number): number {
  const ax = Math.abs(dx), az = Math.abs(dz);
  if (ax === 0 && az === 0) return fallback;
  if (ax > 2 * az) return dx > 0 ? 6 : 2;
  if (az > 2 * ax) return dz > 0 ? 0 : 4;
  return dx > 0 ? (dz > 0 ? 7 : 5) : (dz > 0 ? 1 : 3);
}

/** The 3 x 3 body around `t` lies inside the glade and holds no stone (153 centres). */
export function clatterValidCentre(t: Tile): boolean {
  return t.x - 1 >= G.x0 && t.x + 1 <= G.x1 && t.z - 1 >= G.z0 && t.z + 1 <= G.z1 && !bodyHasStone(t.x, t.z);
}

export interface ClatterLane { dir: number; len: number; end: Tile; endKind: number; tiles: readonly number[] }

/**
 * The charge lane from `from` in direction `dir`: the longest run (<= 14) of
 * valid centres, its end kind (a stone two past the end flips it, a stone in
 * the next body glances, else a skid) and the swept 3 x 3 body clipped to the
 * glade without stones (tile keys, ascending).
 */
export function clatterLane(from: Tile, dir: number): ClatterLane {
  const d = CLATTER_DIR8[dir & 7];
  let len = 0;
  while (len < CLATTER_MAX_LANE && clatterValidCentre({ x: from.x + d[0] * (len + 1), z: from.z + d[1] * (len + 1) })) len++;
  const end = { x: from.x + d[0] * len, z: from.z + d[1] * len };
  const endKind = isStone(end.x + 2 * d[0], end.z + 2 * d[1]) ? ClatterEndKind.Flip
    : bodyHasStone(end.x + d[0], end.z + d[1]) ? ClatterEndKind.Glance : ClatterEndKind.Skid;
  const set = new Set<number>();
  for (let k = 0; k <= len; k++) {
    const cx = from.x + d[0] * k, cz = from.z + d[1] * k;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx, z = cz + dz;
      if (inGlade(x, z) && !isStone(x, z)) set.add(z * GRID_SIZE + x);
    }
  }
  return { dir: dir & 7, len, end, endKind, tiles: [...set].sort((a, b) => a - b) };
}

/** The lane toward `target` (octant, else the longer of o+1 / o-1, tie o+1); null when every option is shorter than 2. */
export function clatterChooseLane(from: Tile, target: Tile, prevDir: number): ClatterLane | null {
  const o = clatterOctant(target.x - from.x, target.z - from.z, prevDir & 7);
  const main = clatterLane(from, o);
  if (main.len >= 2) return main;
  const cw = clatterLane(from, (o + 1) & 7), ccw = clatterLane(from, (o + 7) & 7);
  const best = cw.len >= ccw.len ? cw : ccw;
  return best.len >= 2 ? best : null;
}

/** Tile keys at Chebyshev exactly 2 from the centre, inside the glade (stones excluded), ascending. */
export function clatterSpinTiles(centre: Tile): readonly number[] {
  const out: number[] = [];
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== 2) continue;
    const x = centre.x + dx, z = centre.z + dz;
    if (inGlade(x, z) && !isStone(x, z)) out.push(z * GRID_SIZE + x);
  }
  return out.sort((a, b) => a - b);
}

/** The Shell Slam's tiles: the 3 x 3 body (Chebyshev <= 1), inside the glade, stones excluded, ascending. */
export function clatterSlamTiles(centre: Tile): readonly number[] {
  const out: number[] = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const x = centre.x + dx, z = centre.z + dz;
    if (inGlade(x, z) && !isStone(x, z)) out.push(z * GRID_SIZE + x);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Whether the row's spin is a Shell Slam: from CLATTER_SLAM_PHASE on (stored
 * phase, fixed for the windup), seeded by the fight and the action count, so
 * the server, the browser and agents agree. Huggers can no longer park in the
 * eye: they read the telegraph and step out to ring 2 (still within reach).
 */
export function clatterSlam(row: Pick<ClatterRowLike, 'attack' | 'phase' | 'fightCount' | 'attackCount'>): boolean {
  return row.attack === ClatterAttack.Spin && row.phase >= CLATTER_SLAM_PHASE && (mix32(row.fightCount, row.attackCount + 104729) & 1) === 1;
}

/** The tiles a spin windup lands on: the slam's body, else ring 2. */
export function clatterSpinBlowTiles(row: ClatterRowLike): readonly number[] {
  return clatterSlam(row) ? clatterSlamTiles(row) : clatterSpinTiles(row);
}

/** A player may land swings only from a glade tile within reach (no free hits from outside the hazards). */
export function clatterCanSwingFrom(p: Tile, row: Tile): boolean {
  return inGlade(p.x, p.z) && near2(p, row) <= CLATTER_REACH;
}

/** BFS goal for walking into swing range: an unblocked glade tile within reach of the centre. */
export function clatterSwingGoal(row: Tile, blocked: ReadonlySet<number>): (t: Tile) => boolean {
  return (t) => clatterCanSwingFrom(t, row) && !blocked.has(t.z * GRID_SIZE + t.x);
}

// ---- The swarm (section 2.5.1) ---------------------------------------------------

const GLADE_SPAN = G.x1 - G.x0 + 1; // 17 columns

/** Wave-A fire tick of the row's swarm: the landing tick while DrumWindup (runners are predictable), else swarmTick. */
function swarmFireTick(row: ClatterRowLike): number {
  return row.state === ClatterState.DrumWindup ? row.stateUntilTick : row.swarmTick;
}

function runnerOrigin(side: number, i: number): [number, number, number, number] {
  switch (side & 3) {
    case 0: return [G.x0 + i, G.z0 - 1, 0, 1];
    case 1: return [G.x1 + 1, G.z0 + i, -1, 0];
    case 2: return [G.x1 - i, G.z1 + 1, 0, -1];
    default: return [G.x0 - 1, G.z1 - i, 1, 0];
  }
}

const EMPTY = new Int32Array(0);
let packedF = -1, packedSide = -1, packedFree = -1;
let packedCache: Int32Array = EMPTY;

/** Internal shared copy (never handed out). */
function swarmPacked(row: ClatterRowLike): Int32Array {
  const F = swarmFireTick(row);
  if (F <= 0) return EMPTY;
  const side = row.swarmSide & 3, f = row.swarmFree % 3;
  if (F === packedF && side === packedSide && f === packedFree) return packedCache;
  const out: number[] = [];
  for (const [wave, mod] of [[0, (f + 1) % 3], [2, (f + 2) % 3]] as const) {
    for (let i = 0; i < GLADE_SPAN; i++) {
      if (i % 3 !== mod) continue;
      const [ox, oz, dx, dz] = runnerOrigin(side, i);
      out.push(F + wave, ox, oz, dx, dz, 1);
    }
  }
  packedF = F; packedSide = side; packedFree = f;
  packedCache = Int32Array.from(out);
  return packedCache;
}

/** Packed runners (absolute): wave A at F, wave B at F + 2; empty when no swarm. */
export function clatterSwarmBullets(row: ClatterRowLike): Int32Array {
  return swarmPacked(row).slice();
}

/** The never-used x (N/S) or z (E/W) values, ascending; empty when no swarm. */
export function clatterSwarmFreeLines(row: ClatterRowLike): number[] {
  if (swarmFireTick(row) <= 0) return [];
  const out: number[] = [];
  const f = row.swarmFree % 3, side = row.swarmSide & 3;
  for (let i = 0; i < GLADE_SPAN; i++) {
    if (i % 3 !== f) continue;
    out.push(side === 0 ? G.x0 + i : side === 1 ? G.z0 + i : side === 2 ? G.x1 - i : G.z1 - i);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Glade-clipped runner hit: 0 = miss, else the half-step. Only players whose
 * start or end tile is in the glade can be hit, and a runner half-step counts
 * only while it is in (or leaving) the glade.
 */
export function clatterSwarmHit(row: ClatterRowLike, T: number, p0: Tile, p1: Tile, p2: Tile): 0 | 1 | 2 {
  if (!inGlade(p0.x, p0.z) && !inGlade(p2.x, p2.z)) return 0;
  const b = swarmPacked(row);
  if (b.length === 0) return 0;
  return bulletsHitMove(b, T, p0, p1, p2, inGlade);
}

// ---- Telegraph -------------------------------------------------------------------

export interface ClatterTelegraph {
  attack: 'charge' | 'spin' | 'slam' | 'drum';
  tiles: readonly number[];
  landsAtTick: number;
  damage: number;
  endKind: number;
  from: Tile;
  to: Tile;
  dir: number;
  bait: number;
}

/**
 * Exactly the tiles that resolve, or null when not winding up. Charge: the lane
 * tiles, landing at `stateUntilTick`. Spin: ring 2 (a Slam: the body), landing at
 * `stateUntilTick`. Drum: the glade entry-row tiles of wave A, which runners
 * first reach in tick `stateUntilTick + 1` (later contact comes from
 * `clatterSwarmBullets`).
 */
export function clatterTelegraph(row: ClatterRowLike): ClatterTelegraph | null {
  const centre = { x: row.x, z: row.z };
  if (row.state === ClatterState.ChargeWindup) {
    return {
      attack: 'charge', tiles: clatterLane(centre, row.dir).tiles, landsAtTick: row.stateUntilTick,
      damage: CLATTER_DAMAGE.charge, endKind: row.endKind, from: centre, to: { x: row.endX, z: row.endZ }, dir: row.dir, bait: row.bait,
    };
  }
  if (row.state === ClatterState.SpinWindup) {
    return {
      attack: clatterSlam(row) ? 'slam' : 'spin', tiles: clatterSpinBlowTiles(row), landsAtTick: row.stateUntilTick, damage: CLATTER_DAMAGE.spin,
      endKind: ClatterEndKind.None, from: centre, to: centre, dir: row.dir, bait: row.bait,
    };
  }
  if (row.state === ClatterState.DrumWindup) {
    const f = row.swarmFree % 3, tiles: number[] = [];
    for (let i = 0; i < GLADE_SPAN; i++) {
      if (i % 3 !== (f + 1) % 3) continue;
      const [ox, oz, dx, dz] = runnerOrigin(row.swarmSide, i);
      tiles.push((oz + dz) * GRID_SIZE + ox + dx);
    }
    return {
      attack: 'drum', tiles: tiles.sort((a, b) => a - b), landsAtTick: row.stateUntilTick + 1, damage: CLATTER_DAMAGE.runner,
      endKind: ClatterEndKind.None, from: centre, to: centre, dir: row.dir, bait: row.bait,
    };
  }
  return null;
}

// ---- The step function (section 2.4) ------------------------------------------------

export interface ClatterStep<R> {
  next: R | null;
  blow?: { attack: number; tiles: ReadonlySet<number>; damage: number };
  moved?: boolean; flipped?: boolean; woke?: boolean; reset?: boolean; returned?: boolean; swarmFired?: boolean;
}

function countNear(c: Tile, cands: readonly ClatterCandidate[]): number {
  let n = 0;
  for (const p of cands) if (near2(p, c) <= CLATTER_REACH) n++;
  return n;
}

/** The charge target: the farthest candidate (ties: lower order), skipping the previous bait while 2+ candidates stand. */
function chooseBait(c: Tile, cands: readonly ClatterCandidate[], prevBait: number): ClatterCandidate | null {
  const pick = (skip: boolean) => {
    let best: ClatterCandidate | null = null, bestD = -1;
    for (const p of cands) {
      if (skip && p.key === prevBait) continue;
      const d = near2(p, c);
      if (d > bestD || (d === bestD && best && p.order < best.order)) { best = p; bestD = d; }
    }
    return best;
  };
  // A key collision can leave nobody after the skip; it then just allows one repeat.
  return (cands.length >= 2 ? pick(true) : null) ?? pick(false);
}

/** CHARGE(T, chained) of section 2.4 on `b` (already moved to its landing centre for a chained charge). */
function charge<R extends ClatterRowLike>(b: R, T: number, cands: readonly ClatterCandidate[], chained: boolean): R {
  const phase = clatterPhase(b, T);
  const centre = { x: b.x, z: b.z };
  const target = chooseBait(centre, cands, b.bait);
  const lane = target ? clatterChooseLane(centre, target, b.dir) : null;
  if (!lane || !target) {
    if (countNear(centre, cands) >= 1 && b.attack !== ClatterAttack.Spin) {
      return { ...b, phase, state: ClatterState.SpinWindup, attack: ClatterAttack.Spin, stateUntilTick: T + CLATTER_SPIN_WINDUP, chain: 0 };
    }
    // A shuffle: no action, a short pause.
    return { ...b, phase, state: ClatterState.Recover, attack: ClatterAttack.None, stateUntilTick: T + CLATTER_RECOVER_TICKS, chain: 0 };
  }
  return {
    ...b, phase, state: ClatterState.ChargeWindup, attack: ClatterAttack.Charge,
    dir: lane.dir, endX: lane.end.x, endZ: lane.end.z, endKind: lane.endKind,
    stateUntilTick: T + CLATTER_CHARGE_WINDUP[phase], bait: target.key,
    chain: chained ? b.chain : CLATTER_CHAIN[phase],
  };
}

/** DECIDE(T) of section 2.4. */
function decide<R extends ClatterRowLike>(b: R, T: number, cands: readonly ClatterCandidate[], cfg: BossConfigLike): ClatterStep<R> {
  if (cands.length === 0) {
    if (b.state === ClatterState.Idle && b.stateUntilTick > 0) {
      if (T >= b.stateUntilTick) return { next: clatterReturnHome(b, cfg), reset: true };
      return { next: null };
    }
    return { next: { ...b, state: ClatterState.Idle, stateUntilTick: T + CLATTER_LONELY_TICKS } };
  }
  const phase = clatterPhase(b, T);
  const n = b.attackCount;
  const near = countNear(b, cands);
  const every = CLATTER_DRUM_EVERY[phase];
  let next: R;
  if (every > 0 && n % every === every - 1) {
    next = {
      ...b, state: ClatterState.DrumWindup, attack: ClatterAttack.Drum, stateUntilTick: T + CLATTER_DRUM_WINDUP, chain: 0,
      swarmSide: mix32(b.fightCount, n) & 3, swarmFree: mix32(b.fightCount, n + 7919) % 3,
    };
  } else if (near >= 1 && b.attack !== ClatterAttack.Spin && (n % 3 === 2 || near >= 3)) {
    next = { ...b, state: ClatterState.SpinWindup, attack: ClatterAttack.Spin, stateUntilTick: T + CLATTER_SPIN_WINDUP, chain: 0 };
  } else {
    next = charge(b, T, cands, false);
  }
  return { next: { ...next, attackCount: n + 1, phase } };
}

/**
 * One tick of Clatterhorn's AI (not the players' swings; a defeat is handled
 * by the caller). Pure: `next` is null when nothing changes. Resets keep
 * `fightCount`, `defeats` and `owedLeft`.
 */
export function stepClatterhorn<R extends ClatterRowLike>(row: R, T: number, cands: readonly ClatterCandidate[], cfg: BossConfigLike): ClatterStep<R> {
  switch (row.state) {
    case ClatterState.Closed:
      return { next: null };
    case ClatterState.Burrowed:
      if (T < row.stateUntilTick) return { next: null };
      return { next: clatterReturnHome(row, cfg), returned: true };
    case ClatterState.Dormant: {
      if (cands.length === 0) return { next: null };
      const hp = clatterMaxHp(cfg, 0);
      return {
        next: {
          ...row, state: ClatterState.Idle, hp, maxHp: hp, challengers: 0, phase: 1, engagedTick: T, lastHitTick: T,
          fightCount: row.fightCount + 1, stateUntilTick: 0, attack: ClatterAttack.None, attackCount: 0, chain: 0, bait: 0,
        },
        woke: true,
      };
    }
    case ClatterState.ChargeWindup: {
      if (T < row.stateUntilTick) return { next: null };
      const blow = { attack: ClatterAttack.Charge, tiles: new Set(clatterLane(row, row.dir).tiles), damage: CLATTER_DAMAGE.charge };
      const landed: R = { ...row, x: row.endX, z: row.endZ };
      if (row.endKind === ClatterEndKind.Flip) {
        const phase = clatterPhase(landed, T);
        const ticks = clatterFrenzy(landed, T) ? CLATTER_FRENZY_FLIP_TICKS : CLATTER_FLIP_TICKS[phase];
        return { next: { ...landed, state: ClatterState.Flipped, stateUntilTick: T + ticks, chain: 0 }, blow, moved: true, flipped: true };
      }
      if (row.chain > 0) return { next: charge({ ...landed, chain: row.chain - 1 }, T, cands, true), blow, moved: true };
      return { next: { ...landed, state: ClatterState.Recover, stateUntilTick: T + CLATTER_RECOVER_TICKS }, blow, moved: true };
    }
    case ClatterState.SpinWindup:
      if (T < row.stateUntilTick) return { next: null };
      return {
        next: { ...row, state: ClatterState.Recover, stateUntilTick: T + CLATTER_RECOVER_TICKS },
        blow: { attack: ClatterAttack.Spin, tiles: new Set(clatterSpinBlowTiles(row)), damage: CLATTER_DAMAGE.spin },
      };
    case ClatterState.DrumWindup:
      if (T < row.stateUntilTick) return { next: null };
      return { next: { ...row, state: ClatterState.Drumming, swarmTick: T, stateUntilTick: T + CLATTER_SWARM_TICKS }, swarmFired: true };
    case ClatterState.Drumming:
      if (T < row.stateUntilTick) return { next: null };
      return { next: { ...row, state: ClatterState.Recover, stateUntilTick: T + CLATTER_RECOVER_TICKS } };
    case ClatterState.Recover:
    case ClatterState.Flipped:
      if (T < row.stateUntilTick) return { next: null };
      return decide(row, T, cands, cfg);
    case ClatterState.Idle:
      return decide(row, T, cands, cfg);
    default:
      return { next: null };
  }
}

// ---- Rewards ---------------------------------------------------------------------

/** damage >= 16, fight matches and T - lastHitTick <= CLATTER_RECENT_TICKS (online is checked by the caller). */
export function clatterQualifies(c: { damage: number; fight: number; lastHitTick: number }, fight: number, T: number): boolean {
  return c.fight === fight && c.damage >= CLATTER_MIN_CONTRIBUTION && T - c.lastHitTick <= CLATTER_RECENT_TICKS;
}

export function clatterRewardees<C extends { damage: number; fight: number; lastHitTick: number }>(rows: readonly C[], fight: number, T: number): C[] {
  return rows.filter((c) => clatterQualifies(c, fight, T));
}

// ---- Hazard of a move ------------------------------------------------------------

/**
 * Exact Clatterhorn hazard of tick T for a move (p0, p1, p2): a blow landing in
 * T (end tile in the telegraph tiles) or a runner under the swept rule; 0 =
 * miss, else the half-step (blows report 2). Used by /danger moves and the
 * client hover.
 */
export function clatterHitsMove(row: ClatterRowLike, T: number, p0: Tile, p1: Tile, p2: Tile): 0 | 1 | 2 {
  const runner = clatterSwarmHit(row, T, p0, p1, p2);
  if (runner === 1) return 1;
  if ((row.state === ClatterState.ChargeWindup || row.state === ClatterState.SpinWindup) && T === row.stateUntilTick
    && blowTiles(row).has(p2.z * GRID_SIZE + p2.x)) return 2;
  return runner;
}

let blowState = -1, blowX = 0, blowZ = 0, blowDir = -1, blowSlam = false;
let blowCache: ReadonlySet<number> = new Set();

/** The landing tiles of a charge or spin windup (one-entry cache: /danger asks 75 times per read). */
function blowTiles(row: ClatterRowLike): ReadonlySet<number> {
  const dir = row.state === ClatterState.ChargeWindup ? row.dir & 7 : -1;
  const slam = dir < 0 && clatterSlam(row);
  if (row.state !== blowState || row.x !== blowX || row.z !== blowZ || dir !== blowDir || slam !== blowSlam) {
    blowCache = new Set(dir >= 0 ? clatterLane(row, dir).tiles : slam ? clatterSlamTiles(row) : clatterSpinTiles(row));
    blowState = row.state; blowX = row.x; blowZ = row.z; blowDir = dir; blowSlam = slam;
  }
  return blowCache;
}
