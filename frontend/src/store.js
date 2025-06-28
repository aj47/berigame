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
  // Note: damageToRender and playerHealths moved to combatStore for unified state management
  // Enhanced damage handling (including BLOCKED attacks) is now handled in combatStore
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
  // Note: isDead, isRespawning, health, maxHealth moved to combatStore for unified state management
  position: { x: 0, y: 0, z: 0 }, // Add position tracking
  positionCorrection: null,
  setUserConnectionId: (id) => set({ userConnectionId: id }),
  setUserFollowing: (newObject) => set({ userFollowing: newObject }),
  setUserAttacking: (newObject) => set({ userAttacking: newObject }),
  // Note: setIsDead, setIsRespawning, setHealth, setMaxHealth moved to combatStore
  setPosition: (position) => set({ position }), // Add position setter
  setPositionCorrection: (correction) => set({ positionCorrection: correction }),
  clearPositionCorrection: () => set({ positionCorrection: null }),
}));

export const useUserInputStore = create((set) => ({
  clickedPointOnLand: null,
  clickedOtherObject: null,
  setClickedPointOnLand: (newPosition) =>
    set({ clickedPointOnLand: newPosition, clickedOtherObject: null }),
  setClickedOtherObject: (newObject) =>
    set({ clickedOtherObject: newObject, clickedPointOnLand: null }),
}));

export const useInventoryStore = create((set, get) => ({
  items: Array(28).fill(null), // Initialize with 28 empty slots
  lastValidationTime: 0,
  validationInterval: 30000, // 30 seconds
  // Drag and drop state
  draggedItem: null,
  draggedFromSlot: null,
  dragOverSlot: null,

  // Set entire inventory from backend sync data
  setInventory: (inventoryData) =>
    set(() => {
      const newItems = Array(28).fill(null);

      if (inventoryData && inventoryData.items) {
        inventoryData.items.forEach((item, index) => {
          if (item && index < 28) {
            newItems[index] = {
              ...item,
              // Ensure backward compatibility with old format
              type: item.type || 'consumable',
              subType: item.subType || item.itemId,
              name: item.name,
              icon: item.icon,
              quantity: item.quantity || 1,
              id: item.id || `${item.subType}_${index}_${Date.now()}`
            };
          }
        });
      }

      return { items: newItems };
    }),

  addItem: (item) =>
    set((state) => {
      const newItems = [...state.items];

      // For stackable items (berries), try to stack first
      if (item.type === 'berry') {
        const existingItemIndex = newItems.findIndex(
          (existingItem) =>
            existingItem &&
            existingItem.type === item.type &&
            existingItem.subType === item.subType
        );

        if (existingItemIndex !== -1) {
          // Stack with existing item
          newItems[existingItemIndex] = {
            ...newItems[existingItemIndex],
            quantity: (newItems[existingItemIndex].quantity || 1) + (item.quantity || 1)
          };
          return { items: newItems };
        }
      }

      // Find first empty slot
      const firstEmptySlot = newItems.findIndex((slotItem) => !slotItem);
      if (firstEmptySlot !== -1) {
        newItems[firstEmptySlot] = {
          ...item,
          id: item.id || Date.now() + Math.random()
        };
      } else {
        console.warn('Inventory is full, cannot add item:', item);
      }

      return { items: newItems };
    }),

  removeItem: (itemId, quantityToRemove = 1) =>
    set((state) => ({
      items: state.items.map(item => {
        if (!item || item.id !== itemId) return item;

        const currentQuantity = item.quantity || 1;

        // For stackable items (like berries), decrement quantity
        if (item.type === 'berry' && currentQuantity > quantityToRemove) {
          return {
            ...item,
            quantity: currentQuantity - quantityToRemove
          };
        }

        // For non-stackable items or when quantity reaches 0 or below, remove entirely
        return null;
      }),
    })),

  clearInventory: () =>
    set(() => ({
      items: Array(28).fill(null),
    })),

  // Move item from one slot to another
  moveItem: (fromSlot, toSlot) =>
    set((state) => {
      if (fromSlot === toSlot) return state;

      const newItems = [...state.items];
      // Ensure array is large enough
      while (newItems.length <= Math.max(fromSlot, toSlot)) {
        newItems.push(null);
      }

      const itemToMove = newItems[fromSlot];
      const itemAtDestination = newItems[toSlot];

      // Swap items
      newItems[fromSlot] = itemAtDestination;
      newItems[toSlot] = itemToMove;

      return { items: newItems };
    }),

  // Drag and drop state management
  setDraggedItem: (item, fromSlot) =>
    set(() => ({
      draggedItem: item,
      draggedFromSlot: fromSlot,
    })),

  setDragOverSlot: (slot) =>
    set(() => ({
      dragOverSlot: slot,
    })),

  clearDragState: () =>
    set(() => ({
      draggedItem: null,
      draggedFromSlot: null,
      dragOverSlot: null,
    })),

  getItemCount: (itemType, subType) => {
    const state = get();
    return state.items
      .filter((item) => item && item.type === itemType && (!subType || item.subType === subType))
      .reduce((total, item) => total + (item.quantity || 1), 0);
  },

  shouldValidate: () => {
    const state = get();
    return Date.now() - state.lastValidationTime > state.validationInterval;
  },

  markValidated: () =>
    set(() => ({
      lastValidationTime: Date.now(),
    })),
}));

