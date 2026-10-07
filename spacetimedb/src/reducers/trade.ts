import { t, SenderError } from 'spacetimedb/server';
import type { Identity } from 'spacetimedb';
import spacetimedb from '../schema';
import {
  Pending, PlayerState, SocialNotice, TICK_MS, TRADE_BREAK_RANGE, TRADE_RANGE, TRADE_SWAP_TICKS, attackProofSpot, chebyshev, formatOffer, offerProblem, parseOffer,
} from '../../../shared/sim';
import { readSlots } from '../lib/inventory';
import { frontierRepository } from '../lib/frontier';
import { clearInteractions, currentTick, findPlayer, requireAlivePlayer, requirePlayer, sameId, savePlayer, touchInput } from '../lib/players';
import { cancelTrade, notify, tradesOf, withdrawTrade } from '../lib/social';
import type { Ctx, PlayerRow, TradeRow } from '../lib/types';
import { requestTradeInRange, tradePartnerProblem } from '../lib/trade';
import { completeTrade } from '../lib/tradeSwap';

function requireTrade(ctx: Ctx, id: bigint, me: Identity): TradeRow {
  const row = ctx.db.trade.id.find(id);
  if (!row || (!sameId(row.a, me) && !sameId(row.b, me))) throw new SenderError('That trade is over');
  return row;
}

function requirePartner(ctx: Ctx, me: PlayerRow, other: Identity, range: number): PlayerRow {
  const o = findPlayer(ctx, other);
  if (!o || !o.online || o.state !== PlayerState.Alive) throw new SenderError('They are not available to trade');
  if ((me.region || 'bramblewild') !== (o.region || 'bramblewild') || chebyshev(me, o) > range) throw new SenderError('Walk closer to trade');
  return o;
}

/** Walk into range, then ask to trade. A nearby reciprocal request accepts immediately. */
export const requestTrade = spacetimedb.reducer(
  { target: t.identity() },
  (ctx, { target }) => {
    const p = requireAlivePlayer(ctx, true);
    const T = currentTick(ctx);
    touchInput(p, T);
    if (sameId(target, p.identity)) throw new SenderError('You cannot trade with yourself');
    const other = findPlayer(ctx, target);
    const problem = tradePartnerProblem(ctx, p, other);
    if (problem) throw new SenderError(problem);
    clearInteractions(ctx, p);
    if (chebyshev(p, other!) > TRADE_RANGE) {
      // Keep a reciprocal request while approaching, but withdraw trades with anyone else.
      for (const row of tradesOf(ctx, p.identity)) {
        if (!sameId(row.a, target) && !sameId(row.b, target)) withdrawTrade(ctx, row, p.identity, 'Trade cancelled');
      }
      p.pending = Pending.Trade;
      p.combatTarget = target;
    } else {
      requestTradeInRange(ctx, p, other!, T);
    }
    savePlayer(ctx, p);
  }
);

/** Answer a request you received: accept opens the trade window for both, decline ends it. */
export const respondTrade = spacetimedb.reducer(
  { tradeId: t.u64(), accept: t.bool() },
  (ctx, { tradeId, accept }) => {
    const p = requireAlivePlayer(ctx, true);
    touchInput(p, currentTick(ctx));
    savePlayer(ctx, p);
    const row = requireTrade(ctx, tradeId, p.identity);
    if (!sameId(row.b, p.identity)) throw new SenderError('Wait for them to answer');
    if (row.accepted) return;
    if (!accept) { cancelTrade(ctx, row, `${p.name} declined the trade`); return; }
    const partner = requirePartner(ctx, p, row.a, TRADE_RANGE);
    const problem = tradePartnerProblem(ctx, p, partner);
    if (problem) throw new SenderError(problem);
    clearInteractions(ctx, p);
    savePlayer(ctx, p);
    for (const r of tradesOf(ctx, p.identity)) if (r.id !== row.id) cancelTrade(ctx, r, 'Trade cancelled');
    for (const r of tradesOf(ctx, row.a)) if (r.id !== row.id) cancelTrade(ctx, r, 'Trade cancelled');
    ctx.db.trade.id.update({ ...row, accepted: true });
    notify(ctx, row.a, p.identity, SocialNotice.Info, `${p.name} accepted your trade`);
  }
);

/**
 * Set everything you offer ("itemId:qty,..."; "" for nothing). The items must
 * be in your inventory, including wielded weapons. Clears both confirmations.
 */
