import { create } from 'zustand';
import type { ChatMode } from '@sim';

/**
 * Local chat preferences: the Nearby/All filter and per-player mutes. Kept in
 * this browser only (localStorage) and never sent to the server; a mute hides
 * that player's chat lines and speech bubbles for you alone.
 */
const KEY = 'berigame.chat.v1';

interface Saved { mode: ChatMode; muted: string[] }

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw);
      return {
        mode: v.mode === 'nearby' ? 'nearby' : 'all',
        muted: Array.isArray(v.muted) ? v.muted.filter((h: unknown) => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h)).slice(0, 500) : [],
      };
    }
  } catch {
    // Private windows and blocked storage: defaults.
  }
  return { mode: 'all', muted: [] };
}

function save(s: Saved) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* not persisted */ }
}

interface ChatPrefs {
  mode: ChatMode;
  /** Muted identity hexes (a Set, replaced on change so selectors see a new value). */
  muted: ReadonlySet<string>;
  /** Your friends' identity hexes, mirrored from the friend table for menus outside React renders. */
  friends: ReadonlySet<string>;
  setMode: (mode: ChatMode) => void;
  toggleMute: (hex: string) => void;
  setFriends: (friends: ReadonlySet<string>) => void;
}

const initial = load();

export const useChatPrefsStore = create<ChatPrefs>((set, get) => ({
  mode: initial.mode,
  muted: new Set(initial.muted),
  friends: new Set(),
  setMode: (mode) => { set({ mode }); save({ mode, muted: [...get().muted] }); },
  toggleMute: (hex) => {
    const next = new Set(get().muted);
    if (next.has(hex)) next.delete(hex); else next.add(hex);
    set({ muted: next });
    save({ mode: get().mode, muted: [...next] });
  },
  setFriends: (friends) => set({ friends }),
}));
