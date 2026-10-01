/**
 * F3 "The Giant": a PvE world boss in the Boulders. Pure rules shared by the
 * SpacetimeDB module (authoritative) and the client (telegraphs, HP bar).
 *
 * Open to every player, with or without the combat grant: hitting it never
 * ends grace and never makes you hostile to players. It fights back with slow,
 * telegraphed attacks aimed at tiles, so a player who walks out of the marked
 * area in time takes nothing.
 *
 * The row is written only on transitions (wind-up, slam, recover end, defeat,
 * respawn) and on landed swings. Idle regeneration is computed lazily from
 * `lastHitTick` (like the training dummy), so an unengaged Giant costs the tick
 * one primary-key lookup and nothing else.
 */
import { SWING_INTERVAL_TICKS } from './constants';
import { chebyshev } from './grid';
import { OBSIDIAN_ITEM_ID } from './items';
import type { Tile } from './types';

export const GIANT_ID = 1;
/** Centre of the Giant's 3x3 footprint, in the Boulders' south-east block. */
export const GIANT_TILE: Tile = { x: 57, z: 57 };
/** Footprint radius: the Giant blocks the 3x3 tiles around its centre. */
export const GIANT_FOOTPRINT = 1;
/** A swing lands from any tile touching the footprint (Chebyshev 2 from the centre). */
export const GIANT_REACH = GIANT_FOOTPRINT + 1;
/** HP pool, shared by everyone: a lone club takes about 2 minutes, four clubs about 30 s. */
export const GIANT_MAX_HP = 400;
/** It notices players in the Boulders within this Chebyshev distance of its centre. */
export const GIANT_AGGRO_RANGE = 8;
/** Ticks between the telegraph appearing and the blow landing (1.8 s: 6 tiles of walking). */
export const GIANT_SLAM_WINDUP_TICKS = 3;
/** The stomp (every third attack) has a longer, bigger telegraph (2.4 s). */
export const GIANT_STOMP_WINDUP_TICKS = 4;
/** Ticks it stands catching its breath after an attack: the window to hit back freely. */
export const GIANT_RECOVER_TICKS = 3;
/** Slam: the 3x3 tiles around the targeted player's tile. */
export const GIANT_SLAM_RADIUS = 1;
/** Stomp: everything within 3 of its centre, i.e. everyone in reach; step 2 tiles back. */
export const GIANT_STOMP_RADIUS = 3;
export const GIANT_SLAM_DAMAGE = 9;
export const GIANT_STOMP_DAMAGE = 6;
/** Every third attack is a stomp. */
export const GIANT_STOMP_EVERY = 3;
/** After a defeat it is back in 5 minutes. */
export const GIANT_RESPAWN_TICKS = 500;
/** Pre-raid idle regeneration delay. No longer applied (raids have no regen); kept for the client's render tick cap. */
export const GIANT_REGEN_IDLE_TICKS = 100;
/** Damage dealt (this life) to share in the reward: two club blows or three stick blows. */
export const GIANT_MIN_CONTRIBUTION = 16;
/** Every qualifying contributor gets the same reward: equal, whoever dealt the most. */
export const GIANT_REWARD: { itemId: string; quantity: number } = { itemId: OBSIDIAN_ITEM_ID, quantity: 3 };

/** `giant.state` on the wire (u8). */
/** Asleep: between scheduled raids (shared/sim/raid.ts); cannot be attacked. */
export const GiantState = { Idle: 0, Windup: 1, Recover: 2, Defeated: 3, Asleep: 4 } as const;
export type GiantState = (typeof GiantState)[keyof typeof GiantState];
/** `giant.attack` on the wire (u8). */
export const GiantAttack = { Slam: 0, Stomp: 1 } as const;
export type GiantAttack = (typeof GiantAttack)[keyof typeof GiantAttack];
/**
 * `giant_event.kind` on the wire (u8). Raid kinds: Announce (quantity = minutes to the wake), Wake (hp = raid HP,
 * quantity = players counted), Sleep (quantity = shared/sim RaidOutcome).
 */
export const GiantEventKind = { Hit: 0, Windup: 1, Slam: 2, PlayerHit: 3, Defeat: 4, Reward: 5, Respawn: 6, Announce: 7, Wake: 8, Sleep: 9 } as const;
export type GiantEventKind = (typeof GiantEventKind)[keyof typeof GiantEventKind];

export interface GiantRowLike extends Tile {
  hp: number;
  maxHp: number;
  state: number;
  attack: number;
  stateUntilTick: number;
  slamX: number;
  slamZ: number;
  attackCount: number;
  respawnTick: number;
  lastHitTick: number;
}

/** A fresh Giant (seeding and respawn). */
export function freshGiant(tick: number): Omit<GiantRowLike, never> {
  return {
    x: GIANT_TILE.x, z: GIANT_TILE.z, hp: GIANT_MAX_HP, maxHp: GIANT_MAX_HP,
    state: GiantState.Idle, attack: GiantAttack.Slam, stateUntilTick: tick,
    slamX: GIANT_TILE.x, slamZ: GIANT_TILE.z, attackCount: 0, respawnTick: 0, lastHitTick: tick,
  };
}

/** Tiles the Giant blocks (always: a defeated Giant leaves a rubble mound). */
export function giantFootprint(center: Tile = GIANT_TILE): Tile[] {
  const out: Tile[] = [];
  for (let dz = -GIANT_FOOTPRINT; dz <= GIANT_FOOTPRINT; dz++) {
    for (let dx = -GIANT_FOOTPRINT; dx <= GIANT_FOOTPRINT; dx++) out.push({ x: center.x + dx, z: center.z + dz });
  }
  return out;
}

