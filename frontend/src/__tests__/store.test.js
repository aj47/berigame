import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useInventoryStore, useGroundItemsStore } from '../store';

describe('Inventory Store Drag and Drop', () => {
  let store;

  beforeEach(() => {
    // Reset store state before each test
    store = useInventoryStore.getState();
    store.clearInventory();
    store.clearDragState();
  });

  it('should initialize with empty drag state', () => {
    expect(store.draggedItem).toBeNull();
    expect(store.draggedFromSlot).toBeNull();
    expect(store.dragOverSlot).toBeNull();
  });

  it('should set dragged item correctly', () => {
    const item = { id: 1, type: 'berry', subType: 'blueberry', name: 'Blueberry' };
    const slot = 0;

    store.setDraggedItem(item, slot);

    const newState = useInventoryStore.getState();
    expect(newState.draggedItem).toEqual(item);
    expect(newState.draggedFromSlot).toBe(slot);
  });

  it('should set drag over slot correctly', () => {
    const slot = 5;

    store.setDragOverSlot(slot);

    const newState = useInventoryStore.getState();
    expect(newState.dragOverSlot).toBe(slot);
  });

  it('should clear drag state correctly', () => {
    // Set up some drag state
    const item = { id: 1, type: 'berry', subType: 'blueberry', name: 'Blueberry' };
    store.setDraggedItem(item, 0);
    store.setDragOverSlot(5);

    // Clear it
    store.clearDragState();

    const newState = useInventoryStore.getState();
    expect(newState.draggedItem).toBeNull();
    expect(newState.draggedFromSlot).toBeNull();
    expect(newState.dragOverSlot).toBeNull();
  });

  it('should move items between slots correctly', () => {
    // Add some items to the inventory
    const item1 = { type: 'berry', subType: 'blueberry', name: 'Blueberry' };
    const item2 = { type: 'berry', subType: 'strawberry', name: 'Strawberry' };

    store.addItem(item1);
    store.addItem(item2);

    let state = useInventoryStore.getState();
    expect(state.items[0]).toMatchObject({ type: 'berry', subType: 'blueberry' });
    expect(state.items[1]).toMatchObject({ type: 'berry', subType: 'strawberry' });

    // Move item from slot 0 to slot 5 (empty slot)
    store.moveItem(0, 5);

    state = useInventoryStore.getState();
    console.log('After move - slot 0:', state.items[0]);
    console.log('After move - slot 5:', state.items[5]);

    // When moving to an empty slot, the original slot should become null
    expect(state.items[0]).toBeNull();
    expect(state.items[5]).toMatchObject({ type: 'berry', subType: 'blueberry' });
    // Slot 1 should still have the strawberry
    expect(state.items[1]).toMatchObject({ type: 'berry', subType: 'strawberry' });
  });

  it('should handle moving to same slot (no-op)', () => {
    const item = { id: 1, type: 'berry', subType: 'blueberry', name: 'Blueberry' };
    store.addItem(item);

    const stateBefore = useInventoryStore.getState();
    store.moveItem(0, 0);
    const stateAfter = useInventoryStore.getState();

    expect(stateAfter.items).toEqual(stateBefore.items);
  });

  it('should handle moving within fixed 28-slot array', () => {
    const item = { id: 1, type: 'berry', subType: 'blueberry', name: 'Blueberry' };
    store.addItem(item);

    // Move to slot 10 (within 28-slot limit)
    store.moveItem(0, 10);

    const state = useInventoryStore.getState();
    expect(state.items.length).toBe(28); // Fixed array size
    expect(state.items[10]).toMatchObject({ type: 'berry', subType: 'blueberry' });
    expect(state.items[0]).toBeNull();
  });

  it('should swap items when both slots are occupied', () => {
    const item1 = { id: 1, type: 'berry', subType: 'blueberry', name: 'Blueberry' };
    const item2 = { id: 2, type: 'berry', subType: 'strawberry', name: 'Strawberry' };
    
    store.addItem(item1);
    store.addItem(item2);

    // Swap items in slots 0 and 1
    store.moveItem(0, 1);

    const state = useInventoryStore.getState();
    expect(state.items[0]).toMatchObject({ type: 'berry', subType: 'strawberry' });
    expect(state.items[1]).toMatchObject({ type: 'berry', subType: 'blueberry' });
  });

  it('should handle removeItem with slot-based approach', () => {
    const item1 = { id: 1, type: 'berry', subType: 'blueberry', name: 'Blueberry' };
    const item2 = { id: 2, type: 'berry', subType: 'strawberry', name: 'Strawberry' };
    
    store.addItem(item1);
    store.addItem(item2);

    let state = useInventoryStore.getState();
    const itemToRemove = state.items[0];
    
    store.removeItem(itemToRemove.id);

    state = useInventoryStore.getState();
    expect(state.items[0]).toBeNull();
    expect(state.items[1]).toMatchObject({ type: 'berry', subType: 'strawberry' });
  });

  it('should count items correctly with null slots', () => {
    // Add different berry types to avoid stacking
    const item1 = { type: 'berry', subType: 'blueberry', name: 'Blueberry', quantity: 3 };
    const item2 = { type: 'berry', subType: 'strawberry', name: 'Strawberry', quantity: 2 };

    store.addItem(item1);
    store.addItem(item2);

    let state = useInventoryStore.getState();
    const item1Id = state.items[0].id;

    // Remove 1 berry from the stack (new quantity-aware behavior)
    store.removeItem(item1Id, 1);

    state = useInventoryStore.getState();
    const blueberryCount = store.getItemCount('berry', 'blueberry');
    const strawberryCount = store.getItemCount('berry', 'strawberry');
    expect(blueberryCount).toBe(2); // 3 - 1 = 2 blueberries remaining
    expect(strawberryCount).toBe(2); // Strawberry should remain unchanged

    // Remove all remaining blueberries to test complete removal
    store.removeItem(item1Id, 2);

    state = useInventoryStore.getState();
    const blueberryCountAfter = store.getItemCount('berry', 'blueberry');
    expect(blueberryCountAfter).toBe(0); // All blueberries removed
    expect(state.items[0]).toBeNull(); // Slot should be null when quantity reaches 0
  });

  it('should handle berry consumption correctly (quantity-aware removal)', () => {
    // Test the specific berry consumption behavior
    const berryStack = { type: 'berry', subType: 'blueberry', name: 'Blueberry', quantity: 5 };

    store.addItem(berryStack);

    let state = useInventoryStore.getState();
    const berryId = state.items[0].id;

    // Consume 1 berry (like eating)
    store.removeItem(berryId, 1);

    state = useInventoryStore.getState();
    expect(state.items[0]).not.toBeNull(); // Item should still exist
    expect(state.items[0].quantity).toBe(4); // Quantity should be reduced by 1
    expect(store.getItemCount('berry', 'blueberry')).toBe(4);

    // Consume another berry
    store.removeItem(berryId, 1);

    state = useInventoryStore.getState();
    expect(state.items[0].quantity).toBe(3); // Quantity should be reduced by 1 again
    expect(store.getItemCount('berry', 'blueberry')).toBe(3);

    // Consume all remaining berries at once
    store.removeItem(berryId, 3);

    state = useInventoryStore.getState();
    expect(state.items[0]).toBeNull(); // Item should be completely removed
    expect(store.getItemCount('berry', 'blueberry')).toBe(0);
  });

  it('should initialize with exactly 28 slots', () => {
    const state = useInventoryStore.getState();
    expect(state.items).toHaveLength(28);
    expect(state.items.every(slot => slot === null)).toBe(true);
  });

  it('should handle setInventory with new slot-based format', () => {
    const inventoryData = {
      items: [
        { id: 'item1', type: 'consumable', subType: 'berry_blueberry', name: 'Blueberry', icon: '/blueberry.svg', quantity: 5 },
        null, // empty slot
        { id: 'item2', type: 'consumable', subType: 'berry_strawberry', name: 'Strawberry', icon: '/strawberry.svg', quantity: 3 },
      ]
    };

    store.setInventory(inventoryData);

    const state = useInventoryStore.getState();
    expect(state.items).toHaveLength(28);
    expect(state.items[0]).toMatchObject({
      type: 'consumable',
      subType: 'berry_blueberry',
      name: 'Blueberry',
      quantity: 5
    });
    expect(state.items[1]).toBeNull();
    expect(state.items[2]).toMatchObject({
      type: 'consumable',
      subType: 'berry_strawberry',
      name: 'Strawberry',
      quantity: 3
    });
  });

  it('should handle inventory full scenario', () => {
    // Fill all 28 slots
    for (let i = 0; i < 28; i++) {
      store.addItem({
        type: 'berry',
        subType: `berry_${i}`,
        name: `Berry ${i}`,
        quantity: 1
      });
    }

    let state = useInventoryStore.getState();
    expect(state.items.filter(item => item !== null)).toHaveLength(28);

    // Try to add one more item - should fail gracefully
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    store.addItem({ type: 'berry', subType: 'overflow_berry', name: 'Overflow Berry', quantity: 1 });

    state = useInventoryStore.getState();
    expect(state.items.filter(item => item !== null)).toHaveLength(28); // Still 28
    expect(consoleSpy).toHaveBeenCalledWith('Inventory is full, cannot add item:', expect.any(Object));

    consoleSpy.mockRestore();
  });

  it('should handle backward compatibility with legacy format', () => {
    const inventoryData = {
      items: [
        { id: 'item1', type: 'berry', subType: 'blueberry', name: 'Blueberry', icon: '/blueberry.svg', quantity: 5 },
      ]
    };

    store.setInventory(inventoryData);

    const state = useInventoryStore.getState();
    expect(state.items[0]).toMatchObject({
      type: 'berry', // Should maintain legacy type
      subType: 'blueberry', // Should maintain legacy subType
      name: 'Blueberry',
      quantity: 5
    });
  });
});

