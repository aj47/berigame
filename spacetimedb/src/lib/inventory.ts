import type { Identity } from 'spacetimedb';
import { GROUND_ITEM_TTL_TICKS, INVENTORY_SIZE, addItem, emptySlots, type Slot, type Tile } from '../../../shared/sim';
import type { Ctx, GroundItemRow, InventorySlotRow } from './types';

export interface SlotSnapshot {
  slots: Slot[];
  rows: Map<number, InventorySlotRow>;
}

export function readSlots(ctx: Ctx, owner: Identity): SlotSnapshot {
  const slots = emptySlots();
  const rows = new Map<number, InventorySlotRow>();
  for (const row of ctx.db.inventorySlot.owner.filter(owner)) {
    if (row.slot < INVENTORY_SIZE) {
      slots[row.slot] = { itemId: row.itemId, quantity: row.quantity };
      rows.set(row.slot, row);
    }
  }
  return { slots, rows };
}

/** Persist only the slots that differ between `snap.slots` and `after`. */
export function writeSlots(ctx: Ctx, owner: Identity, snap: SlotSnapshot, after: readonly Slot[]): void {
  for (let i = 0; i < INVENTORY_SIZE; i++) {
    const before = snap.slots[i];
    const next = after[i];
    const same = (before === null && next === null)
      || (before !== null && next !== null && before.itemId === next.itemId && before.quantity === next.quantity);
    if (same) continue;
    const row = snap.rows.get(i);
    if (next === null) {
      if (row) ctx.db.inventorySlot.id.delete(row.id);
    } else if (row) {
      ctx.db.inventorySlot.id.update({ ...row, itemId: next.itemId, quantity: next.quantity });
    } else {
      ctx.db.inventorySlot.insert({ id: 0n, owner, slot: i, itemId: next.itemId, quantity: next.quantity });
    }
  }
}

export function dropOnGround(
  ctx: Ctx,
  owner: Identity,
  itemId: string,
  quantity: number,
  at: Tile,
  tick: number,
  droppedOnDeath = false
): void {
  if (quantity <= 0) return;
  ctx.db.groundItem.insert({
    id: 0n,
    itemId,
    quantity,
    x: at.x,
    z: at.z,
    droppedBy: owner,
    droppedTick: tick,
    expiresTick: tick + GROUND_ITEM_TTL_TICKS,
    droppedOnDeath,
  });
}

/** Add only what fits. The caller owns the source and handles its remainder. */
function addToInventory(ctx: Ctx, owner: Identity, itemId: string, quantity: number): number {
  const snap = readSlots(ctx, owner);
  const { slots, remaining } = addItem(snap.slots, itemId, quantity);
  writeSlots(ctx, owner, snap, slots);
  return quantity - remaining;
}

/** A harvested reward is new, so overflow needs a new ground pile. */
export function giveItem(ctx: Ctx, owner: Identity, itemId: string, quantity: number, at: Tile, tick: number): number {
  const taken = addToInventory(ctx, owner, itemId, quantity);
  const remaining = quantity - taken;
  if (remaining > 0) dropOnGround(ctx, owner, itemId, remaining, at, tick);
  return taken;
}

/** Transfer an existing pile; its remainder must stay in that same pile. */
export function takeGroundItem(ctx: Ctx, owner: Identity, item: GroundItemRow): number {
  const taken = addToInventory(ctx, owner, item.itemId, item.quantity);
  if (taken >= item.quantity) ctx.db.groundItem.id.delete(item.id);
  else if (taken > 0) ctx.db.groundItem.id.update({ ...item, quantity: item.quantity - taken });
  return taken;
}
