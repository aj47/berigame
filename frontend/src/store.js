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

// Recompute readiness from current state; no delayed callback can hide a disconnect.
const loadingState = (state) => {
  const assetProgress = state.loadedAssets.filter((url) => state.assetsToLoad.includes(url)).length / state.assetsToLoad.length;
  const ready = !state.assetError && !state.worldUpdatesStalled && assetProgress === 1 && state.websocketConnected && state.gameDataLoaded;
  return {
    isLoading: !ready,
    loadingProgress: assetProgress * 0.6 + (state.websocketConnected ? 0.2 : 0) + (state.gameDataLoaded ? 0.2 : 0),
    loadingMessage: state.assetError || state.connectionIssue || (state.worldUpdatesStalled ? "Waiting for live world updates. Rejoin if they do not return." : null) || (ready ? "Welcome to BeriGame!" : !state.websocketConnected ? "Connecting to the island…" : !state.gameDataLoaded ? "Loading the live world…" : "Preparing your adventurer…"),
  };
};
export const useLoadingStore = create((set) => ({
  isLoading: true,
  loadingProgress: 0,
  loadingMessage: "Preparing the island…",
  assetsToLoad: ["/models/starter-adventurer.glb"],
  loadedAssets: [],
  assetError: null,
  connectionIssue: null,
  hasSavedSignIn: false,
  worldUpdatesStalled: false,
  setWorldUpdatesStalled: (worldUpdatesStalled) => set((state) => {
    if (state.worldUpdatesStalled === worldUpdatesStalled) return state;
    const next = { ...state, worldUpdatesStalled };
    return { ...next, ...loadingState(next) };
  }),
  gameDataLoaded: false,
  websocketConnected: false,
  setConnectionIssue: (connectionIssue, hasSavedSignIn) => set((state) => {
    const next = { ...state, connectionIssue, hasSavedSignIn };
    return { ...next, ...loadingState(next) };
  }),
  setLoading: (isLoading) => set({ isLoading }),
  setLoadingMessage: (loadingMessage) => set({ loadingMessage }),
  setWebsocketConnected: (connected) => set((state) => {
    const next = { ...state, websocketConnected: connected, gameDataLoaded: connected && state.gameDataLoaded };
    return { ...next, ...loadingState(next) };
  }),
  setGameDataLoaded: (loaded) => set((state) => {
    const next = { ...state, gameDataLoaded: loaded };
    return { ...next, ...loadingState(next) };
  }),
  completeLoading: () => set((state) => loadingState(state)),
  addLoadedAsset: (url) => set((state) => {
    const loadedAssets = [...new Set([...state.loadedAssets, url])];
    return { loadedAssets, ...loadingState({ ...state, loadedAssets }) };
  }),
  resetLoading: () => set({ isLoading: true, loadingProgress: 0, loadingMessage: "Preparing the island…", loadedAssets: [], assetError: null, connectionIssue: null, hasSavedSignIn: false, worldUpdatesStalled: false, gameDataLoaded: false, websocketConnected: false }),
}));
