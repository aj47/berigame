import type { Identity } from 'spacetimedb';
import { SocialNotice } from '../../../shared/sim';
import type { Ctx, TradeRow } from './types';
import { currentTick, sameId } from './players';

/** A one-line notice for one player (social_event; clients show only their own). */
export function notify(ctx: Ctx, to: Identity, from: Identity, kind: number, text: string): void {
  ctx.db.socialEvent.insert({ tick: currentTick(ctx), kind, from, to, text });
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
