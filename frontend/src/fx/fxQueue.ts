/**
 * Pending visual effects, fired on the frame their time comes (e.g. a blow's
 * impact, which lands impactMs after the event arrives). A fixed pool of
 * preallocated entries: pushing and draining allocate nothing. When full, the
 * soonest-due entry is overwritten (the oldest effect is the least missed).
 */
export const FxKind = { Impact: 1 } as const;

export interface FxEntry {
  due: number;
  kind: number;
  /** Identity hex of the avatar the effect happens on (defender). */
  target: string;
  /** Identity hex of the other party (attacker), or ''. */
  source: string;
  /** 0 = fist, 1 = stick, 2 = club: bigger bursts for heavier weapons. */
  weight: number;
  live: boolean;
}

export class FxQueue {
  readonly entries: FxEntry[];
  size = 0;

  constructor(readonly capacity = 32) {
    this.entries = Array.from({ length: capacity }, () => ({ due: 0, kind: 0, target: '', source: '', weight: 0, live: false }));
  }

  push(due: number, kind: number, target: string, source: string, weight: number): void {
    let slot: FxEntry | null = null;
    let soonest: FxEntry = this.entries[0];
    for (const e of this.entries) {
      if (!e.live) { slot = e; break; }
      if (e.due < soonest.due) soonest = e;
    }
    if (!slot) { slot = soonest; this.size--; }
    slot.due = due; slot.kind = kind; slot.target = target; slot.source = source; slot.weight = weight; slot.live = true;
    this.size++;
  }

  /** Call `fire` for every entry due at `now`, and free it. */
  drain(now: number, fire: (e: FxEntry) => void): void {
    if (this.size === 0) return;
    for (const e of this.entries) {
      if (e.live && e.due <= now) {
        e.live = false;
        this.size--;
        fire(e);
      }
    }
  }
}
