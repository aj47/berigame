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