export function inGiantReach(t: Tile, g: Tile = GIANT_TILE): boolean {
  return chebyshev(t, g) <= GIANT_REACH;
}

/** HP at `tick`: 0 defeated, full asleep; during a raid exactly the row's HP (no idle regeneration since scheduled raids). */
export function giantHpAt(g: Pick<GiantRowLike, 'hp' | 'maxHp' | 'state' | 'lastHitTick'>, tick: number): number {
  if (g.state === GiantState.Defeated) return 0;
  if (g.state === GiantState.Asleep) return g.maxHp;
  // Awake means a scheduled raid (shared/sim/raid.ts): no idle regeneration, the raid window is the limit.
  return g.hp;
}

/** Whether old contributions no longer count. Always false since scheduled raids: a raid never regenerates or forgets. */
export function giantForgot(g: Pick<GiantRowLike, 'hp' | 'maxHp' | 'state' | 'lastHitTick'>, tick: number): boolean {
  // Raids never forget contributions mid-fight (no idle regeneration); kept for callers.
  void g; void tick;
  return false;
}

export function attackRadius(attack: number): number {
  return attack === GiantAttack.Stomp ? GIANT_STOMP_RADIUS : GIANT_SLAM_RADIUS;
}

export function attackDamage(attack: number): number {
  return attack === GiantAttack.Stomp ? GIANT_STOMP_DAMAGE : GIANT_SLAM_DAMAGE;
}

/** Whether `t` is inside the marked area of the Giant's current (or last) attack. */
export function inAttackArea(t: Tile, g: Pick<GiantRowLike, 'attack' | 'slamX' | 'slamZ'>): boolean {
  return chebyshev(t, { x: g.slamX, z: g.slamZ }) <= attackRadius(g.attack);
}

export interface GiantCandidate extends Tile {
  /** Stable tie-break (the tick's player order). */
  order: number;
}

/** The nearest candidate within aggro range, ties by order. Candidates are alive players in the Boulders. */
export function chooseGiantTarget(g: Tile, candidates: readonly GiantCandidate[]): GiantCandidate | null {
  let best: GiantCandidate | null = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = chebyshev(c, g);
    if (d > GIANT_AGGRO_RANGE) continue;
    if (d < bestD || (d === bestD && best && c.order < best.order)) { best = c; bestD = d; }
  }
  return best;
}

export interface GiantStep<R> {
  /** The new row, or null when nothing changed (no write). */
  next: R | null;
  /** The blow that lands this tick: everyone alive inside it takes `damage`. */
  blow?: { x: number; z: number; radius: number; damage: number; attack: number };
  windup?: boolean;
  respawned?: boolean;
}

/**
 * One tick of the Giant's AI (not the players' swings). Idle → (a target in
 * range) → Windup (telegraph at a tile) → the blow lands → Recover → Idle or the
 * next Windup. Defeated → respawn after GIANT_RESPAWN_TICKS.
 */
export function stepGiant<R extends GiantRowLike>(g: R, T: number, candidates: readonly GiantCandidate[]): GiantStep<R> {
  if (g.state === GiantState.Asleep) return { next: null };
  if (g.state === GiantState.Defeated) {
    if (T < g.respawnTick) return { next: null };
    return { next: { ...g, ...freshGiant(T), x: g.x, z: g.z }, respawned: true };
  }
  if (g.state === GiantState.Windup) {
    if (T < g.stateUntilTick) return { next: null };
    return {
      next: { ...g, state: GiantState.Recover, stateUntilTick: T + GIANT_RECOVER_TICKS },
      blow: { x: g.slamX, z: g.slamZ, radius: attackRadius(g.attack), damage: attackDamage(g.attack), attack: g.attack },
    };
  }
  if (g.state === GiantState.Recover && T < g.stateUntilTick) return { next: null };
  const target = chooseGiantTarget(g, candidates);
  if (!target) {
    return g.state === GiantState.Idle ? { next: null } : { next: { ...g, state: GiantState.Idle, stateUntilTick: T } };
  }
  const stomp = (g.attackCount + 1) % GIANT_STOMP_EVERY === 0;
  const attack = stomp ? GiantAttack.Stomp : GiantAttack.Slam;
  return {
    next: {
      ...g,
      state: GiantState.Windup,
      attack,
      slamX: stomp ? g.x : target.x,
      slamZ: stomp ? g.z : target.z,
      stateUntilTick: T + (stomp ? GIANT_STOMP_WINDUP_TICKS : GIANT_SLAM_WINDUP_TICKS),
      attackCount: g.attackCount + 1,
    },
    windup: true,
  };
}

/** One landed swing. `defeated` when this blow floors it. */
export function giantAfterHit(g: Pick<GiantRowLike, 'hp' | 'maxHp' | 'state' | 'lastHitTick'>, damage: number, tick: number): { hp: number; defeated: boolean } {
  const hp = Math.max(0, giantHpAt(g, tick) - damage);
  return { hp, defeated: hp === 0 };
}

/** Who shares the reward: everyone whose damage this life reached GIANT_MIN_CONTRIBUTION. */
export function giantRewardees<T extends { damage: number }>(contributions: readonly T[]): T[] {
  return contributions.filter((c) => c.damage >= GIANT_MIN_CONTRIBUTION);
}

/** Rough solo kill time in seconds for a weapon damage (for docs and the agent API). */
export function giantSoloSeconds(damage: number, tickMs = 600): number {
  return Math.ceil(GIANT_MAX_HP / damage) * SWING_INTERVAL_TICKS * tickMs / 1000;
}
