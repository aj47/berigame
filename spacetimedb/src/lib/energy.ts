import type { Identity } from 'spacetimedb';
import { newEnergy, settleEnergy, spendEnergy, type EnergySpend, type EnergyState } from '../../../shared/sim';
import { frontierRepository, publishOwnView } from './frontier';
import { firstPlayedMs } from './stats';
import type { Ctx } from './types';

/** The stored meter, or a new one at the rested line, sized by the character's age. */
export function loadEnergy(ctx: Ctx, id: Identity, repo = frontierRepository(ctx)): EnergyState {
  const now = Number(ctx.timestamp.microsSinceUnixEpoch / 1000n);
  return repo.get('energy', id.toHexString()) ?? newEnergy(id.toHexString(), now, firstPlayedMs(ctx, id));
}

/** Spend one finished gathering action of `cost` seconds. The meter is stored with the other private frontier records. */
export function spendEnergyFor(ctx: Ctx, id: Identity, cost: number): EnergySpend {
  const repo = frontierRepository(ctx);
  const spent = spendEnergy(loadEnergy(ctx, id, repo), Number(ctx.timestamp.microsSinceUnixEpoch / 1000n), cost);
  repo.put('energy', spent.state);
  publishOwnView(ctx, id, 'energy', id.toHexString(), spent.state);
  return spent;
}

/**
 * Close a stretch of the meter at a session edge: `wasOnline` at a disconnect
 * (online time refills only to the rested line), not at a reconnect (time away
 * refills to the top). Characters that never gathered have no meter yet.
 */
export function settleEnergyFor(ctx: Ctx, id: Identity, wasOnline: boolean): void {
  if (!ctx.db.frontierPrivate) return;
  const repo = frontierRepository(ctx);
  const stored = repo.get('energy', id.toHexString());
  if (!stored) return;
  const next = settleEnergy(stored, Number(ctx.timestamp.microsSinceUnixEpoch / 1000n), wasOnline);
  repo.put('energy', next);
  publishOwnView(ctx, id, 'energy', id.toHexString(), next);
}
