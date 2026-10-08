import { create } from 'zustand';
import { EventKind, STICK_ITEM_ID, journeyChapterOf, type GoalStepId, type JourneyChapterId, type Tile } from '@sim';
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
  /** Goal steps whose first-time tip has been shown (and the First Day celebration). */
  tipped?: string[];
}

/** The chip's current goal, for the map: where it leads and which journey chapter it belongs to. */
export interface MapGoal {
  id: GoalStepId;
  text: string;
  /** Where the goal sends you (null for an in-place step such as making or eating). */
  target: Tile | null;
}

interface FirstDayState extends Remembered {
  /** Session only: the chip's goal, mirrored for the map. */
  goal: MapGoal | null;
  /** The last journey chapter a goal belonged to, so detours keep the map's place. */
  chapter: JourneyChapterId | null;
  setGoal: (goal: MapGoal | null) => void;
  owner: string | null;
  /** performance.now() of this player's last stick find, for the banner and slot sparkle. */
  stickFoundAt: number | null;
  load: (owner: string | null) => void;
  setDone: (done: string[]) => void;
  onEvent: (me: string | null, e: CombatEvent) => void;
  dismissFind: () => void;
  markTipped: (id: string) => void;
  /** The step whose tip is on screen now (session only; survives the HUD remounting). */
  activeTip: string | null;
  celebrating: boolean;
  setActiveTip: (id: string | null) => void;
  setCelebrating: (on: boolean) => void;
}

const key = (owner: string) => `berigame.firstDay.${owner}`;

function read(owner: string): Remembered {
  try {
    const raw = window.localStorage.getItem(key(owner));
    if (!raw) return { done: [], seen: {}, tipped: [] };
    const parsed = JSON.parse(raw);
    return {
      done: Array.isArray(parsed?.done) ? parsed.done.filter((s: unknown) => typeof s === 'string') : [],
      seen: typeof parsed?.seen === 'object' && parsed.seen ? { harvested: !!parsed.seen.harvested, ate: !!parsed.seen.ate } : {},
      tipped: Array.isArray(parsed?.tipped) ? parsed.tipped.filter((s: unknown) => typeof s === 'string') : [],
    };
  } catch {
    return { done: [], seen: {}, tipped: [] };
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
  tipped: [],
  activeTip: null,
  celebrating: false,
  stickFoundAt: null,
  goal: null,
  chapter: null,
  setGoal: (goal) => {
    const s = get();
    const same = s.goal === goal || (!!s.goal && !!goal && s.goal.id === goal.id && s.goal.text === goal.text
      && s.goal.target?.x === goal.target?.x && s.goal.target?.z === goal.target?.z);
    if (same) return;
    set({ goal, chapter: journeyChapterOf(goal?.id) ?? s.chapter });
  },
  load: (owner) => {
    if (owner === get().owner) return;
    set({ owner, ...(owner ? read(owner) : { done: [], seen: {}, tipped: [] }), stickFoundAt: null, goal: null, chapter: null });
  },
  setDone: (done) => {
    const s = get();
    if (done.length === s.done.length && done.every((d, i) => d === s.done[i])) return;
    set({ done });
    write(s.owner, { done, seen: s.seen, tipped: s.tipped });
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
    write(s.owner, { done: s.done, seen, tipped: s.tipped });
  },
  dismissFind: () => set({ stickFoundAt: null }),
  setActiveTip: (activeTip) => set({ activeTip }),
  setCelebrating: (celebrating) => set({ celebrating }),
  markTipped: (id) => {
    const s = get();
    if (!s.owner || s.tipped?.includes(id)) return;
    const tipped = [...(s.tipped ?? []), id];
    set({ tipped });
    write(s.owner, { done: s.done, seen: s.seen, tipped });
  },
}));
