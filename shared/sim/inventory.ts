import { INVENTORY_SIZE } from './constants';
import { getItemDef } from './items';
import type { Slot } from './types';

export function emptySlots(): Slot[] {
  return Array<Slot>(INVENTORY_SIZE).fill(null);
}

function stackLimit(itemId: string): number {
  return getItemDef(itemId)?.maxStack ?? 1;
}

/**
 * Add `quantity` of `itemId`, topping up existing stacks first, then filling
 * empty slots. Returns the new slot array and whatever did not fit.
 */
export function addItem(slots: readonly Slot[], itemId: string, quantity: number): { slots: Slot[]; remaining: number } {
  const out = slots.slice();
  const limit = stackLimit(itemId);
  let remaining = quantity;
  for (let i = 0; i < out.length && remaining > 0; i++) {
    const s = out[i];
    if (s && s.itemId === itemId && s.quantity < limit) {
      const add = Math.min(limit - s.quantity, remaining);
      out[i] = { itemId, quantity: s.quantity + add };
      remaining -= add;
    }
  }
  for (let i = 0; i < out.length && remaining > 0; i++) {
    if (out[i] === null) {
      const add = Math.min(limit, remaining);
      out[i] = { itemId, quantity: add };
      remaining -= add;
    }
  }
  return { slots: out, remaining };
}

/** Remove up to `quantity` from `slot`. Returns how many were removed. */
export function removeFromSlot(slots: readonly Slot[], slot: number, quantity: number): { slots: Slot[]; removed: number } {
  const out = slots.slice();
  const s = out[slot];
  if (!s || quantity <= 0) return { slots: out, removed: 0 };
  const removed = Math.min(s.quantity, quantity);
  const left = s.quantity - removed;
  out[slot] = left > 0 ? { itemId: s.itemId, quantity: left } : null;
  return { slots: out, removed };
}

/** Swap two slots, or merge when both hold the same item (overflow stays in `from`). */
export function moveItem(slots: readonly Slot[], from: number, to: number): Slot[] {
  const out = slots.slice();
  if (from === to || from < 0 || to < 0 || from >= out.length || to >= out.length) return out;
  const a = out[from];
  const b = out[to];
  if (!a) return out;
  if (b && b.itemId === a.itemId) {
    const limit = stackLimit(a.itemId);
    const moved = Math.min(limit - b.quantity, a.quantity);
    out[to] = { itemId: a.itemId, quantity: b.quantity + moved };
    out[from] = a.quantity - moved > 0 ? { itemId: a.itemId, quantity: a.quantity - moved } : null;
    return out;
  }
  out[from] = b;
  out[to] = a;
  return out;
}

export function countItem(slots: readonly Slot[], itemId: string): number {
  let n = 0;
  for (const s of slots) if (s && s.itemId === itemId) n += s.quantity;
  return n;
}

export function isEmpty(slots: readonly Slot[]): boolean {
  return slots.every((s) => s === null);
}
