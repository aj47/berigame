import { create } from 'zustand';
import { GARDEN_PLOT_TILES, type Tile } from '@sim';

/**
 * A garden action waiting for you to walk up to the terrace: tapping a plot
 * from afar walks you there, then the action runs once you are within reach.
 * Walking somewhere else drops it.
 */
export interface QueuedGardenAction {
  kind: 'plant' | 'harvest';
  plot: number;
  itemId?: string;
  /** Where we sent you (to tell "still walking there" from "went elsewhere"). */
  target: Tile;
}

interface GardenState {
  queued: QueuedGardenAction | null;
  queue: (a: Omit<QueuedGardenAction, 'target'>) => QueuedGardenAction;
  clear: () => void;
}

export const useGardenStore = create<GardenState>((set) => ({
  queued: null,
  queue: (a) => {
    const queued = { ...a, target: { ...GARDEN_PLOT_TILES[a.plot] } };
    set({ queued });
    return queued;
  },
  clear: () => set({ queued: null }),
}));

// ---- A shared wall clock for growth labels (one interval, only while someone listens) ----

let nowMs = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

export function subscribeGardenClock(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) {
    nowMs = Date.now();
    timer = setInterval(() => { nowMs = Date.now(); for (const l of [...listeners]) l(); }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) { clearInterval(timer); timer = null; }
  };
}
export const gardenClockNow = () => nowMs;
