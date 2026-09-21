import { beforeEach, expect, test } from 'vitest';
import { useLoadingStore } from '../store';
const state = () => useLoadingStore.getState();
beforeEach(() => state().resetLoading());
test('loading waits for graphics, connection and authoritative subscription in any order', () => {
  state().setWebsocketConnected(true);
  state().setGameDataLoaded(true);
  expect(state().isLoading).toBe(true);
  state().addLoadedAsset('/models/starter-adventurer.glb');
  expect(state().isLoading).toBe(false);
  expect(state().loadingProgress).toBe(1);
});
test('disconnect invalidates stale data and rejoin waits for a fresh subscription', () => {
  state().addLoadedAsset('/models/starter-adventurer.glb');
  state().setWebsocketConnected(true);
  state().setGameDataLoaded(true);
  state().setWebsocketConnected(false);
  expect(state().isLoading).toBe(true);
  expect(state().gameDataLoaded).toBe(false);
  state().setWebsocketConnected(true);
  expect(state().isLoading).toBe(true);
  state().setGameDataLoaded(true);
  expect(state().isLoading).toBe(false);
});
test('duplicate and unrelated asset notifications do not satisfy readiness', () => {
  state().setWebsocketConnected(true); state().setGameDataLoaded(true);
  state().addLoadedAsset('/unrelated.png'); state().addLoadedAsset('/unrelated.png');
  expect(state().isLoading).toBe(true);
  state().addLoadedAsset('/models/starter-adventurer.glb');
  state().addLoadedAsset('/models/starter-adventurer.glb');
  expect(state().loadingProgress).toBe(1);
});
test('asset failure remains recoverable even after a subscription update', () => {
  useLoadingStore.setState({ assetError:'Graphics failed' });
  state().setWebsocketConnected(true); state().setGameDataLoaded(true);
  state().addLoadedAsset('/models/starter-adventurer.glb');
  expect(state().isLoading).toBe(true);
  expect(state().loadingMessage).toBe('Graphics failed');
});
