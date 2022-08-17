import create from "zustand";

export const useChatStore = create((set) => ({
  chatMessages: [],
  addChatMessage: (newChatMessage) =>
    set((state) => ({ chatMessages: [...state.chatMessages, newChatMessage] })),
}));

export const useWebsocketStore = create((set) => ({
  websocketConnection: null,
  allConnections: null,
  setWebSocket: (ws) => set({ websocketConnection: ws }),
  setAllConnections: (connections) => set({ allConnections: connections }),
}));

export const useUserPositionStore = create((set) => ({
  userPositions: {},
  userConnectionId: null,
  setUserConnectionId: (id) => set({ userConnectionId: id }),
  setUserPositions: (newUserPositions) => set({userPositions: {...newUserPositions}})
}));