export const useHarvestStore = create((set, get) => ({
  activeHarvests: {}, // treeId -> { startTime, duration, playerId, timeoutId }
  treeStates: {}, // treeId -> { lastHarvested, cooldownUntil, isHarvestable }
  startHarvest: (treeId, playerId, duration) =>
    set((state) => {
      // Clear any existing timeout for this tree
      const existingHarvest = state.activeHarvests[treeId];
      if (existingHarvest && existingHarvest.timeoutId) {
        clearTimeout(existingHarvest.timeoutId);
      }

      // Set up timeout to auto-cancel harvest if it takes too long
      const timeoutId = setTimeout(() => {
        console.warn(`Harvest timeout for tree ${treeId}, auto-cancelling`);
        get().cancelHarvest(treeId);
      }, (duration + 5) * 1000); // 5 second grace period

      return {
        activeHarvests: {
          ...state.activeHarvests,
          [treeId]: {
            startTime: Date.now(),
            duration: duration * 1000, // convert to milliseconds
            playerId,
            timeoutId,
          },
        },
      };
    }),
  completeHarvest: (treeId) =>
    set((state) => {
      const harvest = state.activeHarvests[treeId];
      if (harvest && harvest.timeoutId) {
        clearTimeout(harvest.timeoutId);
      }

      const newActiveHarvests = { ...state.activeHarvests };
      delete newActiveHarvests[treeId];
      return {
        activeHarvests: newActiveHarvests,
        treeStates: {
          ...state.treeStates,
          [treeId]: {
            lastHarvested: Date.now(),
            cooldownUntil: Date.now() + 30000, // 30 second cooldown
            isHarvestable: false,
          },
        },
      };
    }),
  cancelHarvest: (treeId) =>
    set((state) => {
      const harvest = state.activeHarvests[treeId];
      if (harvest && harvest.timeoutId) {
        clearTimeout(harvest.timeoutId);
      }

      const newActiveHarvests = { ...state.activeHarvests };
      delete newActiveHarvests[treeId];
      return { activeHarvests: newActiveHarvests };
    }),
  updateTreeCooldown: (treeId) =>
    set((state) => {
      const treeState = state.treeStates[treeId];
      if (treeState && Date.now() > treeState.cooldownUntil) {
        return {
          treeStates: {
            ...state.treeStates,
            [treeId]: {
              ...treeState,
              isHarvestable: true,
            },
          },
        };
      }
      return state;
    }),
  getHarvestProgress: (treeId) => (state) => {
    const harvest = state.activeHarvests[treeId];
    if (!harvest) return null;
    const elapsed = Date.now() - harvest.startTime;
    const progress = Math.min(elapsed / harvest.duration, 1);
    return { progress, isComplete: progress >= 1 };
  },
  isTreeHarvestable: (treeId) => (state) => {
    const treeState = state.treeStates[treeId];
    const activeHarvest = state.activeHarvests[treeId];

    // Tree is not harvestable if there's an active harvest
    if (activeHarvest) return false;

    // If no tree state exists, it's harvestable by default
    if (!treeState) return true;

    // Check if cooldown has expired
    return treeState.isHarvestable || Date.now() > treeState.cooldownUntil;
  },
}));

