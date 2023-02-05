import {create} from "zustand";

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
  addChatMessage: (newChatMessage) =>
    set((state) => ({ chatMessages: [...state.chatMessages, newChatMessage] })),
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

export const useUserPositionStore = create((set) => ({
  userPositions: {},
  userConnectionId: null,
  setUserConnectionId: (id) => set({ userConnectionId: id }),
  setUserPositions: (newUserPositions) =>
    set({ userPositions: { ...newUserPositions } }),
  setUserPosition: (newData) =>
    set((state) => ({
      userPositions: { ...state.userPositions, [newData.userId]: newData },
    })),
}));

export const useUserInputStore = create((set) => ({
  clickedPointOnLand: null,
  clickedOtherObject: null,
  setClickedPointOnLand: (newPosition) =>
    set({ clickedPointOnLand: newPosition, clickedOtherObject: null }),
  setClickedOtherObject: (newObject) =>
    set({ clickedOtherObject: newObject, clickedPointOnLand: null }),
}));
