/**
 * The Sunken Spire (FINAL_SPEC section 3; CORE_SCOPE cuts: no practice runs,
 * no private lobbies, kick or queue, no downed/revive). Pure, deterministic:
 * patterns, the scheduler, stars, collision wrappers and the safety table.
 *
 * Integer only: no Math.random, Date.now or trigonometry decides a tile, a
 * hit or a reward. Pattern geometry ports proto-final/patterns.mjs exactly.
 */
import type { BossConfigLike } from './bossConfig';
import { SPIRE_CENTRE, SPIRE_FLOOR, inSpireFloor, spireStandable } from './bossZones';
import {
  BULLET_LIFE_HALF_STEPS, BULLET_STRIDE, BulletGrid, D16, bulletDangerKeys, bulletsHitMove, canonicalMiddle, mix32,
  movesWithin, quarterTurn, turnBy,
} from './bullets';
import type { BulletMove, Vec } from './bullets';
import { chebyshev, tileKey } from './grid';
import type { Tile } from './types';

/** Bump on ANY change to bullet math, patterns, durations, pools or stars (spire-patterns.test.ts enforces it). */
export const SPIRE_RULES_VERSION = 1;

/** `spire_run.stage`. `Queued` is reserved (no queue in this release). */
export const SpireStage = { Lobby: 0, Queued: 1, Active: 2, Cleared: 3, Failed: 4 } as const;
export type SpireStage = (typeof SpireStage)[keyof typeof SpireStage];
/** `spire_run.outcome`. */
export const SpireOutcome = { None: 0, Cleared: 1, Wiped: 2, TimedOut: 3, Abandoned: 4, Closed: 5, Reset: 6 } as const;
export type SpireOutcome = (typeof SpireOutcome)[keyof typeof SpireOutcome];
/** `spire_run.mode`: always Normal in this release (Practice is reserved). */
export const SpireMode = { Normal: 0, Practice: 1 } as const;
export type SpireMode = (typeof SpireMode)[keyof typeof SpireMode];
/** `spire_member.state`. `Downed` is reserved (no downed state in this release). */
export const SpireMemberState = { Lobby: 0, In: 1, Downed: 2, Out: 3, Left: 4, Done: 5 } as const;
export type SpireMemberState = (typeof SpireMemberState)[keyof typeof SpireMemberState];
export const SpirePhase = { Bloom: 1, Gale: 2, Shatter: 3, Nightfall: 4 } as const;
export type SpirePhase = (typeof SpirePhase)[keyof typeof SpirePhase];
/** Pattern kinds (index into SPIRE_PATTERNS). */
export const SpirePatternKind = {
  PetalRing: 0, Glint: 1, Tidewall: 2, Crosswind: 3, Lattice: 4, Drizzle: 5,
  GlassSheet: 6, Cage: 7, Maelstrom: 8, Eclipse: 9, Shardstorm: 10,
} as const;
export type SpirePatternKind = (typeof SpirePatternKind)[keyof typeof SpirePatternKind];
/** `curKind`/`prevKind` when there is no pattern. */
export const SPIRE_NONE = 255;

/** Spawn tiles by slot. */
export const SPIRE_SPAWNS: readonly Tile[] = [{ x: 72, z: 68 }, { x: 75, z: 68 }, { x: 79, z: 68 }, { x: 82, z: 68 }];
/** Bullet origins: 0 centre; 1-4 corner pillars NW, NE, SE, SW; 5-8 edge pillars N, E, S, W (just outside the floor). */
export const SPIRE_ORIGINS: readonly Tile[] = [
  { x: 77, z: 62 },
  { x: 69, z: 54 }, { x: 85, z: 54 }, { x: 85, z: 70 }, { x: 69, z: 70 },
  { x: 77, z: 54 }, { x: 85, z: 62 }, { x: 77, z: 70 }, { x: 69, z: 62 },
];
/** Fans aim here when no member can be targeted. */
export const SPIRE_DEFAULT_AIM: Tile = { x: 77, z: 69 };
/** Standable tiles with 3 <= Chebyshev <= 7 of the centre, in row order (z, then x): 200 tiles. */
export const SPIRE_STAR_TILES: readonly Tile[] = (() => {
  const out: Tile[] = [];
  for (let z = SPIRE_FLOOR.z0; z <= SPIRE_FLOOR.z1; z++) for (let x = SPIRE_FLOOR.x0; x <= SPIRE_FLOOR.x1; x++) {
    const d = Math.max(Math.abs(x - SPIRE_CENTRE.x), Math.abs(z - SPIRE_CENTRE.z));
    if (d >= 3 && spireStandable({ x, z })) out.push({ x, z });
  }
  return out;
})();
/** The render and evaluation box (the floor plus the pillar ring). */
export const SPIRE_BOX = { x0: 69, z0: 54, x1: 85, z1: 70 } as const;

