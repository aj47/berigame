import create from "zustand";
import { mountStoreDevtool } from 'simple-zustand-devtools';

export const useChatStore = create((set) => ({
  chatMessages: [],
  addChatMessage: (newChatMessage) =>
    set((state) => ({ chatMessages: [...state.chatMessages, newChatMessage] })),
}));

export const useWebsocketStore = create((set) => ({
  websocketConnection: null,
  setWebSocket: (ws) => set(({ websocketConnection: ws })),
}));

if (process.env.NODE_ENV === 'development') {
  mountStoreDevtool('Store', useWebsocketStore);
}