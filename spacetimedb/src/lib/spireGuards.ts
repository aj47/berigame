import { SenderError } from 'spacetimedb/server';
import type { Identity } from 'spacetimedb';
import { LANTERN_MEALS, SPIRE_MEALS, SpireMemberState, SpireStage, inLanternFloor, inSpireFloor, type Tile } from '../../../shared/sim';
import { homeDestination, homeLocation, isHomeTarget } from '../../../shared/sim/frontier/homeMap';
import type { Ctx, PlayerRow } from './types';

/**
 * Guards that keep the Sunken Spire sealed (FINAL_SPEC 5.6). The floor is a
 * Bramblewild rectangle, so every check is for Bramblewild rows only: a player
 * in another region can stand on the same numbers without being inside.
 */

/** The message for actions that make no sense on the floor (harvest, dummy, Giant, garden, expedition). */
export const SPIRE_REFUSED = 'You cannot do that inside the Sunken Spire';

interface Placed extends Tile { region?: string | null }

/** A Bramblewild row standing on the sealed Spire floor. */
export function onSpireFloor(p: Placed): boolean {
  return (p.region || 'bramblewild') === 'bramblewild' && inSpireFloor(p);
}

/** A Bramblewild row standing on Lanternmaw's sealed Drowned Hollow. */
export function onLanternFloor(p: Placed): boolean {
  return (p.region || 'bramblewild') === 'bramblewild' && inLanternFloor(p);
}

/** Either sealed boss floor. */
export function onSealedFloor(p: Placed): boolean {
  return onSpireFloor(p) || onLanternFloor(p);
}

/** A Spire message reworded for the Drowned Hollow ("inside the Sunken Spire" -> "inside the Drowned Hollow"). */
export function hollowMessage(message: string): string {
  return message.replace('the Sunken Spire', 'the Drowned Hollow');
}

/** Throws `message` when `p` stands on either sealed floor (reworded for the Drowned Hollow). */
export function refuseOnSpireFloor(p: Placed, message = SPIRE_REFUSED): void {
  if (onSpireFloor(p)) throw new SenderError(message);
  if (onLanternFloor(p)) throw new SenderError(hollowMessage(message));
}

/** The run `id` belongs to (any member state), or undefined. */
export function spireRunOf(ctx: Ctx, id: Identity): bigint | undefined {
  return ctx.db.spireMember?.identity.find(id)?.runId;
}

/**
 * `follow` across the Spire boundary (FINAL_SPEC 5.6): exactly one of the two on
 * the floor, or both on the floor in different runs.
 */
export function spireFollowProblem(ctx: Ctx, me: PlayerRow, other: PlayerRow): string | null {
  const hollowMine = onLanternFloor(me), hollowTheirs = onLanternFloor(other);
  if (hollowMine || hollowTheirs) {
    const a = ctx.db.lanternMember?.identity.find(me.identity)?.runId, b = ctx.db.lanternMember?.identity.find(other.identity)?.runId;
    return hollowMine && hollowTheirs && a !== undefined && a === b ? null : 'You cannot follow players into or out of the Drowned Hollow';
  }
  const mine = onSpireFloor(me), theirs = onSpireFloor(other);
  if (!mine && !theirs) return null;
  if (mine !== theirs) return 'You cannot follow players into or out of the Sunken Spire';
  const a = spireRunOf(ctx, me.identity), b = spireRunOf(ctx, other.identity);
  return a !== undefined && a === b ? null : 'You cannot follow players into or out of the Sunken Spire';
}

/** True while `id` waits in a Lobby or Queued run (its start checks need it in Bramblewild, near the gate). */
export function inSpireLobby(ctx: Ctx, id: Identity): boolean {
  const m = ctx.db.spireMember?.identity.find(id);
  if (!m) return false;
  const run = ctx.db.spireRun.id.find(m.runId);
  return !!run && (run.stage === SpireStage.Lobby || run.stage === SpireStage.Queued);
}

/**
 * True when a frontier actor's saved location leaves Bramblewild now (a boat,
 * a region change) or later (a queued cross-district home walk).
 */
export function leavesBramblewild(a: { region: string; target?: { x: number; z: number } }): boolean {
  if (a.region !== 'bramblewild') return true;
  return isHomeTarget(a.target) && homeLocation(homeDestination(a.target!)).region !== 'bramblewild';
}

export const SPIRE_LOBBY_TRAVEL = 'You are waiting in a Spire party; leave it first';
export const LANTERN_LOBBY_TRAVEL = 'You are waiting in a Lanternmaw party; leave it first';

/** True while `id` waits in a Lanternmaw lobby (its start checks need it in Bramblewild, near the Fen Gate). */
export function inLanternLobby(ctx: Ctx, id: Identity): boolean {
  const m = ctx.db.lanternMember?.identity.find(id);
  if (!m) return false;
  return ctx.db.lanternRun.id.find(m.runId)?.stage === SpireStage.Lobby;
}

/**
 * The Spire's meal cap (FINAL_SPEC 3.10): called by eatFromSlot for a player
 * on the floor after the ordinary checks. Refuses with "You have eaten your
 * fill in the Spire (6/6)" at the cap, else counts the meal on the member row
 * (one write). A player on the floor without a fighting member row (stranded,
 * about to be swept out) eats normally.
 */
export function spireEatGuard(ctx: Ctx, p: PlayerRow): void {
  if (!ctx.db.spireMember) return;
  const m = ctx.db.spireMember.identity.find(p.identity);
  if (!m || m.state !== SpireMemberState.In) return;
  if (m.meals >= SPIRE_MEALS) throw new SenderError(`You have eaten your fill in the Spire (${SPIRE_MEALS}/${SPIRE_MEALS})`);
  ctx.db.spireMember.identity.update({ ...m, meals: m.meals + 1 });
}

/** The Drowned Hollow's meal cap, as spireEatGuard: "You have eaten your fill in the Drowned Hollow (6/6)". */
export function lanternEatGuard(ctx: Ctx, p: PlayerRow): void {
  if (!ctx.db.lanternMember) return;
  const m = ctx.db.lanternMember.identity.find(p.identity);
  if (!m || m.state !== SpireMemberState.In) return;
  if (m.meals >= LANTERN_MEALS) throw new SenderError(`You have eaten your fill in the Drowned Hollow (${LANTERN_MEALS}/${LANTERN_MEALS})`);
  ctx.db.lanternMember.identity.update({ ...m, meals: m.meals + 1 });
}
