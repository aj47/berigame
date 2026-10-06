import type { EnterRule } from '../../../shared/sim';
import type { Ctx, PlayerRow } from './types';

/**
 * The tick's view handed to the boss phases (FINAL_SPEC 5.2). The phases
 * mutate working copies of loaded players and call `mark`; the tick writes
 * them back. They write their own boss rows directly, at most once per row
 * per tick (`sameRowShallow`). Nothing runs after the write-back.
 */
export interface BossTick {
  ctx: Ctx;
  T: number;
  /** Working copies of loaded players (online, dead, or holding a combat target) in Bramblewild. */
  players: Map<string, PlayerRow>;
  /** Sorted identity hex: the tick's deterministic order. */
  order: readonly string[];
  /** Rows as loaded at the top of the tick: P0 for the swept collision rule. */
  before: ReadonlyMap<string, PlayerRow>;
  /** Static blockers (trees, nodes, the dummy, the Giant, stones, the gate and the Spire's dais). */
  blocked: Set<number>;
  mark(p: PlayerRow): void;
  /** Clears gathering and queued interactions (a hit). Clatterhorn's blows keep Pending.Clatterhorn instead. */
  interrupt(p: PlayerRow): void;
  /** A swing's damage with Might (frontier profile write when frontier is enabled). Clatterhorn only. */
  combatDamage(p: PlayerRow): number;
  /** The player's bramble/boulder rule for bfsPath. */
  enterRule(p: PlayerRow): EnterRule;
}