export const SPIRE_MAX_PARTY = 4;
/** A Lobby run is deleted this many ticks after it opens. */
export const SPIRE_LOBBY_TICKS = 150;
/** Open lobbies at once; more are refused ("The Spire gate is crowded"). */
export const SPIRE_MAX_LOBBIES = 48;
export const SPIRE_INTRO_TICKS = 5;
export const SPIRE_TIME_LIMIT = 600;
export const SPIRE_ENRAGE_TICKS = 420;
/** Cleared/Failed runs linger this long for result cards, then are deleted. */
export const SPIRE_END_LINGER = 20;
/** Bullet damage by phase (index 1..4). */
export const SPIRE_DAMAGE = [0, 3, 3, 4, 5] as const;
export const SPIRE_ENRAGE_BONUS = 1;
export const SPIRE_IFRAME_TICKS = 2;
/** Court: auto-swing range (Chebyshev from the centre). */
export const SPIRE_RANGE = 4;
export const SPIRE_SWING_TICKS = 4;
export const SPIRE_STAR_PERIOD = 12;
export const SPIRE_STAR_DAMAGE = 15;
export const SPIRE_STAR_PREVIEW = 2;
export const SPIRE_MIN_STARS = 3;
/** HP after a knockout eject. */
export const SPIRE_KO_HP = 10;
export const SPIRE_MEALS = 6;
/** Away grace (ticks) before an away member is Left, and before a whole-party absence is Abandoned. */
export const SPIRE_AWAY_TICKS = 50;

export const SPIRE_REWARD: { items: readonly { itemId: string; quantity: number }[]; fightingXp: 100; crown: 13; pendant: 14 } = {
  items: [{ itemId: 'berry_goldberry', quantity: 4 }, { itemId: 'prism_shard', quantity: 1 }],
  fightingXp: 100,
  crown: 13,
  pendant: 14,
};
export const SPIRE_BOSS_NAME = 'The Shardmother';
export const SPIRE_PHASE_NAMES: readonly string[] = ['', 'bloom', 'gale', 'shatter', 'nightfall'];

export interface SpirePatternDef {
  kind: number;
  key: string;
  name: string;
  phase: 1 | 2 | 3 | 4;
  /** Ticks until the next pattern is published. */
  duration: number;
  /** Fans aimed at a member. */
  aimed: boolean;
  /** Geometry depends on seed6 (gaps, spin, spirals). */
  seeded: boolean;
}
/** Index = kind (section 3.8). */
export const SPIRE_PATTERNS: readonly SpirePatternDef[] = [
  { kind: 0, key: 'petal_ring', name: 'Petal Ring', phase: 1, duration: 16, aimed: false, seeded: false },
  { kind: 1, key: 'glint', name: 'Glint', phase: 1, duration: 12, aimed: true, seeded: false },
  { kind: 2, key: 'tidewall', name: 'Tidewall', phase: 1, duration: 21, aimed: false, seeded: true },
  { kind: 3, key: 'crosswind', name: 'Crosswind', phase: 2, duration: 21, aimed: true, seeded: true },
  { kind: 4, key: 'lattice', name: 'Lattice', phase: 2, duration: 22, aimed: true, seeded: false },
  { kind: 5, key: 'drizzle', name: 'Drizzle', phase: 2, duration: 30, aimed: true, seeded: true },
  { kind: 6, key: 'glass_sheet', name: 'Glass Sheet', phase: 3, duration: 25, aimed: false, seeded: true },
  { kind: 7, key: 'cage', name: 'Cage', phase: 3, duration: 23, aimed: false, seeded: true },
  { kind: 8, key: 'maelstrom', name: 'Maelstrom', phase: 3, duration: 26, aimed: false, seeded: true },
  { kind: 9, key: 'eclipse', name: 'Eclipse', phase: 4, duration: 27, aimed: true, seeded: true },
  { kind: 10, key: 'shardstorm', name: 'Shardstorm', phase: 4, duration: 30, aimed: false, seeded: true },
];
export const SPIRE_POOLS: Readonly<Record<1 | 2 | 3 | 4, readonly number[]>> = { 1: [0, 1, 2], 2: [3, 4, 5], 3: [6, 7, 8], 4: [9, 10] };


