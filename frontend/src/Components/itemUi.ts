import { INVENTORY_SIZE, type Slot } from "@sim";

/** Bare-fist icon used whenever nothing is wielded. */
export const PUNCH_ICON = "/ui/punch.png";

interface InventoryRow {
  slot: number;
  itemId: string;
  quantity: number;
}

/**
 * Turns this client's inventory rows into a dense slot array (index = slot).
 * Shared by the bag panel and the always-visible quick slots so both agree on
 * what sits where.
 */
export function slotsFromRows(
  rows: Iterable<InventoryRow>,
  size: number = INVENTORY_SIZE,
): Slot[] {
  const out: Slot[] = Array(size).fill(null);
  for (const row of rows)
    if (row.slot >= 0 && row.slot < size)
      out[row.slot] = { itemId: row.itemId, quantity: row.quantity };
  return out;
}

/**
 * Whether slot `index` shows as wielded. The server tracks the wielded item
 * id, not a slot, so every quick slot holding that item counts: two sticks in
 * the quick bar are both "in hand", and pressing either puts the weapon away.
 */
export function isWieldedSlot(
  slots: readonly Slot[],
  index: number,
  weapon: string | undefined,
  hotbarSize: number,
): boolean {
  return !!weapon && index >= 0 && index < hotbarSize && slots[index]?.itemId === weapon;
}