export const useLoadingStore = create((set, get) => ({
  isLoading: true,
  loadingProgress: 0,
  loadingMessage: "Initializing world...",
  assetsToLoad: [
    "native-woman.glb",
    "tree.glb",
    "giant.glb"
  ],
  loadedAssets: [],
  startTime: Date.now(),
  // New state for tracking game data loading
  gameDataLoaded: false,
  websocketConnected: false,

  setLoading: (isLoading) => set({ isLoading }),

  setLoadingMessage: (message) => set({ loadingMessage: message }),

  setWebsocketConnected: (connected) => set((state) => {
    console.log(`WebSocket connection status: ${connected}`);

    // Calculate new progress
    const assetProgress = state.loadedAssets.length / state.assetsToLoad.length;
    let totalProgress = assetProgress * 0.6; // Assets are 60% of total progress

    if (connected) {
      totalProgress += 0.2; // WebSocket connection is 20% of total progress
      if (state.gameDataLoaded) {
        totalProgress += 0.2; // Game data loading is 20% of total progress
      }
    }

    const newState = {
      websocketConnected: connected,
      loadingProgress: Math.min(totalProgress, 1),
      loadingMessage: connected ?
        (state.gameDataLoaded ? "Loading complete!" : "Loading game data...") :
        "Connecting to server..."
    };

    // Check if we can complete loading
    if (connected && state.gameDataLoaded && state.loadedAssets.length === state.assetsToLoad.length) {
      get().completeLoading();
    }

    return newState;
  }),

  setGameDataLoaded: (loaded) => set((state) => {
    console.log(`Game data loaded status: ${loaded}`);

    // Calculate new progress
    const assetProgress = state.loadedAssets.length / state.assetsToLoad.length;
    let totalProgress = assetProgress * 0.6; // Assets are 60% of total progress

    if (state.websocketConnected) {
      totalProgress += 0.2; // WebSocket connection is 20% of total progress
      if (loaded) {
        totalProgress += 0.2; // Game data loading is 20% of total progress
      }
    }

    const newState = {
      gameDataLoaded: loaded,
      loadingProgress: Math.min(totalProgress, 1),
      loadingMessage: loaded ? "Loading complete!" : "Loading game data..."
    };

    // Check if we can complete loading
    if (loaded && state.websocketConnected && state.loadedAssets.length === state.assetsToLoad.length) {
      get().completeLoading();
    }

    return newState;
  }),

  completeLoading: () => {
    const state = get();
    if (state.isLoading) {
      console.log("All loading requirements met, completing loading process");

      // Ensure minimum loading time of 2 seconds for better UX
      const elapsedTime = Date.now() - state.startTime;
      const minLoadingTime = 2000;
      const remainingTime = Math.max(0, minLoadingTime - elapsedTime);

      set({
        loadingMessage: "Welcome to BeriGame!",
        loadingProgress: 1
      });

      setTimeout(() => {
        set({ isLoading: false });
      }, remainingTime + 500); // Extra 500ms to show "Welcome" message
    }
  },

  addLoadedAsset: (assetUrl) => set((state) => {
    // Avoid duplicate assets
    if (state.loadedAssets.includes(assetUrl)) return state;

    console.log(`Loading asset: ${assetUrl}`);
    const newLoadedAssets = [...state.loadedAssets, assetUrl];
    const assetProgress = newLoadedAssets.length / state.assetsToLoad.length;

    let message = "Loading world assets...";
    if (assetProgress >= 0.3) message = "Loading characters...";
    if (assetProgress >= 0.6) message = "Loading environment...";
    if (assetProgress >= 0.9) message = "Connecting to server...";

    // Calculate total progress including WebSocket and game data
    let totalProgress = assetProgress * 0.6; // Assets are 60% of total progress
    if (state.websocketConnected) {
      totalProgress += 0.2; // WebSocket connection is 20% of total progress
      if (state.gameDataLoaded) {
        totalProgress += 0.2; // Game data loading is 20% of total progress
      }
    }

    console.log(`Asset loading progress: ${Math.round(assetProgress * 100)}% (${newLoadedAssets.length}/${state.assetsToLoad.length})`);
    console.log(`Total loading progress: ${Math.round(totalProgress * 100)}%`);

    // Check if we can complete loading (all assets + websocket + game data)
    if (assetProgress >= 1 && state.websocketConnected && state.gameDataLoaded) {
      get().completeLoading();
    }

    return {
      loadedAssets: newLoadedAssets,
      loadingProgress: Math.min(totalProgress, 1),
      loadingMessage: message,
    };
  }),

  resetLoading: () => set({
    isLoading: true,
    loadingProgress: 0,
    loadingMessage: "Initializing world...",
    loadedAssets: [],
    startTime: Date.now(),
    gameDataLoaded: false,
    websocketConnected: false
  })
}));