// ---- Pattern geometry (section 3.5, 3.8; ported from proto-final/patterns.mjs) ----------------------------------

/** Half-width of the floor in the relative frame u = x - 77, v = z - 62. */
const R = 7;
const CX = SPIRE_CENTRE.x, CZ = SPIRE_CENTRE.z;
/** SPIRE_ORIGINS in the relative frame. */
const ORIGINS_REL: readonly (readonly [number, number])[] = SPIRE_ORIGINS.map((o) => [o.x - CX, o.z - CZ] as const);
const ALL16: readonly number[] = Array.from({ length: 16 }, (_, i) => i);
const SIDE_N = 0, SIDE_E = 1, SIDE_S = 2, SIDE_W = 3;

/** Relative lane of a gap's first tile: -7 + (x mod (16 - w)), in -7 .. 8 - w. */
export function spireGapStart(x: number, w: number): number {
  const m = 2 * R + 2 - w;
  return -R + (((x % m) + m) % m);
}

/** Quarter turns of the non-fan geometry: mix32(seed6, 81) & 3. */
export function spireSpin(seed6: number): number {
  return mix32(seed6, 81) & 3;
}

/** Collects packed bullets [F, ox, oz, dx, dz, q] in the relative frame (F relative to the pattern start). */
class Volley {
  readonly out: number[] = [];
  push(F: number, ou: number, ov: number, dx: number, dz: number, q: number): void {
    this.out.push(F, ou, ov, dx, dz, q);
  }
  /** RING(o, q, mask): inward rays only for the pillars (o != 0); masks and origins turned by `spin`. */
  ring(F: number, o: number, q: number, mask: readonly number[] = ALL16, spin = 0): void {
    const [ou, ov] = quarterTurn(ORIGINS_REL[o][0], ORIGINS_REL[o][1], spin);
    for (const i0 of mask) {
      const [dx, dz] = D16[(i0 + 4 * spin) & 15];
      if (o !== 0 && dx * -ou + dz * -ov <= 0) continue;
      this.push(F, ou, ov, dx, dz, q);
    }
  }
  /** WALL(side, g, w): lanes -7..7 except the gap [g, g + w - 1], entering from outside the floor at 1 tile per tick. */
  wall(F: number, side: number, g: number, w: number, spin: number): void {
    const s = (side + spin) & 3;
    for (let c = -R; c <= R; c++) {
      if (c >= g && c < g + w) continue;
      if (s === SIDE_N) this.push(F, c, -R - 1, 0, 1, 1);
      else if (s === SIDE_E) this.push(F, R + 1, c, -1, 0, 1);
      else if (s === SIDE_S) this.push(F, c, R + 1, 0, -1, 1);
      else this.push(F, -R - 1, c, 1, 0, 1);
    }
  }
  /** SHEET(side, rows, w, every, u): a curtain of walls whose w-wide corridor drifts at most one lane per row. */
  sheet(F0: number, side: number, rows: number, w: number, every: number, u: number, spin: number): void {
    let g = spireGapStart(mix32(u, 99), w);
    for (let r = 0; r < rows; r++) {
      if (r > 0) g = Math.max(-R, Math.min(R + 1 - w, g + (mix32(u, r) % 3) - 1));
      this.wall(F0 + r * every, side, g, w, spin);
    }
  }
  /** FAN(spreads): from the centre at 2 tiles per tick; the centre ray passes through the aim tile. */
  fan(F: number, aim: Vec, spreads: readonly number[]): void {
    for (const s of spreads) {
      const [dx, dz] = turnBy(aim, s);
      this.push(F, 0, 0, dx, dz, 2);
    }
  }
}

