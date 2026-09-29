/**
 * Direct item hand-off between two players, with two-sided confirmation:
 * request -> accept -> both place items -> both confirm -> one atomic swap.
 * Any offer change clears both confirmations. Items stay in the bags until the
 * swap (no escrow), so the swap re-checks everything against the live bags.
 */
import { HOTBAR_SIZE } from './constants';
import { addItem, countItem } from './inventory';
import { getItemDef } from './items';
import type { ItemStack, Slot } from './types';

/** Chebyshev tiles: request and accept within this. */
export const TRADE_RANGE = 3;
/** The trade is cancelled when the two players are further apart than this. */
export const TRADE_BREAK_RANGE = 6;
/** An unanswered request lapses after this many ticks (30 s). */
export const TRADE_REQUEST_TICKS = 50;
/** Distinct item kinds one side may offer. */
export const MAX_TRADE_STACKS = 8;
export const MAX_OFFER_LEN = 256;

const itemName = (id: string) => getItemDef(id)?.name ?? id;

/** Offers travel as "itemId:qty,itemId:qty" (merged, sorted). "" is an empty offer. */
export function formatOffer(items: readonly ItemStack[]): string {
  const merged = new Map<string, number>();
  for (const it of items) if (it.quantity > 0) merged.set(it.itemId, (merged.get(it.itemId) ?? 0) + it.quantity);
  return [...merged.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, q]) => `${id}:${q}`)
    .join(',');
}

/** Parse an offer string; null when malformed or naming an unknown item. */
export function parseOffer(raw: string): ItemStack[] | null {
  if (raw.length > MAX_OFFER_LEN) return null;
  if (raw === '') return [];
  const out: ItemStack[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const m = /^([a-z0-9_]{1,32}):([1-9][0-9]{0,3})$/.exec(part);
    if (!m || seen.has(m[1]) || !getItemDef(m[1])) return null;
    seen.add(m[1]);
    out.push({ itemId: m[1], quantity: Number(m[2]) });
  }
  return out.length > MAX_TRADE_STACKS ? null : out;
}

/** Why `offer` cannot come out of this bag right now, or null when it can. */
export function offerProblem(offer: readonly ItemStack[], slots: readonly Slot[], weapon: string): string | null {
  for (const it of offer) {
    if (weapon !== '' && it.itemId === weapon) return `Unwield your ${itemName(it.itemId)} before trading it`;
    if (countItem(slots, it.itemId) < it.quantity) return `You do not have ${it.quantity} ${itemName(it.itemId)}`;
  }
  return null;
}

/** Take `quantity` of `itemId` out, from the back of the bag first so the quick bar is kept. */
export function removeItemCount(slots: readonly Slot[], itemId: string, quantity: number): Slot[] {
  const out = slots.slice();
  let left = quantity;
  const order: number[] = [];
  for (let i = out.length - 1; i >= HOTBAR_SIZE; i--) order.push(i);
  for (let i = Math.min(HOTBAR_SIZE, out.length) - 1; i >= 0; i--) order.push(i);
  for (const i of order) {
    if (left <= 0) break;
    const s = out[i];
    if (!s || s.itemId !== itemId) continue;
    const take = Math.min(left, s.quantity);
    left -= take;
    out[i] = s.quantity - take > 0 ? { itemId, quantity: s.quantity - take } : null;
  }
  if (left > 0) throw new Error('not enough items');
  return out;
}

export interface TradeSide { slots: readonly Slot[]; weapon: string; offer: readonly ItemStack[]; name: string }
export type TradeResult = { ok: true; a: Slot[]; b: Slot[] } | { ok: false; reason: string };

/**
 * The swap, all or nothing: both offers must still be in the bags (and not
 * wielded), and each bag must fit what it receives after giving its own.
 */
export function executeTrade(a: TradeSide, b: TradeSide): TradeResult {
  for (const side of [a, b]) {
    const problem = offerProblem(side.offer, side.slots, side.weapon);
    if (problem) {
      return { ok: false, reason: side.weapon && side.offer.some((it) => it.itemId === side.weapon)
        ? `${side.name} must unwield their ${itemName(side.weapon)} first`
        : `${side.name} no longer has what they offered` };
    }
  }
  let sa = a.slots.slice();
  let sb = b.slots.slice();
  for (const it of a.offer) sa = removeItemCount(sa, it.itemId, it.quantity);
  for (const it of b.offer) sb = removeItemCount(sb, it.itemId, it.quantity);
  for (const it of b.offer) {
    const r = addItem(sa, it.itemId, it.quantity);
    if (r.remaining > 0) return { ok: false, reason: `${a.name}'s bag is too full` };
    sa = r.slots;
  }
  for (const it of a.offer) {
    const r = addItem(sb, it.itemId, it.quantity);
    if (r.remaining > 0) return { ok: false, reason: `${b.name}'s bag is too full` };
    sb = r.slots;
  }
  return { ok: true, a: sa, b: sb };
}

/** Human summary of an offer, e.g. "2 Blueberry, Sturdy stick". */
export function describeOffer(items: readonly ItemStack[]): string {
  if (items.length === 0) return 'nothing';
  return items.map((it) => (it.quantity > 1 ? `${it.quantity} ${itemName(it.itemId)}` : itemName(it.itemId))).join(', ');
}
