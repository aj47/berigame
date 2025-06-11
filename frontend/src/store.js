import { create } from "zustand";

// Log every time state is changed
// usage: create(log((set) => ...
const log = (config) => (set, get, api) =>
  config(
    (args) => {
      console.log("  applying", args);
      set(args);
      console.log("  new state", get());
    },
    get,
    api
  );

export const useChatStore = create((set) => ({
  chatMessages: [],
  justSentMessage: null,
  focusedChat: false,
  setFocusedChat: (isFocused) =>
    set((state) => ({
      focusedChat: isFocused,
    })),
  setJustSentMessage: (message) =>
    set((state) => ({
      justSentMessage: message,
    })),
  addChatMessage: (newChatMessage) =>
    set((state) => ({
      chatMessages: [...state.chatMessages, newChatMessage],
    })),
}));

export const useWebsocketStore = create((set) => ({
  websocketConnection: null,
  allConnections: [],
  setWebSocket: (ws) => set({ websocketConnection: ws }),
  setAllConnections: (connections) =>
    set((state) => ({
      allConnections: [...connections],
    })),
}));

export const useOtherUsersStore = create((set) => ({
  userPositions: {},
  damageToRender: {},
  removeDamageToRender: (connectionId) =>
    set((state) => ({
      damageToRender: {
        ...state.damageToRender,
        [connectionId]: null,
      },
    })),
  addDamageToRender: (newData) =>
    set((state) => ({
      damageToRender: {
        ...state.damageToRender,
        [newData.receivingPlayer]: state.damageToRender[newData.receivingPlayer]
          ? state.damageToRender[newData.receivingPlayer] + newData.damage
          : newData.damage,
      },
    })),
  setUserPositions: (newUserPositions) =>
    set({ userPositions: { ...newUserPositions } }),
  setUserPosition: (newData) =>
    set((state) => ({
      userPositions: { ...state.userPositions, [newData.userId]: newData },
    })),
}));

export const useUserStateStore = create((set) => ({
  userConnectionId: null,
  userFollowing: null,
  userAttacking: null,
  setUserConnectionId: (id) => set({ userConnectionId: id }),
  setUserFollowing: (newObject) => set({ userFollowing: newObject }),
  setUserAttacking: (newObject) => set({ userAttacking: newObject }),
}));

export const useUserInputStore = create((set) => ({
  clickedPointOnLand: null,
  clickedOtherObject: null,
  setClickedPointOnLand: (newPosition) =>
    set({ clickedPointOnLand: newPosition, clickedOtherObject: null }),
  setClickedOtherObject: (newObject) =>
    set({ clickedOtherObject: newObject, clickedPointOnLand: null }),
}));

// Item types
export const ItemType = {
  SWORD: "sword",
  // Future items can be added here
  // POTION: "potion",
  // SHIELD: "shield",
};

// Equipment slots
export const EquipmentSlot = {
  WEAPON: "weapon",
  // Future slots can be added here
  // ARMOR: "armor",
  // SHIELD: "shield",
};

// Inventory store for managing player items
export const useInventoryStore = create((set, get) => ({
  items: [
    {
      id: "sword_1",
      type: ItemType.SWORD,
      name: "Iron Sword",
      description: "A basic iron sword",
      icon: "⚔️", // Using emoji for now, can be replaced with actual images
      quantity: 1,
    },
  ],
  addItem: (item) =>
    set((state) => ({
      items: [...state.items, item],
    })),
  removeItem: (itemId) =>
    set((state) => ({
      items: state.items.filter((item) => item.id !== itemId),
    })),
  getItem: (itemId) => {
    const state = get();
    return state.items.find((item) => item.id === itemId);
  },
}));

// Equipment store for managing equipped items
export const useEquipmentStore = create((set, get) => ({
  equippedItems: {
    [EquipmentSlot.WEAPON]: null,
  },
  equipItem: (slot, itemId) => {
    const inventoryStore = useInventoryStore.getState();
    const item = inventoryStore.getItem(itemId);
    if (item) {
      set((state) => ({
        equippedItems: {
          ...state.equippedItems,
          [slot]: itemId,
        },
      }));
    }
  },
  unequipItem: (slot) =>
    set((state) => ({
      equippedItems: {
        ...state.equippedItems,
        [slot]: null,
      },
    })),
  getEquippedItem: (slot) => {
    const state = get();
    const itemId = state.equippedItems[slot];
    if (itemId) {
      const inventoryStore = useInventoryStore.getState();
      return inventoryStore.getItem(itemId);
    }
    return null;
  },
  isItemEquipped: (itemId) => {
    const state = get();
    return Object.values(state.equippedItems).includes(itemId);
  },
}));
