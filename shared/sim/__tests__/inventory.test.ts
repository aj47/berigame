import { describe, expect, it } from 'vitest';
import { HOTBAR_SIZE, INVENTORY_SIZE, MAX_STACK } from '../constants';
import { FLINT_KNIFE_ITEM_ID, STICK_ITEM_ID, STONE_CLUB_ITEM_ID } from '../items';
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

  describe('new weapons stay in the bag', () => {
    it.each([STICK_ITEM_ID, STONE_CLUB_ITEM_ID, FLINT_KNIFE_ITEM_ID])('puts %s in the bag even with empty quick slots', (itemId) => {
      const { slots, remaining } = addItem(emptySlots(), itemId, 1);
      expect(remaining).toBe(0);
      expect(slots.slice(0, HOTBAR_SIZE)).toEqual(Array(HOTBAR_SIZE).fill(null));
      expect(slots[HOTBAR_SIZE]).toEqual({ itemId, quantity: 1 });
    });

    it('preserves occupied quick slots and uses the first empty bag slot', () => {
      const before = emptySlots();
      before[0] = { itemId: 'berry_goldberry', quantity: 2 };
      before[1] = { itemId: STICK_ITEM_ID, quantity: 1 };
      before[2] = { itemId: 'berry_blueberry', quantity: 5 };
      before[HOTBAR_SIZE] = { itemId: 'berry_strawberry', quantity: 2 };
      const { slots, remaining } = addItem(before, STICK_ITEM_ID, 1);
      expect(remaining).toBe(0);
      expect(slots.slice(0, HOTBAR_SIZE + 1)).toEqual(before.slice(0, HOTBAR_SIZE + 1));
      expect(slots[HOTBAR_SIZE + 1]).toEqual({ itemId: STICK_ITEM_ID, quantity: 1 });
      expect(before[HOTBAR_SIZE + 1]).toBeNull();
    });

    it('uses one bag slot per stick and reports the remainder without filling the quick bar', () => {
      const before = emptySlots();
      for (let i = HOTBAR_SIZE; i < INVENTORY_SIZE - 2; i++) {
        before[i] = { itemId: 'berry_blueberry', quantity: MAX_STACK };
      }
      const { slots, remaining } = addItem(before, STICK_ITEM_ID, 3);
      expect(remaining).toBe(1);
      expect(slots.slice(0, HOTBAR_SIZE)).toEqual(before.slice(0, HOTBAR_SIZE));
      expect(slots.slice(-2)).toEqual(Array(2).fill({ itemId: STICK_ITEM_ID, quantity: 1 }));
    });

    it('leaves empty quick slots alone when the bag is full', () => {
      const before = emptySlots();
      for (let i = HOTBAR_SIZE; i < INVENTORY_SIZE; i++) {
        before[i] = { itemId: 'berry_blueberry', quantity: MAX_STACK };
      }
      const { slots, remaining } = addItem(before, STICK_ITEM_ID, 1);
      expect(remaining).toBe(1);
      expect(slots).toEqual(before);
    });
  });
});
