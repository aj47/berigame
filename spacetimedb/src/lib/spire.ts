import { SenderError } from 'spacetimedb/server';
import type { SpireMode } from '../../../shared/sim';
import type { BossTick } from './bossTick';
import type { Ctx, PlayerRow, SpireMemberRow, SpireRunRow } from './types';

/**
 * The Sunken Spire on the server (FINAL_SPEC 3.3, 3.10, 5.4; CORE_SCOPE: no
 * practice, private lobbies, kick, queue or downed state).
 *
 * WP0 stub with the final signatures; WP4 fills it in. The phase and the
 * owner close are no-ops until then, the rest refuses.
 */

/** Lobby upkeep, Active runs (presence, swings, stars, bullets, knockouts, rotation), cleanup, the stranded sweep. */
export function phaseSpire(t: BossTick): void {
  if (!t.ctx.db.spireRun || !t.ctx.db.spireMember || !t.ctx.db.spireFight) return;
}

/** Owner close of a mode: lobbies deleted (members notified), Active runs fail with Closed and refund keys. */
export function spireCloseMode(ctx: Ctx, T: number, mode: SpireMode): void {
  void ctx; void T; void mode;
}

/** Player rows for the start effects: the reducer passes `findPlayer` copies and `savePlayer`. */
export interface SpireStartIo {
  /** A mutable player row, or undefined. */
  player(hex: string): PlayerRow | undefined;
  /** Persist a row returned by `player` or `others`. */
  save(p: PlayerRow): void;
  /** Every other player whose `combatTarget` may point at a member. */
  others(): Iterable<PlayerRow>;
}

/**
 * Start effects (section 3.3): per member consume one spire_key, clear interactions, cancel trades, clear combat
 * targets that point at them, end grace, teleport to SPIRE_SPAWNS[slot], state In; run Active with startTick =
 * T + 5; insert spire_fight with the first pattern published; boss_event SpireRunStart.
 */
export function spireStartRun(ctx: Ctx, T: number, run: SpireRunRow, members: readonly SpireMemberRow[], io: SpireStartIo): void {
  void ctx; void T; void run; void members; void io;
  throw new SenderError('This boss is not ready yet');
}

/** Owner debug ops for live checks: spire_hp, spire_phase, spire_fail_all. */
export function spireDebug(ctx: Ctx, T: number, op: string, runId: bigint, value: number): void {
  void ctx; void T; void op; void runId; void value;
  throw new SenderError('This boss is not ready yet');
}

/**
 * The member-row lifecycle shared by spire_open and spire_join (section 3.3): deletes a stale or Left row and
 * returns null, or returns the refusal ("You are already in a Spire party" / "You still belong to a party that
 * is fighting ({s} s left); leave it to give up its reward").
 */
export function spireMembershipProblem(ctx: Ctx, me: PlayerRow, T: number): string | null {
  void ctx; void me; void T;
  throw new SenderError('This boss is not ready yet');
}