function buildPattern(kind: number, s: number, aim: Vec, k: number): number[] {
  const v = new Volley();
  switch (kind) {
    case 0: // petal_ring
      v.ring(2, 0, 1); v.ring(4, 0, 2); v.ring(6, 0, 1); v.ring(8, 0, 2); v.ring(10, 0, 1);
      break;
    case 1: // glint
      for (const F of [2, 4, 6, 8, 10]) v.fan(F, aim, [-2, -1, 0, 1, 2]);
      break;
    case 2: // tidewall
      v.wall(2, SIDE_N, spireGapStart(s, 3), 3, k);
      v.wall(7, SIDE_S, spireGapStart(mix32(s, 1), 3), 3, k);
      v.ring(10, 0, 2);
      break;
    case 3: // crosswind
      v.wall(2, SIDE_N, spireGapStart(s, 3), 3, k);
      v.wall(7, SIDE_W, spireGapStart(mix32(s, 2), 3), 3, k);
      v.fan(11, aim, [-1, 0, 1]);
      break;
    case 4: // lattice
      v.ring(2, 0, 1);
      for (const o of [1, 2, 3, 4]) v.ring(4, o, 1);
      v.ring(6, 0, 1);
      for (const o of [1, 2, 3, 4]) v.ring(8, o, 1);
      v.fan(10, aim, [-1, 0, 1]);
      break;
    case 5: // drizzle
      v.sheet(2, SIDE_N, 8, 4, 2, s, k);
      v.fan(5, aim, [-1, 0, 1]);
      v.fan(11, aim, [-1, 0, 1]);
      break;
    case 6: // glass_sheet
      v.sheet(2, SIDE_N, 10, 3, 1, s, k);
      break;
    case 7: { // cage
      const n = spireGapStart(s, 3), m = spireGapStart(mix32(s, 3), 3);
      v.wall(2, SIDE_N, n, 3, k); v.wall(2, SIDE_S, n, 3, k); v.wall(9, SIDE_W, m, 3, k); v.wall(9, SIDE_E, m, 3, k);
      break;
    }
    case 8: // maelstrom
      for (let i = 0; i < 12; i++) v.ring(2 + i, 0, 1, [0, 4, 8, 12].map((j) => (s + 2 * i + j) & 15), k);
      v.sheet(4, SIDE_W, 5, 4, 2, mix32(s, 5), k);
      break;
    case 9: // eclipse
      v.sheet(2, SIDE_N, 12, 3, 1, s, k);
      for (const F of [4, 7, 10, 13]) v.fan(F, aim, [-1, 0, 1]);
      break;
    case 10: // shardstorm
      v.sheet(2, SIDE_N, 8, 3, 1, s, k);
      v.sheet(9, SIDE_W, 8, 3, 1, mix32(s, 11), k);
      break;
    default:
      break;
  }
  return v.out;
}

/**
 * Packed bullets of one instance, never memoized: absolute tiles, F = start + offset. Unknown kinds give no bullets
 * (clients draw nothing for them). An aim on the centre itself (never standable) falls back to SPIRE_DEFAULT_AIM.
 * `spin` defaults to spireSpin(seed6); tests override it to check what the spin turns.
 */
export function spireBuildPattern(kind: number, start: number, seed6: number, aimX: number, aimZ: number, spin = spireSpin(seed6 & 63)): Int32Array {
  let au = aimX - CX, av = aimZ - CZ;
  if (au === 0 && av === 0) { au = SPIRE_DEFAULT_AIM.x - CX; av = SPIRE_DEFAULT_AIM.z - CZ; }
  const rel = buildPattern(kind, seed6 & 63, [au, av], spin & 3);
  const out = new Int32Array(rel.length);
  for (let o = 0; o < rel.length; o += BULLET_STRIDE) {
    out[o] = rel[o] + start;
    out[o + 1] = rel[o + 1] + CX;
    out[o + 2] = rel[o + 2] + CZ;
    out[o + 3] = rel[o + 3];
    out[o + 4] = rel[o + 4];
    out[o + 5] = rel[o + 5];
  }
  return out;
}

const MEMO_CAP = 256;
const patternMemo = new Map<string, Int32Array>();
const memoPut = <V>(m: Map<string, V>, k: string, v: V): V => {
  if (m.size >= MEMO_CAP) m.delete(m.keys().next().value as string);
  m.set(k, v);
  return v;
};

/**
 * Absolute packed bullets of one pattern instance (memoized by kind, start, seed6 and aim; cap 256 entries; P = start).
 * The returned array is shared: callers must not mutate it.
 */
