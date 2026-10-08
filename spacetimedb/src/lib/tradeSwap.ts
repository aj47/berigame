import type { Identity } from 'spacetimedb';
import { Feat, SocialNotice, describeOffer, executeTrade, inHotbar, parseOffer } from '../../../shared/sim';
import { newProfile } from '../../../shared/sim/frontier/model';
import { progress } from './adventure';
import { frontierRepository, projectFrontier } from './frontier';
import { readSlots, writeSlots } from './inventory';
import { notify, tradesOf } from './social';
import { activity } from './activity';
import type { Ctx, PlayerRow, TradeRow } from './types';

/**
 * Run a confirmed swap now, all or nothing. A swap that cannot run (an item or
 * coins gone, a bag full) clears both confirmations and tells both sides; it
 * never throws, so the tick can call it too. `unwield` is called for a side
 * whose wielded weapon left its quick slots (the caller owns that player row).
 */
export function completeTrade(ctx: Ctx, row: TradeRow, a: PlayerRow, b: PlayerRow, unwield: (side: PlayerRow) => void): boolean {
  const fail = (reason: string) => {
    ctx.db.trade.id.update({ ...row, aConfirmed: false, bConfirmed: false, swapTick: 0 });
    notify(ctx, a.identity, b.identity, SocialNotice.TradeFailed, `Trade not done: ${reason}`);
    notify(ctx, b.identity, a.identity, SocialNotice.TradeFailed, `Trade not done: ${reason}`);
    return false;
  };
  const snapA = readSlots(ctx, a.identity);
  const snapB = readSlots(ctx, b.identity);
  const offerA = parseOffer(row.aOffer) ?? [];
  const offerB = parseOffer(row.bOffer) ?? [];
  const result = executeTrade(
    { slots: snapA.slots, offer: offerA, name: a.name },
    { slots: snapB.slots, offer: offerB, name: b.name },
  );
  if (!result.ok) return fail(result.reason);
  const aCoins = row.aCoins ?? 0, bCoins = row.bCoins ?? 0;
  if (aCoins || bCoins) {
    const repo = frontierRepository(ctx);
    const pa = repo.get('profile', a.identity.toHexString()) ?? newProfile(a.identity.toHexString());
    const pb = repo.get('profile', b.identity.toHexString()) ?? newProfile(b.identity.toHexString());
    if (pa.coins < aCoins || pb.coins < bCoins) return fail('An offered coin balance changed');
    pa.coins += bCoins - aCoins; pb.coins += aCoins - bCoins;
    repo.put('profile', pa); repo.put('profile', pb);
    for (const [owner, amount] of [[pa.id, bCoins - aCoins], [pb.id, aCoins - bCoins]] as const)
      repo.put('ledger', { id: `trade-${row.id}-${owner}`, owner, amount, reason: 'player trade', at: Number(ctx.timestamp.microsSinceUnixEpoch / 1000n) });
    projectFrontier(ctx, repo);
  }
  writeSlots(ctx, a.identity, snapA, result.a);
  writeSlots(ctx, b.identity, snapB, result.b);
  // Wielding requires a copy in a quick slot. Reconcile only after the swap
  // succeeds; offers, cancellations and failed trades leave equipment alone.
  if (a.weapon && !inHotbar(result.a, a.weapon)) unwield(a);
  if (b.weapon && !inHotbar(result.b, b.weapon)) unwield(b);
  ctx.db.trade.id.delete(row.id);
  activity(ctx, a.identity, 'trades');
  activity(ctx, b.identity, 'trades');
  if (offerA.length && !offerB.length) progress(ctx, a.identity, 4, 8, Feat.Befriend);
  if (offerB.length && !offerA.length) progress(ctx, b.identity, 4, 8, Feat.Befriend);
  notify(ctx, a.identity, b.identity, SocialNotice.TradeDone, offerB.length ? `Received ${describeOffer(offerB)} from ${b.name}` : `Gift delivered to ${b.name}: ${describeOffer(offerA)}`);
  notify(ctx, b.identity, a.identity, SocialNotice.TradeDone, offerA.length ? `Received ${describeOffer(offerA)} from ${a.name}` : `Gift delivered to ${a.name}: ${describeOffer(offerB)}`);
  return true;
}

/** Damage to `id` stops a pending swap: confirmations clear and both sides are told. */
export function stopSwapOnHit(ctx: Ctx, id: Identity, name: string): void {
  if (!ctx.db.trade || ctx.db.trade.count() === 0n) return;
  for (const row of tradesOf(ctx, id)) {
    if (!row.swapTick) continue;
    ctx.db.trade.id.update({ ...row, aConfirmed: false, bConfirmed: false, swapTick: 0 });
    const text = `Trade stopped: ${name} was hit. Confirm again when it is safe.`;
    notify(ctx, row.a, row.b, SocialNotice.TradeFailed, text);
    notify(ctx, row.b, row.a, SocialNotice.TradeFailed, text);
  }
}
