/**
 * One presenter for the agent API's /state boss blocks and WebMCP's
 * inspect_game_state, so they cannot drift (FINAL_SPEC 6.8, 8.2).
 *
 * WP0 stub: the signatures are final; WP3 fills in the presenters.
 */
import type { BossConfigLike } from './bossConfig';
import type { ClatterRowLike } from './clatterhorn';
import type { SpireFightLike, SpireMemberLike, SpireRunLike } from './spire';

const todo = (name: string): never => { throw new Error(`not implemented: ${name}`); };

/** `state.clatterhorn` (null outside Bramblewild or without a row). */
export function describeClatterhorn(row: ClatterRowLike | null, cfg: BossConfigLike, me: { x: number; z: number; identity: string },
  tick: number, contribution: number | null): Record<string, unknown> | null {
  return todo(`describeClatterhorn(${row?.state},${cfg.clatterhornOpen},${me.x},${tick},${contribution})`);
}

/** `state.spire`, including `run` while you belong to a run that still exists. */
export function describeSpire(input: {
  cfg: BossConfigLike;
  runs: readonly SpireRunLike[];
  members: readonly (SpireMemberLike & { identity: string })[];
  fight: SpireFightLike | null;
  me: { identity: string; x: number; z: number };
  tick: number;
  keysHeld: number;
  name(hex: string): string | null;
  player(hex: string): { x: number; z: number; hp: number } | null;
}): Record<string, unknown> {
  return todo(`describeSpire(${input.tick})`);
}
