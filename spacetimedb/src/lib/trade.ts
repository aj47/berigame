import { PlayerState, SocialNotice } from '../../../shared/sim';
import { sameId } from './players';
import { notify, notifyThrottled, tradesOf, withdrawTrade } from './social';
import type { Ctx, PlayerRow } from './types';

/** Rechecked on approach and arrival; a failed queued action must not throw from the tick. */
export function tradePartnerProblem(ctx: Ctx, me: PlayerRow, other: PlayerRow | undefined): string | null {
  if (!other || !other.online || other.state !== PlayerState.Alive) return 'They are not available to trade';
  const theirs = tradesOf(ctx, other.identity);
  if (theirs.some(r => r.accepted && !sameId(r.a, me.identity) && !sameId(r.b, me.identity))) return `${other.name} is busy trading`;
  return null;
}

/** Both players are in range. A reciprocal request retains the existing accept behavior. */
export function requestTradeInRange(ctx: Ctx, p: PlayerRow, other: PlayerRow, tick: number): void {
  const target = other.identity;
  const mine = tradesOf(ctx, p.identity);
  const incoming = mine.find(r => sameId(r.a, target) && sameId(r.b, p.identity));
  if (incoming) {
    if (!incoming.accepted) {
      ctx.db.trade.id.update({ ...incoming, accepted: true });
      notify(ctx, target, p.identity, SocialNotice.Info, `${p.name} accepted your trade`);
    }
    for (const r of mine) if (r.id !== incoming.id) withdrawTrade(ctx, r, p.identity, 'Trade cancelled');
    return;
  }
  if (mine.some(r => sameId(r.b, target))) return;
  for (const r of mine) withdrawTrade(ctx, r, p.identity, 'Trade cancelled');
  ctx.db.trade.insert({ id: 0n, a: p.identity, b: target, accepted: false, aOffer: '', bOffer: '', aConfirmed: false, bConfirmed: false, createdTick: tick });
  notifyThrottled(ctx, target, p.identity, SocialNotice.TradeRequest, `${p.name} wants to trade`);
}
