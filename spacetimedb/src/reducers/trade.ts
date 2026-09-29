import { t, SenderError } from 'spacetimedb/server';
import type { Identity } from 'spacetimedb';
import spacetimedb from '../schema';
import {
  PlayerState, SocialNotice, TRADE_BREAK_RANGE, TRADE_RANGE, chebyshev, describeOffer, executeTrade, formatOffer, offerProblem, parseOffer,
} from '../../../shared/sim';
import { readSlots, writeSlots } from '../lib/inventory';
import { currentTick, findPlayer, requireAlivePlayer, requirePlayer, sameId, savePlayer, touchInput } from '../lib/players';
import { cancelTrade, notify, notifyThrottled, tradesOf, withdrawTrade } from '../lib/social';
import type { Ctx, PlayerRow, TradeRow } from '../lib/types';

function requireTrade(ctx: Ctx, id: bigint, me: Identity): TradeRow {
  const row = ctx.db.trade.id.find(id);
  if (!row || (!sameId(row.a, me) && !sameId(row.b, me))) throw new SenderError('That trade is over');
  return row;
}

function requirePartner(ctx: Ctx, me: PlayerRow, other: Identity, range: number): PlayerRow {
  const o = findPlayer(ctx, other);
  if (!o || !o.online || o.state !== PlayerState.Alive) throw new SenderError('They are not available to trade');
  if (chebyshev(me, o) > range) throw new SenderError('Walk closer to trade');
  return o;
}

/**
 * Ask a nearby player to trade. If they already asked you, this accepts. Any
 * other trade you were in (or had asked for) is cancelled: one at a time.
 */
export const requestTrade = spacetimedb.reducer(
  { target: t.identity() },
  (ctx, { target }) => {
    const p = requireAlivePlayer(ctx);
    const T = currentTick(ctx);
    touchInput(p, T);
    savePlayer(ctx, p);
    if (sameId(target, p.identity)) throw new SenderError('You cannot trade with yourself');
    const o = requirePartner(ctx, p, target, TRADE_RANGE);
    const mine = tradesOf(ctx, p.identity);
    const theirs = tradesOf(ctx, target);
    const incoming = mine.find((r) => sameId(r.a, target) && sameId(r.b, p.identity));
    if (incoming) {
      if (!incoming.accepted) {
        ctx.db.trade.id.update({ ...incoming, accepted: true });
        notify(ctx, target, p.identity, SocialNotice.Info, `${p.name} accepted your trade`);
      }
      for (const r of mine) if (r.id !== incoming.id) withdrawTrade(ctx, r, p.identity, 'Trade cancelled');
      return;
    }
    if (mine.some((r) => sameId(r.b, target))) return; // already asked them
    if (theirs.some((r) => r.accepted)) throw new SenderError(`${o.name} is busy trading`);
    for (const r of mine) withdrawTrade(ctx, r, p.identity, 'Trade cancelled');
    ctx.db.trade.insert({ id: 0n, a: p.identity, b: target, accepted: false, aOffer: '', bOffer: '', aConfirmed: false, bConfirmed: false, createdTick: T });
    // Throttled per (you, them): request/cancel loops cannot flood them. The
    // trade row itself still reaches them, so the request is never lost.
    notifyThrottled(ctx, target, p.identity, SocialNotice.TradeRequest, `${p.name} wants to trade`);
  }
);

/** Answer a request you received: accept opens the trade window for both, decline ends it. */
export const respondTrade = spacetimedb.reducer(
  { tradeId: t.u64(), accept: t.bool() },
  (ctx, { tradeId, accept }) => {
    const p = requireAlivePlayer(ctx);
    touchInput(p, currentTick(ctx));
    savePlayer(ctx, p);
    const row = requireTrade(ctx, tradeId, p.identity);
    if (!sameId(row.b, p.identity)) throw new SenderError('Wait for them to answer');
    if (row.accepted) return;
    if (!accept) { cancelTrade(ctx, row, `${p.name} declined the trade`); return; }
    requirePartner(ctx, p, row.a, TRADE_RANGE);
    for (const r of tradesOf(ctx, p.identity)) if (r.id !== row.id) cancelTrade(ctx, r, 'Trade cancelled');
    for (const r of tradesOf(ctx, row.a)) if (r.id !== row.id) cancelTrade(ctx, r, 'Trade cancelled');
    ctx.db.trade.id.update({ ...row, accepted: true });
    notify(ctx, row.a, p.identity, SocialNotice.Info, `${p.name} accepted your trade`);
  }
);

/**
 * Set everything you offer ("itemId:qty,..."; "" for nothing). The items must
 * be in your bag and not wielded. Clears both confirmations.
 */
