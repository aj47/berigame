import type { Ctx, PlayerRow } from './types';

/**
 * The Spire's meal cap (FINAL_SPEC 3.10): called by eatFromSlot for a player
 * on the floor. Refuses with "You have eaten your fill in the Spire (6/6)" at
 * the cap, else counts the meal on the member row.
 *
 * WP0 stub with the final signature; WP6 fills it in (a no-op until then).
 */
export function spireEatGuard(ctx: Ctx, p: PlayerRow): void {
  void ctx; void p;
}