export function spirePatternBullets(kind: number, start: number, seed6: number, aimX: number, aimZ: number): Int32Array {
  const key = `${kind},${start},${seed6},${aimX},${aimZ}`;
  return patternMemo.get(key) ?? memoPut(patternMemo, key, spireBuildPattern(kind, start, seed6, aimX, aimZ));
}

export interface SpireFightLike {
  hp: number; maxHp: number; phase: number; seed: number; patternCount: number;
  curKind: number; curStart: number; curSeed: number; curAimX: number; curAimZ: number;
  prevKind: number; prevStart: number; prevSeed: number; prevAimX: number; prevAimZ: number;
  starWave: number; starMask: number;
  hitTick0: number; hitTick1: number; hitTick2: number; hitTick3: number;
  hits0: number; hits1: number; hits2: number; hits3: number;
  stars0: number; stars1: number; stars2: number; stars3: number;
  dmg0: number; dmg1: number; dmg2: number; dmg3: number;
  /** Reserved (no downed state in this release): always 0. */
  downs0: number; downs1: number; downs2: number; downs3: number;
}
export interface SpireRunLike {
  id: bigint; stage: number; outcome: number; mode: number; isPublic: boolean; rules: number; partySize: number;
  createdTick: number; queuedTick: number; startTick: number; endTick: number; phase: number; clearTicks: number;
}
export interface SpireMemberLike {
  runId: bigint; slot: number; state: number; joinedTick: number; awaySinceTick: number; awayCount: number;
  downUntilTick: number; reviveSinceTick: number; meals: number;
}
export type SpireSlotField = 'hitTick' | 'hits' | 'stars' | 'dmg' | 'downs';

const U8_FIELDS: ReadonlySet<SpireSlotField> = new Set(['hits', 'stars', 'downs']);
const U32_MAX = 0xffffffff;
const validSlot = (slot: number) => Number.isInteger(slot) && slot >= 0 && slot < SPIRE_MAX_PARTY;
type SlotKey = `${SpireSlotField}${0 | 1 | 2 | 3}`;

/** The per-slot column `${k}${slot}`; 0 for a slot outside 0..3. */
export function spireSlot(f: SpireFightLike, k: SpireSlotField, slot: number): number {
  return validSlot(slot) ? f[`${k}${slot}` as SlotKey] : 0;
}

/** Returns a copy with the slot column set; u8 fields (hits, stars, downs) saturate at 255, every value is clamped >= 0. */
export function withSpireSlot<F extends SpireFightLike>(f: F, k: SpireSlotField, slot: number, value: number): F {
  if (!validSlot(slot)) return { ...f };
  const v = Math.min(U8_FIELDS.has(k) ? 255 : U32_MAX, Math.max(0, Math.floor(value)));
  return { ...f, [`${k}${slot}`]: v };
}

/** Saturating +1 on a u8 member counter ('awayCount' | 'meals'); returns a copy. */
export function spireMemberBump<M extends SpireMemberLike>(m: M, k: 'awayCount' | 'meals'): M {
  return { ...m, [k]: Math.min(255, Math.max(0, m[k]) + 1) };
}

const fightMemo = new Map<string, Int32Array>();

/** prev (if any) then cur, memoized (the array is shared: callers must not mutate it). */
export function spireFightBullets(f: SpireFightLike): Int32Array {
  const hasPrev = f.prevKind !== SPIRE_NONE, hasCur = f.curKind !== SPIRE_NONE;
  const key = `${hasPrev ? `${f.prevKind},${f.prevStart},${f.prevSeed},${f.prevAimX},${f.prevAimZ}` : '-'}|${
    hasCur ? `${f.curKind},${f.curStart},${f.curSeed},${f.curAimX},${f.curAimZ}` : '-'}`;
  const hit = fightMemo.get(key);
  if (hit) return hit;
  const a = hasPrev ? spirePatternBullets(f.prevKind, f.prevStart, f.prevSeed, f.prevAimX, f.prevAimZ) : EMPTY;
  const b = hasCur ? spirePatternBullets(f.curKind, f.curStart, f.curSeed, f.curAimX, f.curAimZ) : EMPTY;
  const out = new Int32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return memoPut(fightMemo, key, out);
}
const EMPTY = new Int32Array(0);

/** Earliest half-step (1 or 2) at which a bullet hits the move (p0, p1, p2) in tick T, else 0 (section 3.6). */
export function spireHitsMove(bullets: Int32Array, T: number, p0: Tile, p1: Tile, p2: Tile): 0 | 1 | 2 {
  return bulletsHitMove(bullets, T, p0, p1, p2);
}

