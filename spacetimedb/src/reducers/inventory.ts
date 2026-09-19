import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import {
  EAT_COOLDOWN_TICKS, EAT_SWING_DELAY_TICKS, EventKind, INVENTORY_SIZE, MELEE_RANGE, Pending,
  chebyshev, getItemDef, moveItem as moveSlots, nearestReachableTile, removeFromSlot,
} from '../../../shared/sim';
import { blockedTiles } from '../lib/blocked';
import { emitEvent } from '../lib/events';
import { dropOnGround, giveItem, readSlots, writeSlots } from '../lib/inventory';
import { clearInteractions, currentTick, requireAlivePlayer, savePlayer, touchInput } from '../lib/players';

export const eatBerry = spacetimedb.reducer(
  { slot: t.u8() },
  (ctx, { slot }) => {
    if (slot >= INVENTORY_SIZE) throw new SenderError('bad slot');
    const p = requireAlivePlayer(ctx);
    const T = currentTick(ctx);
    touchInput(p, T);
    if (T < p.eatCooldownUntilTick) throw new SenderError('still chewing');
    const snap = readSlots(ctx, p.identity);
    const item = snap.slots[slot];
    if (!item) throw new SenderError('empty slot');
    const def = getItemDef(item.itemId);
    if (!def || def.healthRestore <= 0) throw new SenderError('not edible');
    const { slots } = removeFromSlot(snap.slots, slot, 1);
    writeSlots(ctx, p.identity, snap, slots);
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + def.healthRestore);
    p.eatCooldownUntilTick = T + EAT_COOLDOWN_TICKS;
    if (p.combatTarget && p.hostile) {
      p.nextSwingTick = Math.max(p.nextSwingTick, T) + EAT_SWING_DELAY_TICKS;
    }
    emitEvent(ctx, { tick: T, kind: EventKind.Eat, attacker: p.identity, defender: p.identity, damage: p.hp - before, defenderHp: p.hp });
    savePlayer(ctx, p);
  }
);

export const moveItem = spacetimedb.reducer(
  { from: t.u8(), to: t.u8() },
  (ctx, { from, to }) => {
    if (from >= INVENTORY_SIZE || to >= INVENTORY_SIZE || from === to) throw new SenderError('bad slots');
    const p = requireAlivePlayer(ctx);
    touchInput(p, currentTick(ctx));
    const snap = readSlots(ctx, p.identity);
    if (!snap.slots[from]) throw new SenderError('empty slot');
    writeSlots(ctx, p.identity, snap, moveSlots(snap.slots, from, to));
    savePlayer(ctx, p);
  }
);

export const dropItem = spacetimedb.reducer(
  { slot: t.u8(), quantity: t.u8() },
  (ctx, { slot, quantity }) => {
    if (slot >= INVENTORY_SIZE || quantity < 1) throw new SenderError('bad drop');
    const p = requireAlivePlayer(ctx);
    const T = currentTick(ctx);
    touchInput(p, T);
    const snap = readSlots(ctx, p.identity);
    const item = snap.slots[slot];
    if (!item) throw new SenderError('empty slot');
    const { slots, removed } = removeFromSlot(snap.slots, slot, quantity);
    writeSlots(ctx, p.identity, snap, slots);
    dropOnGround(ctx, p.identity, item.itemId, removed, p, T);
    savePlayer(ctx, p);
  }
);

export const pickupItem = spacetimedb.reducer(
  { id: t.u64() },
  (ctx, { id }) => {
    const item = ctx.db.groundItem.id.find(id);
    if (!item) throw new SenderError('item is gone');
    const p = requireAlivePlayer(ctx);
    const T = currentTick(ctx);
    touchInput(p, T);
    clearInteractions(ctx, p);
    if (chebyshev(p, item) <= MELEE_RANGE) {
      const taken = giveItem(ctx, p.identity, item.itemId, item.quantity, p, T);
      if (taken >= item.quantity) ctx.db.groundItem.id.delete(item.id);
      else if (taken > 0) ctx.db.groundItem.id.update({ ...item, quantity: item.quantity - taken });
    } else {
      p.pending = Pending.Pickup;
      p.pendingId = item.id;
      const dest = nearestReachableTile(p, item, blockedTiles(ctx));
      p.targetX = dest.x;
      p.targetZ = dest.z;
    }
    savePlayer(ctx, p);
  }
);
