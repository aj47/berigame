/**
 * The Sunken Spire (FINAL_SPEC section 3; CORE_SCOPE cuts: no practice runs,
 * no private lobbies, kick or queue, no downed/revive). Pure, deterministic:
 * patterns, the scheduler, stars, collision wrappers and the safety table.
 *
 * WP0 stub: every exported constant, enum and type is final; the logic is
 * filled in by WP1 (functions throw until then).
 */
import type { BossConfigLike } from './bossConfig';
import { SPIRE_CENTRE, SPIRE_FLOOR, spireStandable } from './bossZones';
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

const todo = (name: string): never => { throw new Error(`not implemented: ${name}`); };

/** Relative lane of a gap's first tile: -7 + (x mod (16 - w)), in -7 .. 8 - w. */
export function spireGapStart(x: number, w: number): number { return todo(`spireGapStart(${x},${w})`); }
/** Quarter turns of the non-fan geometry: mix32(seed6, 81) & 3. */
export function spireSpin(seed6: number): number { return todo(`spireSpin(${seed6})`); }
/** Absolute packed bullets of one pattern instance (memoized by kind, seed6, aim; cap 256 entries; P = start). */
export function spirePatternBullets(kind: number, start: number, seed6: number, aimX: number, aimZ: number): Int32Array {
  return todo(`spirePatternBullets(${kind},${start},${seed6},${aimX},${aimZ})`);
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

export function spireSlot(f: SpireFightLike, k: SpireSlotField, slot: number): number { return todo(`spireSlot(${k},${slot})`); }
/** Returns a copy with the slot column set; u8 fields (hits, stars, downs) saturate at 255, every value is clamped >= 0. */
export function withSpireSlot<F extends SpireFightLike>(f: F, k: SpireSlotField, slot: number, value: number): F {
  return todo(`withSpireSlot(${k},${slot},${value})`);
}
/** Saturating +1 on a u8 member counter ('awayCount' | 'meals'); returns a copy. */
export function spireMemberBump<M extends SpireMemberLike>(m: M, k: 'awayCount' | 'meals'): M { return todo(`spireMemberBump(${k})`); }
/** prev (if any) then cur, memoized. */
export function spireFightBullets(f: SpireFightLike): Int32Array { return todo('spireFightBullets'); }
export function spireHitsMove(bullets: Int32Array, T: number, p0: Tile, p1: Tile, p2: Tile): 0 | 1 | 2 { return todo(`spireHitsMove(${T})`); }
/** Exact stationary danger of tick T on the standable floor (tile keys). */
export function spireDangerTiles(bullets: Int32Array, T: number): Set<number> { return todo(`spireDangerTiles(${T})`); }
/** canonicalMiddle on the floor. */
export function spireMiddle(p0: Tile, p2: Tile, blocked: Set<number>): Tile { return todo('spireMiddle'); }
export function spirePhaseFor(hp: number, maxHp: number, elapsed: number): 1 | 2 | 3 | 4 { return todo(`spirePhaseFor(${hp},${maxHp},${elapsed})`); }
export function spireEnraged(startTick: number, T: number): boolean { return todo(`spireEnraged(${startTick},${T})`); }
export function spireBulletDamage(phase: number, enraged: boolean): number { return todo(`spireBulletDamage(${phase},${enraged})`); }
export function spireMaxHp(cfg: BossConfigLike, members: number): number { return todo(`spireMaxHp(${members})`); }
export function spireSeed(runId: bigint, startTick: number): number { return todo(`spireSeed(${runId},${startTick})`); }
/** curKind === SPIRE_NONE || T >= curStart + duration. */
export function spirePatternDue(f: SpireFightLike, T: number): boolean { return todo(`spirePatternDue(${T})`); }
export function spireNextPattern<F extends SpireFightLike>(f: F, startTick: number, T: number, targets: readonly Tile[]): F {
  return todo(`spireNextPattern(${startTick},${T},${targets.length})`);
}
/** curStart + duration(curKind) + 2. */
export function spireKnownUntil(f: SpireFightLike): number { return todo('spireKnownUntil'); }
/** -1 before startTick. */
export function spireStarWave(startTick: number, T: number): number { return todo(`spireStarWave(${startTick},${T})`); }
export function spireStars(seed: number, wave: number, K: number): Tile[] { return todo(`spireStars(${seed},${wave},${K})`); }
export function spireSwingDue(startTick: number, T: number, slot: number): boolean { return todo(`spireSwingDue(${startTick},${T},${slot})`); }
export function inSpireCourt(t: Tile): boolean { return todo(`inSpireCourt(${t.x},${t.z})`); }
/** hitTick > 0 && T <= hitTick + 2. */
export function spireImmune(hitTick: number, T: number): boolean { return todo(`spireImmune(${hitTick},${T})`); }
export function spireQualifies(stars: number, state: number, online: boolean, mode: number): boolean {
  return todo(`spireQualifies(${stars},${state},${online},${mode})`);
}
export function spireFlawless(f: SpireFightLike, slot: number, m: SpireMemberLike): boolean { return todo(`spireFlawless(${slot},${m.state})`); }

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
/** Backward induction over the known bullets from `fromTick` to their last danger (one build per pattern rotation). */
export function spireSafety(bullets: Int32Array, fromTick: number, blocked: Set<number>): SpireSafety {
  return todo(`spireSafety(${bullets.length},${fromTick},${blocked.size})`);
}
