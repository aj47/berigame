import { create } from "zustand";

/**
 * Client-only UI state. Everything about the game world (positions, health,
 * inventory, harvests, ground items, chat) lives in SpacetimeDB tables and is
 * read through the hooks in src/spacetime/hooks.ts.
 */

export const useChatStore = create((set) => ({
  focusedChat: false,
  setFocusedChat: (isFocused) => set({ focusedChat: isFocused }),
}));

export const useUserInputStore = create((set) => ({
  clickedOtherObject: null,
  setClickedOtherObject: (newObject) => set({ clickedOtherObject: newObject }),
}));

export const useInventoryUiStore = create((set) => ({
  draggedFromSlot: null,
  dragOverSlot: null,
  setDraggedFromSlot: (slot) => set({ draggedFromSlot: slot }),
  setDragOverSlot: (slot) => set({ dragOverSlot: slot }),
  clearDragState: () => set({ draggedFromSlot: null, dragOverSlot: null }),
}));

export const useLoadingStore = create((set, get) => ({
  isLoading: true,
  loadingProgress: 0,
  loadingMessage: "Initializing world...",
  assetsToLoad: ["native-woman.glb", "tree.glb"],
  loadedAssets: [],
  startTime: Date.now(),
  gameDataLoaded: false,
  websocketConnected: false,

  setLoading: (isLoading) => set({ isLoading }),
  setLoadingMessage: (message) => set({ loadingMessage: message }),

  setWebsocketConnected: (connected) => set((state) => {
    const assetProgress = state.loadedAssets.length / state.assetsToLoad.length;
    let totalProgress = assetProgress * 0.6;
    if (connected) {
      totalProgress += 0.2;
      if (state.gameDataLoaded) totalProgress += 0.2;
    }
    if (connected && state.gameDataLoaded && state.loadedAssets.length === state.assetsToLoad.length) {
      get().completeLoading();
    }
    return {
      websocketConnected: connected,
      loadingProgress: Math.min(totalProgress, 1),
      loadingMessage: connected ? (state.gameDataLoaded ? "Loading complete!" : "Loading game data...") : "Connecting to server...",
    };
  }),

  setGameDataLoaded: (loaded) => set((state) => {
    const assetProgress = state.loadedAssets.length / state.assetsToLoad.length;
    let totalProgress = assetProgress * 0.6;
    if (state.websocketConnected) {
      totalProgress += 0.2;
      if (loaded) totalProgress += 0.2;
    }
    if (loaded && state.websocketConnected && state.loadedAssets.length === state.assetsToLoad.length) {
      get().completeLoading();
    }
    return {
      gameDataLoaded: loaded,
      loadingProgress: Math.min(totalProgress, 1),
      loadingMessage: loaded ? "Loading complete!" : "Loading game data...",
    };
  }),

  completeLoading: () => {
    const state = get();
    if (!state.isLoading) return;
    const elapsedTime = Date.now() - state.startTime;
    const remainingTime = Math.max(0, 1000 - elapsedTime);
    set({ loadingMessage: "Welcome to BeriGame!", loadingProgress: 1 });
    setTimeout(() => set({ isLoading: false }), remainingTime + 300);
  },

  addLoadedAsset: (assetUrl) => set((state) => {
    if (state.loadedAssets.includes(assetUrl)) return state;
    const newLoadedAssets = [...state.loadedAssets, assetUrl];
    const assetProgress = newLoadedAssets.length / state.assetsToLoad.length;
    let message = "Loading world assets...";
    if (assetProgress >= 0.5) message = "Loading characters...";
    if (assetProgress >= 1) message = "Connecting to server...";
    let totalProgress = assetProgress * 0.6;
    if (state.websocketConnected) {
      totalProgress += 0.2;
      if (state.gameDataLoaded) totalProgress += 0.2;
    }
    if (assetProgress >= 1 && state.websocketConnected && state.gameDataLoaded) {
      get().completeLoading();
    }
    return { loadedAssets: newLoadedAssets, loadingProgress: Math.min(totalProgress, 1), loadingMessage: message };
  }),

  resetLoading: () => set({
    isLoading: true,
    loadingProgress: 0,
    loadingMessage: "Initializing world...",
    loadedAssets: [],
    startTime: Date.now(),
    gameDataLoaded: false,
    websocketConnected: false,
  }),
}));
