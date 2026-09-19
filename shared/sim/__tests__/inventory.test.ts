import { describe, expect, it } from 'vitest';
import { INVENTORY_SIZE, MAX_STACK } from '../constants';
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
});
