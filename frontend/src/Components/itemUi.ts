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

/** The first quick slot holding the wielded item, or -1 when punching. */
export function wieldedSlotIndex(
  slots: readonly Slot[],
  weapon: string | undefined,
  hotbarSize: number,
): number {
  if (!weapon) return -1;
  for (let i = 0; i < hotbarSize && i < slots.length; i++)
    if (slots[i]?.itemId === weapon) return i;
  return -1;
}