const standableXZ = (x: number, z: number) => spireStandable({ x, z });

/** Exact stationary danger of tick T on the standable floor (tile keys). */
export function spireDangerTiles(bullets: Int32Array, T: number): Set<number> {
  return bulletDangerKeys(bullets, T, standableXZ);
}

/** canonicalMiddle on the floor. */
export function spireMiddle(p0: Tile, p2: Tile, blocked: Set<number>): Tile {
  return canonicalMiddle(p0, p2, blocked);
}

// ---- Phases, damage, HP, seeds and the scheduler (section 3.7) ----------------------------------------------------

/** The phase the boss's HP and the elapsed fight time call for (the scheduler never lets the phase go back). */
export function spirePhaseFor(hp: number, maxHp: number, elapsed: number): 1 | 2 | 3 | 4 {
  if (elapsed >= SPIRE_ENRAGE_TICKS || hp * 20 <= maxHp * 3) return 4;
  if (hp * 10 <= maxHp * 4) return 3;
  if (hp * 10 <= maxHp * 7) return 2;
  return 1;
}

export function spireEnraged(startTick: number, T: number): boolean {
  return T - startTick >= SPIRE_ENRAGE_TICKS;
}

/** 3 / 3 / 4 / 5 by phase, +1 once enraged. */
export function spireBulletDamage(phase: number, enraged: boolean): number {
  const p = Math.min(4, Math.max(1, Math.floor(phase))) as 1 | 2 | 3 | 4;
  return SPIRE_DAMAGE[p] + (enraged ? SPIRE_ENRAGE_BONUS : 0);
}

/** spireHpBase + spireHpPerMember per member after the first (1000 / 1700 / 2400 / 3100 for 1-4 by default). */
export function spireMaxHp(cfg: BossConfigLike, members: number): number {
  return cfg.spireHpBase + cfg.spireHpPerMember * (Math.max(1, Math.min(SPIRE_MAX_PARTY, members)) - 1);
}

/** mix32(low 32 bits of the run id, startTick); never ctx.random. */
export function spireSeed(runId: bigint, startTick: number): number {
  return mix32(Number(runId & 0xffffffffn), startTick);
}

const durationOf = (kind: number) => SPIRE_PATTERNS[kind]?.duration ?? 0;

/** curKind === SPIRE_NONE || T >= curStart + duration. */
export function spirePatternDue(f: SpireFightLike, T: number): boolean {
  return f.curKind === SPIRE_NONE || !SPIRE_PATTERNS[f.curKind] || T >= f.curStart + durationOf(f.curKind);
}

/**
 * Publishes the next pattern at the end of tick T (section 3.7): the phase never decreases, the pool never repeats
 * curKind, fans aim at targets[k mod n] (present In members by slot, at their end tiles), cur shifts into prev.
 */
export function spireNextPattern<F extends SpireFightLike>(f: F, startTick: number, T: number, targets: readonly Tile[]): F {
  const k = f.patternCount + 1;
  const phase = Math.max(f.phase, spirePhaseFor(f.hp, f.maxHp, T - startTick)) as 1 | 2 | 3 | 4;
  const pool = SPIRE_POOLS[phase];
  let i = mix32(f.seed, 2 * k) % pool.length;
  if (pool[i] === f.curKind) i = (i + 1) % pool.length;
  const aim = targets.length ? targets[k % targets.length] : SPIRE_DEFAULT_AIM;
  return {
    ...f,
    phase,
    patternCount: k,
    prevKind: f.curKind, prevStart: f.curStart, prevSeed: f.curSeed, prevAimX: f.curAimX, prevAimZ: f.curAimZ,
    curKind: pool[i], curStart: T, curSeed: mix32(f.seed, 2 * k + 1) & 63, curAimX: aim.x, curAimZ: aim.z,
  };
}

/** curStart + duration(curKind) + 2: the last tick the published bullets can still hit (curStart when none). */
export function spireKnownUntil(f: SpireFightLike): number {
  return f.curKind === SPIRE_NONE || !SPIRE_PATTERNS[f.curKind] ? f.curStart : f.curStart + durationOf(f.curKind) + 2;
}

// ---- Stars, swings, court, immunity and rewards (sections 3.10-3.12) ----------------------------------------------

