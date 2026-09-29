import type { Identity } from 'spacetimedb';
import { SocialNotice } from '../../../shared/sim';
import type { Ctx, TradeRow } from './types';
import { currentTick, hex, sameId } from './players';

/** A one-line notice for one player (social_event; clients show only their own). */
export function notify(ctx: Ctx, to: Identity, from: Identity, kind: number, text: string): void {
  ctx.db.socialEvent.insert({ tick: currentTick(ctx), kind, from, to, text });
}

/** Minimum gap between player-triggered notices from one player to another. */
export const NOTICE_COOLDOWN_MICROS = 10_000_000n;

type PairRow = { pair: string; lastNoticeMicros: bigint; friendNoticed: boolean; redeemedCode: string };

function pairKey(from: Identity, to: Identity): string {
  return `${hex(from)}>${hex(to)}`;
}

/** The (from -> to) bookkeeping row, or a fresh default (not yet stored). */
export function readPair(ctx: Ctx, from: Identity, to: Identity): PairRow {
  return ctx.db.socialPair.pair.find(pairKey(from, to))
    ?? { pair: pairKey(from, to), lastNoticeMicros: 0n, friendNoticed: false, redeemedCode: '' };
}

export function writePair(ctx: Ctx, row: PairRow): void {
  if (ctx.db.socialPair.pair.find(row.pair)) ctx.db.socialPair.pair.update(row);
  else ctx.db.socialPair.insert(row);
}

/**
 * A notice `from` caused by acting on `to` (a friend add, a trade request or
 * its cancellation). At most one per NOTICE_COOLDOWN_MICROS per (from, to), so
 * repeating the action cannot flood `to` with toasts. Returns whether it was sent.
 */
export function notifyThrottled(ctx: Ctx, to: Identity, from: Identity, kind: number, text: string, patch: Partial<PairRow> = {}): boolean {
  const row = readPair(ctx, from, to);
  const now = ctx.timestamp.microsSinceUnixEpoch;
  if (row.lastNoticeMicros !== 0n && now - row.lastNoticeMicros < NOTICE_COOLDOWN_MICROS) return false;
  writePair(ctx, { ...row, ...patch, lastNoticeMicros: now });
  notify(ctx, to, from, kind, text);
  return true;
}

/** Every trade `id` is part of (either side). At most a couple of rows. */
export function tradesOf(ctx: Ctx, id: Identity): TradeRow[] {
  const out: TradeRow[] = [...ctx.db.trade.a.filter(id)];
  for (const row of ctx.db.trade.b.filter(id)) if (!out.some((r) => r.id === row.id)) out.push(row);
  return out;
}

export function otherSide(row: TradeRow, me: Identity): Identity {
  return sameId(row.a, me) ? row.b : row.a;
}

/** Remove a trade and tell both sides why (nobody is told twice). */
export function cancelTrade(ctx: Ctx, row: TradeRow, reason: string): void {
  ctx.db.trade.id.delete(row.id);
  notify(ctx, row.a, row.b, SocialNotice.TradeCancelled, reason);
  notify(ctx, row.b, row.a, SocialNotice.TradeCancelled, reason);
}

/**
 * `actor` withdraws a trade. The other side of a request they never accepted
 * is told through the notice cooldown (request/cancel loops cannot spam them);
 * an accepted trade ending is always reported.
 */
export function withdrawTrade(ctx: Ctx, row: TradeRow, actor: Identity, reason: string): void {
  if (row.accepted) { cancelTrade(ctx, row, reason); return; }
  ctx.db.trade.id.delete(row.id);
  const other = otherSide(row, actor);
  notify(ctx, actor, other, SocialNotice.TradeCancelled, reason);
  notifyThrottled(ctx, other, actor, SocialNotice.TradeCancelled, reason);
}
