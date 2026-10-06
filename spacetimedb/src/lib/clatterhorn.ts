import { SenderError } from 'spacetimedb/server';
import type { BossConfigLike } from '../../../shared/sim';
import type { BossTick } from './bossTick';
import type { Ctx } from './types';

/**
 * Clatterhorn on the server (FINAL_SPEC 2, 5.3).
 *
 * WP0 stub with the final signatures; WP5 fills it in. The phase and the
 * owner effects are no-ops until then, the debug ops refuse.
 */

/** One tick of Clatterhorn: payout batches, swings, the step function, blows, runners, re-chase, one row write. */
export function phaseClatterhorn(t: BossTick): void {
  if (!t.ctx.db.clatterhorn || !t.ctx.db.bossConfig) return;
}

/** Owner close: state Closed, drop every `pending == 6` by direct writes, delete non-owed credit. */
export function clatterClose(ctx: Ctx, T: number): void {
  void ctx; void T;
}

/** Owner reopen: Dormant at home with hp = maxHp = clatterHpBase; fightCount, defeats and owedLeft kept. */
export function clatterOpen(ctx: Ctx, T: number, cfg: BossConfigLike): void {
  void ctx; void T; void cfg;
}

/** Owner debug ops for live checks: clatter_wake, clatter_respawn, clatter_hp, clatter_drum. */
export function clatterDebug(ctx: Ctx, T: number, op: string, value: number): void {
  void ctx; void T; void op; void value;
  throw new SenderError('This boss is not ready yet');
}
