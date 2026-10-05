import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useLoadingStore } from '../store';
import { isWebGLError, watchWebGLContext, webglAvailable } from '../Components/3D/webgl';

const state = () => useLoadingStore.getState();
beforeEach(() => { state().resetLoading(); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

test('reports no WebGL when the browser returns no context', () => {
  const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  expect(webglAvailable()).toBe(false);
  spy.mockRestore();
});

test('recognises renderer construction failures', () => {
  expect(isWebGLError(new Error('Error creating WebGL context.'))).toBe(true);
  expect(isWebGLError(new Error('Could not load /models/x.glb'))).toBe(false);
});

test('an unsupported browser blocks loading with a graphics message', () => {
  state().addLoadedAsset('/models/starter-adventurer.glb');
  state().setWebsocketConnected(true); state().setGameDataLoaded(true);
  state().setGraphicsIssue('unsupported');
  expect(state().isLoading).toBe(true);
  expect(state().loadingMessage).toMatch(/WebGL/);
});

test('a context lost and restored quickly stays silent; one that stays lost is reported', () => {
  const canvas = document.createElement('canvas');
  const detach = watchWebGLContext(canvas, 2000);
  canvas.dispatchEvent(new Event('webglcontextlost'));
  vi.advanceTimersByTime(1000);
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  vi.advanceTimersByTime(2000);
  expect(state().graphicsIssue).toBe(null);
  canvas.dispatchEvent(new Event('webglcontextlost'));
  vi.advanceTimersByTime(2000);
  expect(state().graphicsIssue).toBe('lost');
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  expect(state().graphicsIssue).toBe(null);
  detach();
});

test('detaching ignores the deliberate context loss on unmount', () => {
  const canvas = document.createElement('canvas');
  watchWebGLContext(canvas)();
  canvas.dispatchEvent(new Event('webglcontextlost'));
  vi.advanceTimersByTime(5000);
  expect(state().graphicsIssue).toBe(null);
});
