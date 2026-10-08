import type { Identity } from 'spacetimedb';
import type { Ctx, PlayerRow } from './types';
import { TICK_MS } from '../../../shared/sim/constants';
import { IDLE_LOGOUT_MINUTES } from '../../../shared/sim/admission';

/**
 * Idle logout. A module cannot close a client's socket, so an idle character's
 * permit ends instead: the tick's expiry check then takes it offline, a
 * reconnect is refused by admission, and the gateway renews the permit only
 * when the player explicitly returns (resume_grant). Humans, agents and stray
 * browser tabs are treated the same; nothing here tries to tell them apart.
 */
export const IDLE_LOGOUT_TICKS = Math.round(IDLE_LOGOUT_MINUTES * 60_000 / TICK_MS);
/** How often the tick looks for idle characters (every 30 s). */
export const IDLE_SWEEP_TICKS = 50;

const same = (a: Identity | undefined, b: Identity) => !!a && a.toHexString() === b.toHexString();

/** Connecting starts the idle clock afresh; it never clears an idle logout. */
export function noteConnected(ctx: Ctx, identity: Identity, tick: number): void {
  const row = ctx.db.idleState.identity.find(identity);
  if (row) ctx.db.idleState.identity.update({ ...row, activeTick: tick });
  else ctx.db.idleState.insert({ identity, activeTick: tick, loggedOut: false });
}

export function isIdleLoggedOut(ctx: Ctx, identity: Identity): boolean {
  return !!ctx.db.idleState.identity.find(identity)?.loggedOut;
}

/** The player chose to return: clear the logout and give them a full idle window. */
export function clearIdleLogout(ctx: Ctx, identity: Identity, tick: number): void {
  const row = ctx.db.idleState.identity.find(identity);
  if (row) ctx.db.idleState.identity.update({ ...row, activeTick: tick, loggedOut: false });
  else ctx.db.idleState.insert({ identity, activeTick: tick, loggedOut: false });
}

/**
 * Ends the permit of an online, gateway-admitted character that has had no
 * input for IDLE_LOGOUT_TICKS. Owner-granted players and worlds without
 * admission are left alone. Returns true when the character was logged out.
 */
export function logOutIfIdle(ctx: Ctx, p: PlayerRow, tick: number, gateway: Identity | undefined): boolean {
  if (!p.online || !gateway || tick - p.lastInputTick < IDLE_LOGOUT_TICKS) return false;
  const state = ctx.db.idleState.identity.find(p.identity);
  // Online since before idle logout existed: start its clock now rather than logging it out unseen.
  if (!state) { noteConnected(ctx, p.identity, tick); return false; }
  if (state.loggedOut || tick - state.activeTick < IDLE_LOGOUT_TICKS) return false;
  const grant = ctx.db.playerGrant.identity.find(p.identity);
  if (!grant?.agent || grant.expiresAtMicros === 0n || !same(gateway, grant.issuer)) return false;
  const now = ctx.timestamp.microsSinceUnixEpoch;
  if (grant.expiresAtMicros > now) ctx.db.playerGrant.identity.update({ ...grant, expiresAtMicros: now });
  ctx.db.idleState.identity.update({ ...state, loggedOut: true });
  return true;
}
