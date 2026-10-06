/**
 * The compact danger feed (FINAL_SPEC 8.3; CORE_SCOPE: no long poll, no
 * downed state, no practice): the agent gateway's GET /danger, WebMCP's
 * inspect_danger and the browser overlay share it.
 *
 * WP0 stub: the types are final; WP3 fills in the builder.
 */
import type { ClatterRowLike } from './clatterhorn';
import type { SpireFightLike, SpireRunLike, SpireSafety } from './spire';

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
  rulesVersion: number;
  me: { identity: string; x: number; z: number; hp: number; maxHp: number; eatCooldownUntilTick: number };
  blocked: Set<number>;
  spire?: { run: SpireRunLike; fight: SpireFightLike; members: readonly DangerMemberInput[]; mySlot: number; safety: SpireSafety | null } | null;
  clatter?: ClatterRowLike | null;
}

export type DangerXZ = [number, number];

export interface DangerMove {
  to: DangerXZ;
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

const todo = (name: string): never => { throw new Error(`not implemented: ${name}`); };

export function buildDangerFeed(input: DangerInput): DangerFeed { return todo(`buildDangerFeed(${input.tick})`); }

/**
 * Module-level memo (at most 64 entries) keyed `${runId}:${curStart}:${prevStart}:${rules}`: one build per pattern
 * rotation per process, shared by every gateway session in a Durable Object and by the browser overlay, hover and WebMCP.
 */
export function spireSafetyCached(runId: string, f: SpireFightLike, rules: number, blocked: Set<number>): SpireSafety {
  return todo(`spireSafetyCached(${runId},${f.curStart},${rules},${blocked.size})`);
}
