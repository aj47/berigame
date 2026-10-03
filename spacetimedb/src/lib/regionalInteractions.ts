import { Identity } from 'spacetimedb';
import { EventKind, Pending, SocialNotice, TICK_MS, TRADE_RANGE, facingFromDelta, inHotbar } from '../../../shared/sim';
import { regionalPvPProblem } from '../../../shared/sim/frontier/combat';
import { interactionRoute, perform } from '../../../shared/sim/frontier/engine';
import type { World } from '../../../shared/sim/frontier/model';
import { carrying, duelFor } from './adventure';
import { emitEvent } from './events';
import { readSlots } from './inventory';
import { clearInteractions, currentTick, savePlayer } from './players';
import { notify } from './social';
import { requestTradeInRange, tradePartnerProblem } from './trade';
import type { Ctx, PlayerRow } from './types';

/** Existing identity intents are shared by both district engines; no client-side chase. */
export function advanceRegionalInteractions(ctx: Ctx, w: World): void {
  const T = currentTick(ctx);
  const stop = (p: PlayerRow, reason?: string) => {
    clearInteractions(ctx, p);
    savePlayer(ctx, p);
    if (reason && p.online && p.state === 0) notify(ctx, p.identity, p.identity, SocialNotice.Info, reason);
  };
  const problemFor = (p: PlayerRow, target: PlayerRow | undefined) => {
    const a = w.actors.find(a => a.id === p.identity.toHexString())!;
    const other = target && w.actors.find(a => a.id === target.identity.toHexString());
    if (!a.online || !a.alive || !other?.online || !other.alive || a.region !== other.region) return 'That player is no longer available here';
    if (a.id === other.id) return 'Choose another player';
    if (p.pending === Pending.Trade) return tradePartnerProblem(ctx, p, target);
    if (carrying(ctx, p.identity)) return 'Put down the giant berry first';
    if (p.hostile) {
      if (duelFor(ctx, p.identity) || duelFor(ctx, target!.identity)) return 'Finish the friendly duel before starting ordinary combat';
      return regionalPvPProblem(a, other, w.repo.all('claim'), w.now);
    }
    return null;
  };
  const rows = () => [...ctx.db.player.iter()].filter(p => p.region && p.region !== 'bramblewild' && p.combatTarget);
  // Everyone moves before hits/trade requests, so a moving target is checked at its new position.
  for (const before of rows()) {
    const p = { ...ctx.db.player.identity.find(before.identity)! };
    if (!p.combatTarget) continue;
    const target = ctx.db.player.identity.find(p.combatTarget) ?? undefined;
    const problem = problemFor(p, target);
    if (problem) { stop(p, problem); continue; }
    const a = w.actors.find(a => a.id === p.identity.toHexString())!;
    const other = w.actors.find(a => a.id === target!.identity.toHexString())!;
    const route = interactionRoute(w, a, other, p.pending === Pending.Trade ? TRADE_RANGE : 1);
    if (!route) { stop(p, 'Cannot reach that player. An obstacle or closed gate blocks the way.'); continue; }
    a.target = undefined;
    const steps = w.movementSteps?.(a) ?? 2;
    for (const tile of route.slice(0, steps)) {
      a.facing = facingFromDelta(tile.x - a.x, tile.z - a.z);
      Object.assign(a, tile);
    }
    w.save(a);
  }
  for (const before of rows()) {
    const p = { ...ctx.db.player.identity.find(before.identity)! };
    if (!p.combatTarget) continue;
    const target = ctx.db.player.identity.find(p.combatTarget) ?? undefined;
    const problem = problemFor(p, target);
    if (problem) { stop(p, problem); continue; }
    const a = w.actors.find(a => a.id === p.identity.toHexString())!;
    const other = w.actors.find(a => a.id === target!.identity.toHexString())!;
    const route = interactionRoute(w, a, other, p.pending === Pending.Trade ? TRADE_RANGE : 1);
    if (!route) { stop(p, 'Cannot reach that player. An obstacle or closed gate blocks the way.'); continue; }
    if (route.length) continue;
    if (p.pending === Pending.Trade) {
      stop(p);
      requestTradeInRange(ctx, p, target!, T);
      continue;
    }
    if (!p.hostile) continue;
    const profile = w.repo.get('profile', a.id);
    if (w.now < (profile?.nextAttack ?? 0)) continue;
    a.bag = readSlots(ctx, p.identity).slots;
    other.bag = readSlots(ctx, target!.identity).slots;
    if (a.weapon && !inHotbar(a.bag, a.weapon)) a.weapon = '';
    a.facing = facingFromDelta(other.x - a.x, other.z - a.z);
    other.facing = facingFromDelta(a.x - other.x, a.z - other.z);
    const hp = other.hp;
    perform(w, a, { action: 'attack', id: other.id });
    const attacker = { ...ctx.db.player.identity.find(p.identity)! };
    attacker.nextSwingTick = T + Math.ceil(((w.repo.get('profile', a.id)?.nextAttack ?? w.now) - w.now) / TICK_MS);
    savePlayer(ctx, attacker);
    emitEvent(ctx, { tick: T, kind: EventKind.Hit, attacker: p.identity, defender: target!.identity,
      damage: hp - Math.max(0, other.hp), itemId: a.weapon, defenderHp: Math.max(0, other.hp) });
    if (!other.alive) {
      stop({ ...ctx.db.player.identity.find(Identity.fromString(other.id))! });
      stop({ ...ctx.db.player.identity.find(p.identity)! });
      emitEvent(ctx, { tick: T, kind: EventKind.Death, attacker: p.identity, defender: target!.identity });
    }
  }
}