/** floor((T - startTick) / 12); -1 before startTick. */
export function spireStarWave(startTick: number, T: number): number {
  return T < startTick ? -1 : Math.floor((T - startTick) / SPIRE_STAR_PERIOD);
}

const STAR_SALT = 0x57a7;

/** The K stars of wave w: tiles of SPIRE_STAR_TILES at least 3 apart when 8 tries allow it. */
export function spireStars(seed: number, wave: number, K: number): Tile[] {
  const out: Tile[] = [];
  const base = mix32(seed, STAR_SALT);
  const n = SPIRE_STAR_TILES.length;
  for (let j = 0; j < K; j++) {
    let pick = SPIRE_STAR_TILES[0];
    for (let a = 0; a < 8; a++) {
      pick = SPIRE_STAR_TILES[mix32(base, wave * 64 + j * 8 + a) % n];
      if (out.every((o) => chebyshev(o, pick) >= 3)) break;
    }
    out.push({ x: pick.x, z: pick.z });
  }
  return out;
}

/** Slot s swings on ticks with (T - startTick) mod 4 == s, from startTick on. */
export function spireSwingDue(startTick: number, T: number, slot: number): boolean {
  return T >= startTick && (T - startTick) % SPIRE_SWING_TICKS === slot;
}

/** Standable tiles within Chebyshev SPIRE_RANGE of the centre (72 tiles). */
export function inSpireCourt(t: Tile): boolean {
  return spireStandable(t) && chebyshev(t, SPIRE_CENTRE) <= SPIRE_RANGE;
}

/** hitTick > 0 && T <= hitTick + 2. */
export function spireImmune(hitTick: number, T: number): boolean {
  return hitTick > 0 && T <= hitTick + SPIRE_IFRAME_TICKS;
}

/** >= 3 stars, Done or Out, online at the clear, normal mode. */
export function spireQualifies(stars: number, state: number, online: boolean, mode: number): boolean {
  return stars >= SPIRE_MIN_STARS && (state === SpireMemberState.Done || state === SpireMemberState.Out) && online
    && mode === SpireMode.Normal;
}

/** Done, never hit, never downed, never away. */
export function spireFlawless(f: SpireFightLike, slot: number, m: SpireMemberLike): boolean {
  return m.state === SpireMemberState.Done && validSlot(slot) && spireSlot(f, 'hits', slot) === 0
    && spireSlot(f, 'downs', slot) === 0 && m.awayCount === 0;
}

// ---- Safety table (backward induction over the known bullets) -----------------------------------------------------

export interface SpireSafety {
  from: number;
  lastDanger: number;
  /** End of tick T on t: a hit-free continuation exists for the known bullets. */
  winning(T: number, t: Tile): boolean;
  /** Moves in tick T + 1. */
  movesFrom(T: number, t: Tile): { mid: Tile; end: Tile; steps: 0 | 1 | 2; hit: 0 | 1 | 2; winning: boolean }[];
  /** End tiles for T + 1, T + 2, ... */
  path(start: Tile, T: number, maxTicks: number, prefer?: (t: Tile, tick: number) => number): Tile[];
}

const FW = SPIRE_FLOOR.x1 - SPIRE_FLOOR.x0 + 1, FH = SPIRE_FLOOR.z1 - SPIRE_FLOOR.z0 + 1;
const floorIdx = (t: Tile) => (t.z - SPIRE_FLOOR.z0) * FW + (t.x - SPIRE_FLOOR.x0);
const BOX_W = SPIRE_BOX.x1 - SPIRE_BOX.x0 + 1, BOX_H = SPIRE_BOX.z1 - SPIRE_BOX.z0 + 1;

interface FloorMoves { tiles: Tile[]; moves: (BulletMove[] | undefined)[]; stand: Uint8Array }
const movesCache = new WeakMap<Set<number>, FloorMoves>();

function floorMoves(blocked: Set<number>): FloorMoves {
  const hit = movesCache.get(blocked);
  if (hit) return hit;
  const stand = new Uint8Array(FW * FH);
  const ok = (t: Tile) => spireStandable(t) && !blocked.has(tileKey(t));
  const tiles: Tile[] = [];
  for (let z = SPIRE_FLOOR.z0; z <= SPIRE_FLOOR.z1; z++) for (let x = SPIRE_FLOOR.x0; x <= SPIRE_FLOOR.x1; x++) {
    if (ok({ x, z })) { stand[floorIdx({ x, z })] = 1; tiles.push({ x, z }); }
  }
  const moves: (BulletMove[] | undefined)[] = new Array(FW * FH);
  for (const t of tiles) moves[floorIdx(t)] = movesWithin(t, ok);
  const fm = { tiles, moves, stand };
  movesCache.set(blocked, fm);
  return fm;
}