export const useGroundItemsStore = create((set, get) => ({
  groundItems: [],
  pendingPickups: new Set(), // Track items being picked up to prevent sync conflicts

  addGroundItem: (groundItem) =>
    set((state) => ({
      groundItems: [...state.groundItems, groundItem],
    })),

  // Add ground item and remove any temporary items at the same position
  addGroundItemAndCleanup: (groundItem) =>
    set((state) => {
      // Remove any temporary items at the same position with same item type
      const filteredItems = state.groundItems.filter((item) => {
        if (!item.isTemporary) return true;

        // Check if it's the same type and at the same position (within small tolerance)
        const sameType = item.itemType === groundItem.itemType && item.itemSubType === groundItem.itemSubType;
        const samePosition = Math.abs(item.position.x - groundItem.position.x) < 0.1 &&
                           Math.abs(item.position.y - groundItem.position.y) < 0.1 &&
                           Math.abs(item.position.z - groundItem.position.z) < 0.1;

        // Remove temporary item if it matches
        return !(sameType && samePosition);
      });

      return {
        groundItems: [...filteredItems, groundItem],
      };
    }),

  removeGroundItem: (groundItemId) =>
    set((state) => ({
      groundItems: state.groundItems.filter((item) => item.id !== groundItemId),
    })),

  // Mark item as being picked up (optimistic)
  markItemBeingPickedUp: (groundItemId) =>
    set((state) => {
      const newPendingPickups = new Set(state.pendingPickups);
      newPendingPickups.add(groundItemId);
      return {
        pendingPickups: newPendingPickups,
        groundItems: state.groundItems.filter((item) => item.id !== groundItemId),
      };
    }),

  // Confirm pickup completed (remove from pending)
  confirmPickupCompleted: (groundItemId) =>
    set((state) => {
      const newPendingPickups = new Set(state.pendingPickups);
      newPendingPickups.delete(groundItemId);
      return {
        pendingPickups: newPendingPickups,
      };
    }),

  clearGroundItems: () =>
    set(() => ({
      groundItems: [],
      pendingPickups: new Set(),
    })),

  // Smart sync that respects pending operations
  syncGroundItems: (groundItems) =>
    set((state) => {
      // Filter out items that are currently being picked up
      const filteredGroundItems = groundItems.filter(
        (item) => !state.pendingPickups.has(item.id)
      );

      return {
        groundItems: filteredGroundItems,
      };
    }),
}));
