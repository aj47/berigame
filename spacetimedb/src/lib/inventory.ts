import type { Identity } from 'spacetimedb';
import { statsItem } from './stats';
import { GROUND_ITEM_TTL_TICKS, INVENTORY_SIZE, SPIRE_EXIT, TICK_MS, addItem, emptySlots, inSpireFloor, type Slot, type Tile } from '../../../shared/sim';
import { nodeCell } from '../../../shared/sim/interest';
import type { Ctx, GroundItemRow, InventorySlotRow } from './types';
import { idKey } from './playerStore';

export interface SlotSnapshot {
  slots: Slot[];
  rows: Map<number, InventorySlotRow>;
}

/**
 * Owners whose inventory rows were written since the tick last refreshed their
 * load glow (tick.ts refreshLoads). Module memory, so only a speed-up: a
 * rolled-back write leaves an extra entry (one needless recompute), and the
 * tick also sweeps everyone on a new module instance and once a minute.
 */
export const LOAD_DIRTY = new Set<bigint | string>();

/**
 * The tick's copy of owners' slots (module memory, for its per-step key
 * checks): dropped for an owner on any write of theirs (markLoad), and wholly
 * when the module instance changes or the tick's minute sweep clears it.
 * Reducers always read fresh rows (readSlots).
 */
const SLOT_CACHE = new Map<bigint | string, Slot[]>();
let slotCacheDb: object | undefined;

/** Note that `owner`'s inventory changed: its carried value and its cached slots. */
export function markLoad(owner: Identity): void {
  const k = idKey(owner);
  LOAD_DIRTY.add(k);
  SLOT_CACHE.delete(k);
}

/** `owner`'s slots through the tick's cache (see SLOT_CACHE). Do not mutate the result. */
export function cachedSlots(ctx: Ctx, owner: Identity): readonly Slot[] {
  if (slotCacheDb !== ctx.db) { SLOT_CACHE.clear(); slotCacheDb = ctx.db; }
  const k = idKey(owner);
  let slots = SLOT_CACHE.get(k);
  if (!slots) SLOT_CACHE.set(k, (slots = readSlots(ctx, owner).slots));
  return slots;
}

/** Forget every cached slot list (the tick's minute sweep: a safety net for writes that bypass markLoad, e.g. owner SQL). */
export function clearSlotCache(): void {
  SLOT_CACHE.clear();
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
    markLoad(owner);
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
  at: Tile & { region?: string },
  tick: number,
  droppedOnDeath = false
): void {
  if (quantity <= 0) return;
  if (at.region && at.region !== 'bramblewild') {
    // Legacy ground piles have no district column. Keep portable drops and
    // crafting overflow in the regional bags players can see and pick up.
    const base = `item-${owner.toHexString()}-${ctx.timestamp.microsSinceUnixEpoch}`;
    let id = base, suffix = 0;
    while (ctx.db.frontierObject.key.find(`drop:${id}`)) id = `${base}-${++suffix}`;
    const data = { id, region: at.region, x: at.x, z: at.z, slots: [{ itemId, quantity }],
      expiresAt: Number(ctx.timestamp.microsSinceUnixEpoch / 1000n) + GROUND_ITEM_TTL_TICKS * TICK_MS };
    ctx.db.frontierObject.insert({ key: `drop:${id}`, kind: 'drop', region: at.region, data: JSON.stringify(data) });
    return;
  }
  // Nothing can be picked up on the sealed Spire floor, and it is unreachable after the run: a pile that would
  // land there (a raid or Clatterhorn reward paid to a player inside, say) lands at the gate exit instead.
  const spot = inSpireFloor(at) ? SPIRE_EXIT : at;
  ctx.db.groundItem.insert({
    id: 0n,
    itemId,
    quantity,
    x: spot.x,
    z: spot.z,
    droppedBy: owner,
    droppedTick: tick,
    expiresTick: tick + GROUND_ITEM_TTL_TICKS,
    droppedOnDeath,
    cell: nodeCell(spot.x, spot.z),
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
  statsItem(ctx, owner, itemId);
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
