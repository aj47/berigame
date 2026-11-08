import {
  GRID_SIZE, LANTERN_CELLS, LANTERN_FLOOR, LANTERN_NONE, LANTERN_PATTERNS, LANTERN_STAGE_NAMES, LanternStage, TICK_MS,
  lanternChoked, lanternFlooded, lanternHazardMask, lanternIdx, lanternInReach, lanternLocal, lanternU, lanternV,
  type LanternFightLike, type Tile,
} from '@sim';

/**
 * Pure presentation of a lantern_fight row for the HUD and the scene: every
 * tile set comes straight from the shared sim (lanternHazardMask and friends),
 * so the browser draws exactly the tiles the server resolves.
 */

/** A local floor index as a world tile key (z * GRID_SIZE + x), the DangerTiles key. */
export function lanternKey(i: number): number {
  return (LANTERN_FLOOR.z0 + lanternV(i)) * GRID_SIZE + LANTERN_FLOOR.x0 + lanternU(i);
}

/** The tile keys of a local mask. */
export function lanternMaskKeys(mask: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < LANTERN_CELLS; i++) if (mask[i]) out.push(lanternKey(i));
  return out;
}

export interface LanternDanger {
  /** Tiles that hurt at T + 1 (lanternHazardMask at T + 1: blows, pulses and the flood). */
  red: number[];
  /** Tiles that hurt at T + 2 and not at T + 1. */
  amber: number[];
}

const NO_DANGER: LanternDanger = { red: [], amber: [] };

/** Red for the next tick's hazards, amber for the tick after, from what the row publishes at world tick `tick`. */
export function lanternDanger(f: LanternFightLike | null | undefined, tick: number, startTick: number): LanternDanger {
  if (!f || startTick <= 0) return NO_DANGER;
  const next = lanternHazardMask(f, tick + 1, startTick), after = lanternHazardMask(f, tick + 2, startTick);
  const red: number[] = [], amber: number[] = [];
  for (let i = 0; i < LANTERN_CELLS; i++) {
    if (next[i]) red.push(lanternKey(i));
    else if (after[i]) amber.push(lanternKey(i));
  }
  return { red, amber };
}

/** Any shallows tile (u = 0, v = 0 is never a plank): flooded exactly while the tide is in. */
const SHALLOWS = lanternIdx(0, 0);

/** "Den", "Dive", "Tide", "Ebb". */
export function lanternStageName(stage: number): string {
  const n = LANTERN_STAGE_NAMES[stage] ?? '';
  return n.charAt(0).toUpperCase() + n.slice(1);
}

export interface LanternStatus {
  stage: string;
  /** The den pattern's name while one is published, else ''. */
  pattern: string;
  /** The tide is in at `tick` (non-plank tiles drown). */
  flooded: boolean;
  /** Capped and choking: double damage, no heal, no pulses. */
  choked: boolean;
  /** The published spring (0 NW, 1 NE, 2 SE, 3 SW) from the dive to the end of the tide, else -1. */
  spring: number;
  /** Seconds until it surfaces at the spring (during the dive), else null. */
  surfacesIn: number | null;
}

/** What the HUD and the scene say about the fight at world tick `tick`. */
export function lanternStatus(f: LanternFightLike | null | undefined, tick: number): LanternStatus {
  if (!f) return { stage: '', pattern: '', flooded: false, choked: false, spring: -1, surfacesIn: null };
  const den = f.stage === LanternStage.Den;
  const out = f.stage === LanternStage.Dive || f.stage === LanternStage.Tide;
  return {
    stage: lanternStageName(f.stage),
    pattern: den && f.curKind !== LANTERN_NONE ? LANTERN_PATTERNS[f.curKind]?.name ?? '' : '',
    flooded: lanternFlooded(f, tick, SHALLOWS),
    choked: lanternChoked(f, tick),
    spring: out ? f.spring & 3 : -1,
    surfacesIn: f.stage === LanternStage.Dive && f.surfaceTick > tick ? ((f.surfaceTick - tick) * TICK_MS) / 1000 : null,
  };
}

/** Whether you stand where your swings land at `tick` (ring 2 in the den, near the spring at the tide). */
export function lanternMeInReach(f: LanternFightLike | null | undefined, tick: number, me: Tile | null | undefined): boolean {
  if (!f || !me) return false;
  const i = lanternLocal(me);
  return i >= 0 && lanternInReach(f, tick, i);
}