/** The last tick at which any bullet sample (start, middle or end) can exist. */
function lastBulletTick(bullets: Int32Array): number {
  let last = -1;
  for (let o = 0; o < bullets.length; o += BULLET_STRIDE) last = Math.max(last, bullets[o] + BULLET_LIFE_HALF_STEPS / 2 + 1);
  return last;
}

/**
 * Backward induction over the known bullets from `fromTick` to their last danger (one build per pattern rotation).
 * `blocked` is the world's blocked set (the dais and nothing else on the floor today); moves never leave the floor.
 */
export function spireSafety(bullets: Int32Array, fromTick: number, blocked: Set<number>): SpireSafety {
  const fm = floorMoves(blocked);
  const lastLife = lastBulletTick(bullets);
  const grids = new Map<number, BulletGrid>();
  const gridAt = (T: number): BulletGrid | null => {
    if (T > lastLife) return null;
    let g = grids.get(T);
    if (!g) { g = new BulletGrid(SPIRE_BOX.x0, SPIRE_BOX.z0, BOX_W, BOX_H).build(bullets, T); grids.set(T, g); }
    return g;
  };
  let lastDanger = fromTick;
  for (let T = fromTick + 1; T <= lastLife; T++) {
    const g = gridAt(T)!;
    if (fm.tiles.some((t) => g.dangerAt(t.x, t.z))) lastDanger = T;
  }
  for (const T of [...grids.keys()]) if (T > lastDanger + 1) grids.delete(T);
  // win[T - fromTick][floorIdx] for T in fromTick..lastDanger
  const win: Uint8Array[] = [];
  win[lastDanger - fromTick] = fm.stand.slice();
  for (let T = lastDanger - 1; T >= fromTick; T--) {
    const next = win[T + 1 - fromTick], cur = new Uint8Array(FW * FH), g = gridAt(T + 1);
    for (const t of fm.tiles) {
      for (const m of fm.moves[floorIdx(t)]!) {
        if (!next[floorIdx(m.end)] || (g && g.hits(t, m.mid, m.end))) continue;
        cur[floorIdx(t)] = 1;
        break;
      }
    }
    win[T - fromTick] = cur;
  }
  const standableHere = (t: Tile) => inSpireFloor(t) && fm.stand[floorIdx(t)] === 1;
  const winning = (T: number, t: Tile): boolean => {
    if (!standableHere(t) || T < fromTick) return false;
    if (T >= lastDanger) return true;
    return win[T - fromTick][floorIdx(t)] === 1;
  };
  const movesFrom = (T: number, t: Tile) => {
    if (!standableHere(t)) return [];
    const g = gridAt(T + 1);
    return fm.moves[floorIdx(t)]!.map((m) => ({
      mid: { x: m.mid.x, z: m.mid.z }, end: { x: m.end.x, z: m.end.z }, steps: m.steps,
      hit: g ? g.hits(t, m.mid, m.end) : 0 as 0 | 1 | 2,
      winning: winning(T + 1, m.end),
    }));
  };
  const path = (start: Tile, T: number, maxTicks: number, prefer?: (t: Tile, tick: number) => number): Tile[] => {
    const out: Tile[] = [];
    let at = start;
    for (let i = 0; i < maxTicks; i++) {
      const tick = T + i;
      const ms = movesFrom(tick, at);
      if (!ms.length) break;
      const pool = ms.filter((m) => !m.hit && m.winning);
      const cands = pool.length ? pool : ms.filter((m) => !m.hit);
      let best = cands.length ? cands[0] : ms[0];
      if (prefer && cands.length > 1) {
        let bs = prefer(best.end, tick + 1);
        for (const m of cands) { const s = prefer(m.end, tick + 1); if (s < bs) { bs = s; best = m; } }
      }
      at = best.end;
      out.push(at);
    }
    return out;
  };
  return { from: fromTick, lastDanger, winning, movesFrom, path };
}