export const setTradeOffer = spacetimedb.reducer(
  { tradeId: t.u64(), offer: t.string() },
  (ctx, { tradeId, offer }) => {
    const p = requireAlivePlayer(ctx, true);
    touchInput(p, currentTick(ctx));
    savePlayer(ctx, p);
    const row = requireTrade(ctx, tradeId, p.identity);
    if (!row.accepted) throw new SenderError('The trade has not been accepted yet');
    const items = parseOffer(offer);
    if (!items) throw new SenderError('bad offer');
    const problem = offerProblem(items, readSlots(ctx, p.identity).slots);
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
      swapTick: 0,
    });
  }
);

/**
 * Agree to the trade as it stands. `aOffer`/`bOffer` are the offers you saw;
 * if either changed since, nothing is confirmed. When both have confirmed, the
 * swap runs at once, all or nothing; if it cannot (bag full or an item gone)
 * both confirmations clear and both players are told why.
 */
function confirmTradeCore(ctx: Ctx, tradeId: bigint, aOffer: string, bOffer: string, aCoins: number, bCoins: number) {
    const p = requireAlivePlayer(ctx, true);
    touchInput(p, currentTick(ctx));
    savePlayer(ctx, p);
    const row = requireTrade(ctx, tradeId, p.identity);
    if (!row.accepted) throw new SenderError('The trade has not been accepted yet');
    if ((row.aCoins ?? 0) !== aCoins || (row.bCoins ?? 0) !== bCoins || row.aOffer !== aOffer || row.bOffer !== bOffer) throw new SenderError('The offer changed. Check it again.');
    const isA = sameId(row.a, p.identity);
    // Already swapping: confirming again must not restart the wait.
    if (row.aConfirmed && row.bConfirmed && row.swapTick) return;
    const next = { ...row, aConfirmed: isA ? true : row.aConfirmed, bConfirmed: isA ? row.bConfirmed : true };
    if (!next.aConfirmed || !next.bConfirmed) {
      if (!(isA ? row.aConfirmed : row.bConfirmed)) ctx.db.trade.id.update(next);
      return;
    }
    const a = isA ? p : findPlayer(ctx, row.a);
    const b = isA ? findPlayer(ctx, row.b) : p;
    if (!a || !b || !a.online || !b.online || a.state !== PlayerState.Alive || b.state !== PlayerState.Alive || (a.region || 'bramblewild') !== (b.region || 'bramblewild') || chebyshev(a, b) > TRADE_BREAK_RANGE) {
      cancelTrade(ctx, row, 'Trade cancelled: too far apart');
      return;
    }
    // Where an attack could land, the swap waits a few ticks and any damage stops it (the tick runs it).
    if (!attackProofSpot(a) || !attackProofSpot(b)) {
      ctx.db.trade.id.update({ ...next, swapTick: currentTick(ctx) + TRADE_SWAP_TICKS, aHp: a.hp, bHp: b.hp });
      const text = `Both confirmed: the swap happens in ${(TRADE_SWAP_TICKS * TICK_MS / 1000).toFixed(1)} s unless either of you is hit`;
      notify(ctx, a.identity, b.identity, SocialNotice.Info, text);
      notify(ctx, b.identity, a.identity, SocialNotice.Info, text);
      return;
    }
    completeTrade(ctx, row, a, b, (side) => savePlayer(ctx, { ...side, weapon: '' }));
}
export const confirmTrade = spacetimedb.reducer(
  { tradeId: t.u64(), aOffer: t.string(), bOffer: t.string() },
  (ctx, {tradeId,aOffer,bOffer}) => confirmTradeCore(ctx,tradeId,aOffer,bOffer,0,0)
);
export const confirmTradeCoins = spacetimedb.reducer(
  { tradeId: t.u64(), aOffer: t.string(), bOffer: t.string(), aCoins:t.u32(), bCoins:t.u32() },
  (ctx, {tradeId,aOffer,bOffer,aCoins,bCoins}) => confirmTradeCore(ctx,tradeId,aOffer,bOffer,aCoins,bCoins)
);
export const setTradeCoins = spacetimedb.reducer({tradeId:t.u64(),coins:t.u32()},(ctx,{tradeId,coins})=>{
  const p=requireAlivePlayer(ctx,true);touchInput(p,currentTick(ctx));savePlayer(ctx,p);
  const row=requireTrade(ctx,tradeId,p.identity);
  if(!row.accepted)throw new SenderError('Wait for the trade to be accepted');
  const balance=frontierRepository(ctx).get('profile',p.identity.toHexString())?.coins??0;
  if(coins>balance)throw new SenderError('Not enough coins');
  const field=sameId(row.a,p.identity)?'aCoins':'bCoins';
  if((row[field]??0)===coins)return;
  ctx.db.trade.id.update({...row,[field]:coins,aConfirmed:false,bConfirmed:false,swapTick:0});
});

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
