import { create } from 'zustand';
import { EventKind, STICK_ITEM_ID } from '@sim';
import type { CombatEvent } from '../../module_bindings/types';

/**
 * The First Day chip's memory: the done set plus which events this client has
 * seen, kept in localStorage per identity. Storage can be missing or throw
 * (private windows, blocked site data); the chip then re-derives from state
 * and may repeat a step.
 */
interface Remembered {
  done: string[];
  seen: { harvested?: boolean; ate?: boolean };
}

interface FirstDayState extends Remembered {
  owner: string | null;
  /** performance.now() of this player's last stick find, for the banner and slot sparkle. */
  stickFoundAt: number | null;
  load: (owner: string | null) => void;
  setDone: (done: string[]) => void;
  onEvent: (me: string | null, e: CombatEvent) => void;
  dismissFind: () => void;
}

const key = (owner: string) => `berigame.firstDay.${owner}`;

function read(owner: string): Remembered {
  try {
    const raw = window.localStorage.getItem(key(owner));
    if (!raw) return { done: [], seen: {} };
    const parsed = JSON.parse(raw);
    return {
      done: Array.isArray(parsed?.done) ? parsed.done.filter((s: unknown) => typeof s === 'string') : [],
      seen: typeof parsed?.seen === 'object' && parsed.seen ? { harvested: !!parsed.seen.harvested, ate: !!parsed.seen.ate } : {},
    };
  } catch {
    return { done: [], seen: {} };
  }
}

function write(owner: string | null, value: Remembered): void {
  if (!owner) return;
  try {
    window.localStorage.setItem(key(owner), JSON.stringify(value));
  } catch {
    // Storage is a convenience only.
  }
}

export const useFirstDayStore = create<FirstDayState>((set, get) => ({
  owner: null,
  done: [],
  seen: {},
  stickFoundAt: null,
  load: (owner) => {
    if (owner === get().owner) return;
    set({ owner, ...(owner ? read(owner) : { done: [], seen: {} }), stickFoundAt: null });
  },
  setDone: (done) => {
    const s = get();
    if (done.length === s.done.length && done.every((d, i) => d === s.done[i])) return;
    set({ done });
    write(s.owner, { done, seen: s.seen });
  },
  onEvent: (me, e) => {
    if (!me || e.attacker.toHexString() !== me) return;
    const s = get();
    if (e.kind === EventKind.ItemFound && e.itemId === STICK_ITEM_ID) {
      set({ stickFoundAt: performance.now() });
      return;
    }
    const seen = { ...s.seen };
    if (e.kind === EventKind.HarvestDone) seen.harvested = true;
    else if (e.kind === EventKind.Eat) seen.ate = true;
    else return;
    if (seen.harvested === s.seen.harvested && seen.ate === s.seen.ate) return;
    set({ seen });
    write(s.owner, { done: s.done, seen });
  },
  dismissFind: () => set({ stickFoundAt: null }),
}));
