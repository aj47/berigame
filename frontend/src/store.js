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
  playerHealths: {},
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
  setPlayerHealth: (playerId, health) =>
    set((state) => ({
      playerHealths: {
        ...state.playerHealths,
        [playerId]: health,
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
  isDead: false,
  isRespawning: false,
  health: 30,
  maxHealth: 30,
  setUserConnectionId: (id) => set({ userConnectionId: id }),
  setUserFollowing: (newObject) => set({ userFollowing: newObject }),
  setUserAttacking: (newObject) => set({ userAttacking: newObject }),
  setIsDead: (isDead) => set({ isDead }),
  setIsRespawning: (isRespawning) => set({ isRespawning }),
  setHealth: (health) => set({ health }),
  setMaxHealth: (maxHealth) => set({ maxHealth }),
}));

export const useUserInputStore = create((set) => ({
  clickedPointOnLand: null,
  clickedOtherObject: null,
  setClickedPointOnLand: (newPosition) =>
    set({ clickedPointOnLand: newPosition, clickedOtherObject: null }),
  setClickedOtherObject: (newObject) =>
    set({ clickedOtherObject: newObject, clickedPointOnLand: null }),
}));

export const useInventoryStore = create((set) => ({
  items: [],
  addItem: (item) =>
    set((state) => ({
      items: [...state.items, { ...item, id: Date.now() + Math.random() }],
    })),
  removeItem: (itemId) =>
    set((state) => ({
      items: state.items.filter((item) => item.id !== itemId),
    })),
  getItemCount: (itemType) => (state) =>
    state.items.filter((item) => item.type === itemType).length,
}));

export const useHarvestStore = create((set, get) => ({
  activeHarvests: {}, // treeId -> { startTime, duration, playerId }
  treeStates: {}, // treeId -> { lastHarvested, cooldownUntil, isHarvestable }
  startHarvest: (treeId, playerId, duration) =>
    set((state) => ({
      activeHarvests: {
        ...state.activeHarvests,
        [treeId]: {
          startTime: Date.now(),
          duration: duration * 1000, // convert to milliseconds
          playerId,
        },
      },
    })),
  completeHarvest: (treeId) =>
    set((state) => {
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
