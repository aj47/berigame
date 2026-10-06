/**
 * Clatterhorn, the overworld boss of Clatterhorn's Glade (FINAL_SPEC
 * section 2): lanes, the pure step function, the swarm, telegraphs and
 * reward qualification.
 *
 * WP0 stub: every exported constant, enum and type is final; the logic is
 * filled in by WP2 (functions throw until then).
 */
import type { BossConfigLike } from './bossConfig';
import type { Vec } from './bullets';
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

/** Charge telegraph lead by phase (index 1..3). */
export const CLATTER_CHARGE_WINDUP = [0, 4, 3, 3] as const;
export const CLATTER_SPIN_WINDUP = 3;
export const CLATTER_DRUM_WINDUP = 3;
/** After a Skid/Glance with no chain left, after a Spin, after Drumming, or a shuffle. */
export const CLATTER_RECOVER_TICKS = 2;
/** The x2 damage window by phase. */
export const CLATTER_FLIP_TICKS = [0, 8, 8, 6] as const;
export const CLATTER_FRENZY_FLIP_TICKS = 5;
/** Extra charges after a Skid or Glance, by phase. */
export const CLATTER_CHAIN = [0, 0, 1, 2] as const;
/** Every Nth action is a Drum, by phase (0 = never). */
export const CLATTER_DRUM_EVERY = [0, 0, 6, 5] as const;
/** Drumming lasts from the fire tick F to F + 20. */
export const CLATTER_SWARM_TICKS = 20;
export const CLATTER_DAMAGE = { charge: 10, spin: 7, runner: 4 } as const;
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

const todo = (name: string): never => { throw new Error(`not implemented: ${name}`); };

/** (parseInt(hex.slice(56, 64), 16) >>> 0) || 1 */
export function identityKey32(hex: string): number { return todo(`identityKey32(${hex.length})`); }
/** Dormant at home (Closed when !clatterhornOpen); used only to insert the missing row. */
export function freshClatterhorn(cfg: BossConfigLike): ClatterRowLike { return todo(`freshClatterhorn(${cfg.clatterhornOpen})`); }
export function clatterMaxHp(cfg: BossConfigLike, challengers: number): number { return todo(`clatterMaxHp(${challengers})`); }
export function clatterPhase(row: ClatterRowLike, T: number): 1 | 2 | 3 { return todo(`clatterPhase(${T})`); }
export function clatterFrenzy(row: ClatterRowLike, T: number): boolean { return todo(`clatterFrenzy(${T})`); }
/** Swings land in every state except Dormant, Burrowed and Closed. */
export function clatterAttackable(row: ClatterRowLike): boolean { return todo(`clatterAttackable(${row.state})`); }
export function clatterOctant(dx: number, dz: number, fallback: number): number { return todo(`clatterOctant(${dx},${dz},${fallback})`); }
export function clatterValidCentre(t: Tile): boolean { return todo(`clatterValidCentre(${t.x},${t.z})`); }
export interface ClatterLane { dir: number; len: number; end: Tile; endKind: number; tiles: readonly number[] }
export function clatterLane(from: Tile, dir: number): ClatterLane { return todo(`clatterLane(${dir})`); }
export function clatterChooseLane(from: Tile, target: Tile, prevDir: number): ClatterLane | null { return todo(`clatterChooseLane(${prevDir})`); }
/** Tile keys at Chebyshev exactly 2 from the centre, inside the glade. */
export function clatterSpinTiles(centre: Tile): readonly number[] { return todo(`clatterSpinTiles(${centre.x},${centre.z})`); }
/** Packed runners (absolute), empty when no swarm. */
export function clatterSwarmBullets(row: ClatterRowLike): Int32Array { return todo(`clatterSwarmBullets(${row.swarmTick})`); }
/** The never-used x (N/S) or z (E/W) values. */
export function clatterSwarmFreeLines(row: ClatterRowLike): number[] { return todo(`clatterSwarmFreeLines(${row.swarmTick})`); }
/** Glade-clipped runner hit: 0 = miss, else the half-step. */
export function clatterSwarmHit(row: ClatterRowLike, T: number, p0: Tile, p1: Tile, p2: Tile): 0 | 1 | 2 { return todo(`clatterSwarmHit(${T})`); }
export interface ClatterTelegraph {
  attack: 'charge' | 'spin' | 'drum';
  tiles: readonly number[];
  landsAtTick: number;
  damage: number;
  endKind: number;
  from: Tile;
  to: Tile;
  dir: number;
  bait: number;
}
/** Exactly the tiles that resolve, or null when not winding up. */
export function clatterTelegraph(row: ClatterRowLike): ClatterTelegraph | null { return todo(`clatterTelegraph(${row.state})`); }
export interface ClatterStep<R> {
  next: R | null;
  blow?: { attack: number; tiles: ReadonlySet<number>; damage: number };
  moved?: boolean; flipped?: boolean; woke?: boolean; reset?: boolean; returned?: boolean; swarmFired?: boolean;
}
export function stepClatterhorn<R extends ClatterRowLike>(row: R, T: number, cands: readonly ClatterCandidate[], cfg: BossConfigLike): ClatterStep<R> {
  return todo(`stepClatterhorn(${T},${cands.length},${cfg.clatterHpBase})`);
}
/** damage >= 16, fight matches and T - lastHitTick <= CLATTER_RECENT_TICKS (online is checked by the caller). */
export function clatterQualifies(c: { damage: number; fight: number; lastHitTick: number }, fight: number, T: number): boolean {
  return todo(`clatterQualifies(${fight},${T})`);
}
export function clatterRewardees<C extends { damage: number; fight: number; lastHitTick: number }>(rows: readonly C[], fight: number, T: number): C[] {
  return todo(`clatterRewardees(${rows.length},${fight},${T})`);
}
/**
 * Exact Clatterhorn hazard of tick T for a move (p0, p1, p2): a blow landing in
 * T (end tile in the telegraph tiles) or a runner under the swept rule; 0 =
 * miss, else the half-step (blows report 2). Used by /danger moves and the
 * client hover.
 */
export function clatterHitsMove(row: ClatterRowLike, T: number, p0: Tile, p1: Tile, p2: Tile): 0 | 1 | 2 { return todo(`clatterHitsMove(${T})`); }