export const setTradeOffer = spacetimedb.reducer(
  { tradeId: t.u64(), offer: t.string() },
  (ctx, { tradeId, offer }) => {
    const p = requireAlivePlayer(ctx);
    touchInput(p, currentTick(ctx));
    savePlayer(ctx, p);
    const row = requireTrade(ctx, tradeId, p.identity);
    if (!row.accepted) throw new SenderError('The trade has not been accepted yet');
    const items = parseOffer(offer);
    if (!items) throw new SenderError('bad offer');
    const problem = offerProblem(items, readSlots(ctx, p.identity).slots, p.weapon);
    if (problem) throw new SenderError(problem);
    const canonical = formatOffer(items);
    const isA = sameId(row.a, p.identity);
    if ((isA ? row.aOffer : row.bOffer) === canonical) return;
    ctx.db.trade.id.update({
      ...row,
      aOffer: isA ? canonical : row.aOffer,
      bOffer: isA ? row.bOffer : canonical,
      aConfirmed: false,
      bConfirmed: false,
    });
  }
);

/**
 * Agree to the trade as it stands. `aOffer`/`bOffer` are the offers you saw;
 * if either changed since, nothing is confirmed. When both have confirmed, the
 * swap runs at once, all or nothing; if it cannot (bag full, an item gone or
 * wielded) both confirmations clear and both players are told why.
 */
export const confirmTrade = spacetimedb.reducer(
  { tradeId: t.u64(), aOffer: t.string(), bOffer: t.string() },
  (ctx, { tradeId, aOffer, bOffer }) => {
    const p = requireAlivePlayer(ctx);
    touchInput(p, currentTick(ctx));
    savePlayer(ctx, p);
    const row = requireTrade(ctx, tradeId, p.identity);
    if (!row.accepted) throw new SenderError('The trade has not been accepted yet');
    if (row.aOffer !== aOffer || row.bOffer !== bOffer) throw new SenderError('The offer changed. Check it again.');
    const isA = sameId(row.a, p.identity);
    const next = { ...row, aConfirmed: isA ? true : row.aConfirmed, bConfirmed: isA ? row.bConfirmed : true };
    if (!next.aConfirmed || !next.bConfirmed) {
      if (!(isA ? row.aConfirmed : row.bConfirmed)) ctx.db.trade.id.update(next);
      return;
    }
    const a = isA ? p : findPlayer(ctx, row.a);
    const b = isA ? findPlayer(ctx, row.b) : p;
    if (!a || !b || !a.online || !b.online || a.state !== PlayerState.Alive || b.state !== PlayerState.Alive || chebyshev(a, b) > TRADE_BREAK_RANGE) {
      cancelTrade(ctx, row, 'Trade cancelled: too far apart');
      return;
    }
    const snapA = readSlots(ctx, a.identity);
    const snapB = readSlots(ctx, b.identity);
    const offerA = parseOffer(row.aOffer) ?? [];
    const offerB = parseOffer(row.bOffer) ?? [];
    const result = executeTrade(
      { slots: snapA.slots, weapon: a.weapon, offer: offerA, name: a.name },
      { slots: snapB.slots, weapon: b.weapon, offer: offerB, name: b.name },
    );
    if (!result.ok) {
      ctx.db.trade.id.update({ ...row, aConfirmed: false, bConfirmed: false });
      notify(ctx, a.identity, b.identity, SocialNotice.TradeFailed, `Trade not done: ${result.reason}`);
      notify(ctx, b.identity, a.identity, SocialNotice.TradeFailed, `Trade not done: ${result.reason}`);
      return;
    }
    writeSlots(ctx, a.identity, snapA, result.a);
    writeSlots(ctx, b.identity, snapB, result.b);
    ctx.db.trade.id.delete(row.id);
    notify(ctx, a.identity, b.identity, SocialNotice.TradeDone, `Traded with ${b.name}: you got ${describeOffer(offerB)}`);
    notify(ctx, b.identity, a.identity, SocialNotice.TradeDone, `Traded with ${a.name}: you got ${describeOffer(offerA)}`);
  }
);

/** Leave a trade or withdraw a request. */
export const cancelTradeRequest = spacetimedb.reducer(
  { tradeId: t.u64() },
  (ctx, { tradeId }) => {
    const p = requirePlayer(ctx);
    touchInput(p, currentTick(ctx));
    savePlayer(ctx, p);
    const row = ctx.db.trade.id.find(tradeId);
    if (!row || (!sameId(row.a, p.identity) && !sameId(row.b, p.identity))) return;
    withdrawTrade(ctx, row, p.identity, `${p.name} cancelled the trade`);
  }
);
