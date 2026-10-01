import { describe, expect, it } from 'vitest';
import { HOTBAR_SIZE, INVENTORY_SIZE, MAX_STACK } from '../constants';
import { STICK_ITEM_ID } from '../items';
import { addItem, countItem, emptySlots, isEmpty, moveItem, removeFromSlot } from '../inventory';

describe('inventory', () => {
  it('stacks into existing stacks before opening new slots', () => {
    let { slots } = addItem(emptySlots(), 'berry_blueberry', 5);
    ({ slots } = addItem(slots, 'berry_blueberry', 3));
    expect(slots[0]).toEqual({ itemId: 'berry_blueberry', quantity: 8 });
    expect(slots[1]).toBeNull();
  });

  it('overflows past the max stack into the next slot', () => {
    const { slots, remaining } = addItem(emptySlots(), 'berry_goldberry', MAX_STACK + 1);
    expect(slots[0]).toEqual({ itemId: 'berry_goldberry', quantity: MAX_STACK });
    expect(slots[1]).toEqual({ itemId: 'berry_goldberry', quantity: 1 });
    expect(remaining).toBe(0);
  });

  it('reports what does not fit when full', () => {
    let slots = emptySlots();
    for (let i = 0; i < INVENTORY_SIZE; i++) slots[i] = { itemId: 'berry_blueberry', quantity: MAX_STACK };
    const r = addItem(slots, 'berry_blueberry', 2);
    expect(r.remaining).toBe(2);
    expect(countItem(r.slots, 'berry_blueberry')).toBe(INVENTORY_SIZE * MAX_STACK);
  });

  it('removes and clears the slot at zero', () => {
    let { slots } = addItem(emptySlots(), 'berry_strawberry', 2);
    let r = removeFromSlot(slots, 0, 1);
    expect(r.removed).toBe(1);
    expect(r.slots[0]).toEqual({ itemId: 'berry_strawberry', quantity: 1 });
    r = removeFromSlot(r.slots, 0, 5);
    expect(r.removed).toBe(1);
    expect(r.slots[0]).toBeNull();
    expect(isEmpty(r.slots)).toBe(true);
  });

  it('moveItem swaps different items and merges same items', () => {
    let slots = emptySlots();
    slots[0] = { itemId: 'berry_blueberry', quantity: 3 };
    slots[4] = { itemId: 'berry_goldberry', quantity: 1 };
    let moved = moveItem(slots, 0, 4);
    expect(moved[0]).toEqual({ itemId: 'berry_goldberry', quantity: 1 });
    expect(moved[4]).toEqual({ itemId: 'berry_blueberry', quantity: 3 });

    slots = emptySlots();
    slots[0] = { itemId: 'berry_blueberry', quantity: MAX_STACK - 1 };
    slots[1] = { itemId: 'berry_blueberry', quantity: 5 };
    moved = moveItem(slots, 1, 0);
    expect(moved[0]).toEqual({ itemId: 'berry_blueberry', quantity: MAX_STACK });
    expect(moved[1]).toEqual({ itemId: 'berry_blueberry', quantity: 4 });

    expect(moveItem(slots, 3, 0)).toEqual(slots); // empty source is a no-op
    expect(moveItem(slots, 0, 0)).toEqual(slots);
  });

  describe('found weapons land in the quick bar', () => {
    const berries = (...ids: string[]) => {
      const slots = emptySlots();
      ids.forEach((id, i) => { slots[i] = { itemId: id, quantity: 2 }; });
      return slots;
    };

    it('take the first empty quick slot', () => {
      const { slots, remaining } = addItem(berries('berry_blueberry'), STICK_ITEM_ID, 1);
      expect(remaining).toBe(0);
      expect(slots[1]).toEqual({ itemId: STICK_ITEM_ID, quantity: 1 });
    });

    it('with the quick bar full, take its last slot and move that stack into the bag', () => {
      const before = berries('berry_goldberry', 'berry_greenberry', 'berry_blueberry', 'berry_strawberry');
      const { slots, remaining } = addItem(before, STICK_ITEM_ID, 1);
      expect(remaining).toBe(0);
      expect(slots[HOTBAR_SIZE - 1]).toEqual({ itemId: STICK_ITEM_ID, quantity: 1 });
      expect(slots[4]).toEqual({ itemId: 'berry_blueberry', quantity: 2 });
      expect(slots.slice(0, 2).map((s) => s?.itemId)).toEqual(['berry_goldberry', 'berry_greenberry']);
      expect(slots[3]).toEqual(before[3]);
    });

    it('never displace another weapon; with only weapons in the bar, use the first free bag slot', () => {
      const before = emptySlots();
      for (let i = 0; i < HOTBAR_SIZE; i++) before[i] = { itemId: STICK_ITEM_ID, quantity: 1 };
      const { slots } = addItem(before, STICK_ITEM_ID, 1);
      expect(slots.slice(0, HOTBAR_SIZE + 1).every((s) => s?.itemId === STICK_ITEM_ID)).toBe(true);
    });

    it('prefer displacing a berry over a weapon when the bar is full', () => {
      const before = berries('berry_goldberry', 'berry_greenberry');
      before[2] = { itemId: STICK_ITEM_ID, quantity: 1 };
      const { slots } = addItem(before, STICK_ITEM_ID, 1);
      expect(slots.slice(0, 3).map((s) => s?.itemId)).toEqual(['berry_goldberry', STICK_ITEM_ID, STICK_ITEM_ID]);
      expect(slots[3]).toEqual({ itemId: 'berry_greenberry', quantity: 2 });
    });

    it('report a weapon that does not fit in a full bag', () => {
      const full = emptySlots().map(() => ({ itemId: 'berry_blueberry', quantity: MAX_STACK }));
      const { slots, remaining } = addItem(full, STICK_ITEM_ID, 1);
      expect(remaining).toBe(1);
      expect(slots).toEqual(full);
    });
  });
});