describe('Ground Items Store', () => {
  let groundStore;

  beforeEach(() => {
    groundStore = useGroundItemsStore.getState();
    groundStore.clearGroundItems();
  });

  it('should add ground items correctly', () => {
    const groundItem = {
      id: 'test-item-1',
      itemType: 'berry',
      itemSubType: 'blueberry',
      quantity: 1,
      position: { x: 0, y: 0, z: 0 },
      droppedBy: 'player1',
      droppedAt: Date.now(),
    };

    groundStore.addGroundItem(groundItem);

    const state = useGroundItemsStore.getState();
    expect(state.groundItems).toHaveLength(1);
    expect(state.groundItems[0]).toEqual(groundItem);
  });

  it('should remove temporary items when adding real ones at same position', () => {
    const tempItem = {
      id: 'temp-item-1',
      itemType: 'berry',
      itemSubType: 'blueberry',
      quantity: 1,
      position: { x: 5, y: 0, z: 5 },
      droppedBy: 'local',
      droppedAt: Date.now(),
      isTemporary: true,
    };

    const realItem = {
      id: 'real-item-1',
      itemType: 'berry',
      itemSubType: 'blueberry',
      quantity: 1,
      position: { x: 5, y: 0, z: 5 },
      droppedBy: 'player1',
      droppedAt: Date.now(),
    };

    // Add temporary item first
    groundStore.addGroundItem(tempItem);
    let state = useGroundItemsStore.getState();
    expect(state.groundItems).toHaveLength(1);
    expect(state.groundItems[0].isTemporary).toBe(true);

    // Add real item - should replace temporary
    groundStore.addGroundItemAndCleanup(realItem);
    state = useGroundItemsStore.getState();
    expect(state.groundItems).toHaveLength(1);
    expect(state.groundItems[0].id).toBe('real-item-1');
    expect(state.groundItems[0].isTemporary).toBeUndefined();
  });

  it('should keep temporary items at different positions', () => {
    const tempItem1 = {
      id: 'temp-item-1',
      itemType: 'berry',
      itemSubType: 'blueberry',
      quantity: 1,
      position: { x: 5, y: 0, z: 5 },
      droppedBy: 'local',
      droppedAt: Date.now(),
      isTemporary: true,
    };

    const realItem = {
      id: 'real-item-1',
      itemType: 'berry',
      itemSubType: 'blueberry',
      quantity: 1,
      position: { x: 10, y: 0, z: 10 }, // Different position
      droppedBy: 'player1',
      droppedAt: Date.now(),
    };

    // Add temporary item first
    groundStore.addGroundItem(tempItem1);

    // Add real item at different position
    groundStore.addGroundItemAndCleanup(realItem);

    const state = useGroundItemsStore.getState();
    expect(state.groundItems).toHaveLength(2);
  });

  it('should handle pickup simulation correctly', () => {
    const groundItem = {
      id: 'ground-item-1',
      itemType: 'berry',
      itemSubType: 'blueberry',
      quantity: 3,
      position: { x: 0, y: 0, z: 0 },
      droppedBy: 'player1',
      droppedAt: Date.now(),
    };

    // Add ground item
    groundStore.addGroundItem(groundItem);
    let state = useGroundItemsStore.getState();
    expect(state.groundItems).toHaveLength(1);

    // Simulate pickup by removing ground item
    groundStore.removeGroundItem('ground-item-1');
    state = useGroundItemsStore.getState();
    expect(state.groundItems).toHaveLength(0);
  });

  it('should handle pending pickups correctly', () => {
    const groundItem = {
      id: 'ground-item-1',
      itemType: 'berry',
      itemSubType: 'blueberry',
      quantity: 3,
      position: { x: 0, y: 0, z: 0 },
      droppedBy: 'player1',
      droppedAt: Date.now(),
    };

    // Add ground item
    groundStore.addGroundItem(groundItem);
    let state = useGroundItemsStore.getState();
    expect(state.groundItems).toHaveLength(1);
    expect(state.pendingPickups.size).toBe(0);

    // Mark item as being picked up
    groundStore.markItemBeingPickedUp('ground-item-1');
    state = useGroundItemsStore.getState();
    expect(state.groundItems).toHaveLength(0); // Item removed from ground
    expect(state.pendingPickups.has('ground-item-1')).toBe(true); // Item in pending

    // Confirm pickup completed
    groundStore.confirmPickupCompleted('ground-item-1');
    state = useGroundItemsStore.getState();
    expect(state.pendingPickups.has('ground-item-1')).toBe(false); // Item no longer pending
  });

  it('should handle new item format with itemId field', () => {
    const groundItem = {
      id: 'ground-item-1',
      itemType: 'consumable',
      itemId: 'berry_blueberry', // New format with itemId
      quantity: 5,
      position: { x: 0, y: 0, z: 0 },
      droppedBy: 'player1',
      droppedAt: Date.now(),
    };

    groundStore.addGroundItem(groundItem);
    const state = useGroundItemsStore.getState();
    expect(state.groundItems).toHaveLength(1);
    expect(state.groundItems[0].itemId).toBe('berry_blueberry');
    expect(state.groundItems[0].quantity).toBe(5);
  });

  it('should handle mixed legacy and new ground item formats', () => {
    const legacyItem = {
      id: 'legacy-item-1',
      itemType: 'berry',
      itemSubType: 'blueberry',
      quantity: 3,
      position: { x: 0, y: 0, z: 0 },
      droppedBy: 'player1',
      droppedAt: Date.now(),
    };

    const newItem = {
      id: 'new-item-1',
      itemType: 'consumable',
      itemId: 'berry_strawberry',
      quantity: 2,
      position: { x: 5, y: 0, z: 5 },
      droppedBy: 'player2',
      droppedAt: Date.now(),
    };

    groundStore.addGroundItem(legacyItem);
    groundStore.addGroundItem(newItem);

    const state = useGroundItemsStore.getState();
    expect(state.groundItems).toHaveLength(2);

    // Legacy item should still work
    expect(state.groundItems[0].itemSubType).toBe('blueberry');
    expect(state.groundItems[0].itemId).toBeUndefined();

    // New item should have itemId
    expect(state.groundItems[1].itemId).toBe('berry_strawberry');
  });

  it('should prevent sync conflicts with pending pickups', () => {
    const groundItem1 = {
      id: 'ground-item-1',
      itemType: 'berry',
      itemSubType: 'blueberry',
      quantity: 1,
      position: { x: 0, y: 0, z: 0 },
      droppedBy: 'player1',
      droppedAt: Date.now(),
    };

    const groundItem2 = {
      id: 'ground-item-2',
      itemType: 'berry',
      itemSubType: 'strawberry',
      quantity: 1,
      position: { x: 5, y: 0, z: 5 },
      droppedBy: 'player2',
      droppedAt: Date.now(),
    };

    // Add both items
    groundStore.addGroundItem(groundItem1);
    groundStore.addGroundItem(groundItem2);

    // Mark first item as being picked up
    groundStore.markItemBeingPickedUp('ground-item-1');

    // Simulate server sync that includes both items (before pickup was processed)
    const serverGroundItems = [groundItem1, groundItem2];
    groundStore.syncGroundItems(serverGroundItems);

    const state = useGroundItemsStore.getState();
    // Should only have item 2 (item 1 is filtered out due to pending pickup)
    expect(state.groundItems).toHaveLength(1);
    expect(state.groundItems[0].id).toBe('ground-item-2');
    expect(state.pendingPickups.has('ground-item-1')).toBe(true);
  });
});
