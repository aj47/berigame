import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SETTINGS_KEY = 'berigame.settings.v1';

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});
afterEach(() => localStorage.clear());

describe('one-click attack preference', () => {
  it('starts disabled for browsers with an older settings save', async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ graphics: 'low' }));
    const { useSettingsStore } = await import('../spacetime/stores/settingsStore');
    expect(useSettingsStore.getState()).toMatchObject({ graphics: 'low', oneClickAttack: false });
  });

  it('restores an enabled preference after reloading and persists reset', async () => {
    const original = await import('../spacetime/stores/settingsStore');
    original.useSettingsStore.getState().set({ oneClickAttack: true });
    vi.resetModules();
    const reloaded = await import('../spacetime/stores/settingsStore');
    expect(reloaded.useSettingsStore.getState().oneClickAttack).toBe(true);
    reloaded.useSettingsStore.getState().reset();
    vi.resetModules();
    const reset = await import('../spacetime/stores/settingsStore');
    expect(reset.useSettingsStore.getState().oneClickAttack).toBe(false);
  });
});
