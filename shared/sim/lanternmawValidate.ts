/**
 * The exhaustive Lanternmaw fairness validator (BOSSES.md section 9.8), in the
 * Spire's pattern: backward induction over (tile, tick) for every instance of
 * every den pattern and every tide, from every standable tile. Imported by
 * tests and dev tools only (not exported from index.ts).
 *
 * Ticks are relative to the instance's publication (P = 0). A tile is winning
 * at the horizon when nothing lands on it; one tick back it is winning when it
 * is not hit then and some move (stay, or any end tile within 2 steps) reaches
 * a winning tile. Blows hit end tiles only, so a move test is one array read.
 */
import {
  LANTERN_CELLS, LANTERN_CHOKE_TICKS, LANTERN_DEN_PATTERNS, LANTERN_DIVE_TICKS, LANTERN_EBB_TICKS, LANTERN_FEED_HEAL,
  LANTERN_LEAD, LANTERN_MAX_PARTY, LANTERN_MOVE_AT, LANTERN_MOVE_TO, LANTERN_PATTERNS, LANTERN_PLANK, LANTERN_POOLS,
  LANTERN_SPRINGS, LANTERN_STANDABLE, LANTERN_SWING_TICKS, LANTERN_TIDE_TICKS, LANTERN_TILES, LANTERN_BLOW_DAMAGE,
  LANTERN_PULSE_DAMAGE, LANTERN_DROWN_DAMAGE, LANTERN_IFRAME_TICKS, LANTERN_TIME_LIMIT, LANTERN_ENRAGE_TICKS, LANTERN_SPAWNS,
  lanternBuildPattern, lanternIdx, lanternInCourt, lanternNearSpring, lanternPatternDuration, lanternPulseOffsets, lanternPulseTiles,
} from './lanternmaw';
import { LANTERN_BITE_DAMAGE, LANTERN_HP_BASE, LANTERN_HP_PER_MEMBER, LANTERN_MIN_WEAPON_DAMAGE } from './constants';

export interface LanternValidation {
  /** Every obligation met: notice, every standable tile winning at P, a free tile on every tick. */
  ok: boolean;
  /** First tick (relative to P) on which any standable tile is hit. */
  firstContact: number;
  /** Last tick on which any standable tile is hit. */
  lastDanger: number;
  /** Standable tiles that are not winning at P (must be 0). */
  unsafe: number;
  /** Fewest standable tiles left unhit on any tick from first contact to last danger (must be >= 1). */
  minFree: number;
  /** Smallest share of the 216 tiles still winning on any tick after P. */
  pinch: number;
  /** The same over the 40 court tiles (den) or the tiles in reach of the spring (tide). */
  reachPinch: number;
  /** Fewest winning tiles in swing reach on any tick (den: court; tide: the spring), 0 when a pattern clears the court. */
  reachMin: number;
  /** Share of standable tiles where standing still through the instance gets you hit. */
  still: number;
}

const N = LANTERN_CELLS;
const NT = LANTERN_TILES.length;
const COURT = Uint8Array.from({ length: N }, (_, i) => (lanternInCourt(i) ? 1 : 0));

/**
 * Backward induction over the hazard grid `haz` (ticks 0..H, N cells each).
 * `forced` pins the end tile of one tick (the capper on the spring at the surfacing tick).
 * `reach` marks the tiles that count for reachPinch / reachMin.
 */
export function lanternValidateHazards(haz: Uint8Array, H: number, lead: number, reach: Uint8Array, forced?: { tick: number; tile: number }): LanternValidation {
  let firstContact = Infinity, lastDanger = -1;
  for (let T = 1; T <= H; T++) for (const i of LANTERN_TILES) if (haz[T * N + i]) { if (T < firstContact) firstContact = T; lastDanger = T; break; }
  let minFree = NT;
  for (let T = Math.max(1, firstContact); T <= lastDanger; T++) {
    let free = 0;
    for (const i of LANTERN_TILES) if (!haz[T * N + i]) free++;
    if (free < minFree) minFree = free;
  }
  let nReach = 0;
  for (const i of LANTERN_TILES) nReach += reach[i];
  let win = new Uint8Array(N), prev = new Uint8Array(N);
  for (const i of LANTERN_TILES) win[i] = haz[H * N + i] ? 0 : 1;
  let pinch = 1, reachPinch = 1, reachMin = nReach;
  for (let T = H - 1; T >= 0; T--) {
    prev.fill(0);
    let n = 0, nr = 0;
    for (const i of LANTERN_TILES) {
      if (haz[T * N + i]) continue;
      if (forced && T === forced.tick && i !== forced.tile) continue;
      for (let m = LANTERN_MOVE_AT[i]; m < LANTERN_MOVE_AT[i + 1]; m++) {
        if (!win[LANTERN_MOVE_TO[m]]) continue;
        prev[i] = 1; n++; nr += reach[i];
        break;
      }
    }
    const t = win; win = prev; prev = t;
    if (T >= 1 && T <= lastDanger && !(forced && T === forced.tick)) {
      pinch = Math.min(pinch, n / NT);
      if (nReach) { reachPinch = Math.min(reachPinch, nr / nReach); reachMin = Math.min(reachMin, nr); }
    }
  }
  let unsafe = 0;
  for (const i of LANTERN_TILES) if (!win[i]) unsafe++;
  let still = 0;
  for (const i of LANTERN_TILES) for (let T = 1; T <= H; T++) if (haz[T * N + i]) { still++; break; }
  const ok = firstContact >= lead && unsafe === 0 && minFree >= 1;
  return { ok, firstContact, lastDanger, unsafe, minFree, pinch, reachPinch, reachMin, still: still / NT };
}

/** Hazard grid of one den pattern instance (ticks 0..duration). */
export function lanternDenHazards(kind: number, seed6: number, aim: number): { haz: Uint8Array; H: number } {
  const H = lanternPatternDuration(kind, seed6);
  const haz = new Uint8Array((H + 1) * N);
  for (const b of lanternBuildPattern(kind, seed6, aim)) for (let i = 0; i < N; i++) if (b.tiles[i]) haz[b.at * N + i] = 1;
  return { haz, H };
}

/**
 * Hazard grid of one dive and tide, from the dive's publication (0): the
 * flood on every non-plank tile on ticks S .. S + 14 (S = 6) and the pulses
 * of `phase` (none during the choke when `capped`). The horizon is the first
 * ebb tick.
 */
export function lanternTideHazards(spring: number, pulseSeed: number, phase: number, capped: boolean): { haz: Uint8Array; H: number; S: number } {
  const S = LANTERN_DIVE_TICKS, H = S + LANTERN_TIDE_TICKS;
  const haz = new Uint8Array((H + 1) * N);
  for (let T = S; T < S + LANTERN_TIDE_TICKS; T++) for (let i = 0; i < N; i++) if (LANTERN_STANDABLE[i] && !LANTERN_PLANK[i]) haz[T * N + i] = 1;
  lanternPulseOffsets(phase).forEach((off, j) => {
    if (capped && off < LANTERN_CHOKE_TICKS) return;
    const tiles = lanternPulseTiles(spring, (pulseSeed + j) & 1);
    for (let i = 0; i < N; i++) if (tiles[i]) haz[(S + off) * N + i] = 1;
  });
  return { haz, H, S };
}

export function lanternValidateDen(kind: number, seed6: number, aim: number): LanternValidation {
  const { haz, H } = lanternDenHazards(kind, seed6, aim);
  return lanternValidateHazards(haz, H, LANTERN_LEAD, COURT);
}

const reachMemo: Uint8Array[] = [];
const springReach = (s: number) => (reachMemo[s] ??= Uint8Array.from({ length: N }, (_, i) => (lanternNearSpring(i, s) ? 1 : 0)));

/**
 * One tide instance. Uncapped: every standable tile at the dive's start wins
 * (reaches the boardwalk before the flood, dodges every pulse). Capped: every
 * standable tile reaches the spring by the surfacing tick and then wins.
 */
export function lanternValidateTide(spring: number, pulseSeed: number, phase: number, capped: boolean): LanternValidation {
  const { haz, H, S } = lanternTideHazards(spring, pulseSeed, phase, capped);
  return lanternValidateHazards(haz, H, LANTERN_DIVE_TICKS, springReach(spring), capped ? { tick: S, tile: LANTERN_SPRINGS[spring] } : undefined);
}

/** Every standable aim tile for Mire Marks (216). */
export const LANTERN_AIMS: readonly number[] = LANTERN_TILES;

export interface LanternInstance { group: 'den' | 'tide'; kind: number; seed: number; aim: number; phase: number; capped: boolean }

/** Every instance: den kinds x 64 seeds (x 216 aims for Mire Marks), and 4 springs x 64 pulse seeds x 3 phases x capped or not. */
export function* lanternInstances(aimStride = 1): Generator<LanternInstance> {
  for (const p of LANTERN_PATTERNS) for (let s = 0; s < 64; s++) {
    if (!p.aimed) { yield { group: 'den', kind: p.kind, seed: s, aim: -1, phase: 0, capped: false }; continue; }
    for (let a = 0; a < LANTERN_AIMS.length; a += aimStride) yield { group: 'den', kind: p.kind, seed: s, aim: LANTERN_AIMS[a], phase: 0, capped: false };
  }
  for (let spring = 0; spring < 4; spring++) for (let s = 0; s < 64; s++) for (const phase of [1, 2, 3]) for (const capped of [false, true]) {
    yield { group: 'tide', kind: spring, seed: s, aim: -1, phase, capped };
  }
}

export function lanternValidateInstance(x: LanternInstance): LanternValidation {
  return x.group === 'den' ? lanternValidateDen(x.kind, x.seed, x.aim) : lanternValidateTide(x.kind, x.seed, x.phase, x.capped);
}

// ---- Unwinnable states -------------------------------------------------------------------------------------------

/**
 * The heal bound: for every party size, what it heals per swing interval is
 * less than one stick swing (6) per member, so even an uncapped feed loses HP
 * to a party that keeps swinging, and it can never out-heal the party's
 * damage. Returns the first violation, or null.
 */
export function lanternHealProblem(stickDamage = 6): string | null {
  for (let n = 1; n <= LANTERN_MAX_PARTY; n++) {
    if (LANTERN_FEED_HEAL[n] * LANTERN_SWING_TICKS >= n * stickDamage) return `party ${n}: heals ${LANTERN_FEED_HEAL[n]}/tick, at least one stick swing per member`;
  }
  return null;
}

/**
 * The entry precondition the clock check relies on: every member brings a
 * weapon of at least LANTERN_MIN_WEAPON_DAMAGE (a Stone Club, Crafting 1).
 * Bare fists (3) cannot clear in time and the stick or knife (6) almost never
 * does even played perfectly (5 of 100 runs), so the server refuses them.
 */
export const LANTERN_PRECONDITION_WEAPON = LANTERN_MIN_WEAPON_DAMAGE;

/** Shortest walk (steps) between two standable tiles. */
function stepsBetween(a: number, b: number): number {
  const dist = new Int16Array(N).fill(-1);
  const q = [a];
  dist[a] = 0;
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    if (i === b) return dist[i];
    const u = i % 15, v = (i - u) / 15;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = u + dx, z = v + dz;
      if (x < 0 || z < 0 || x > 14 || z > 14) continue;
      const j = lanternIdx(x, z);
      if (!LANTERN_STANDABLE[j] || dist[j] >= 0) continue;
      if (dx && dz && (!LANTERN_STANDABLE[lanternIdx(x, v)] || !LANTERN_STANDABLE[lanternIdx(u, z)])) continue;
      dist[j] = dist[i] + 1;
      q.push(j);
    }
  }
  return -1;
}

/** The longest walk from any standable tile to any spring, in ticks (2 steps per tick). */
export function lanternWorstCapTicks(): number {
  let worst = 0;
  for (const s of LANTERN_SPRINGS) for (const i of LANTERN_TILES) worst = Math.max(worst, (stepsBetween(i, s) + 1) >> 1);
  return worst;
}

// ---- Republish safety ----------------------------------------------------------------------------------------------

/** Two fixed aims the hash expands Mire Marks at. */
export const LANTERN_HASH_AIMS: readonly number[] = [lanternIdx(2, 12), lanternIdx(12, 2)];

/**
 * FNV-1a over everything a dodge depends on (not LANTERN_RULES_VERSION): the
 * floor, planks, springs, spawns, pattern defs, pools, timings, damages, heal,
 * HP knobs, every blow of every kind for all 64 seeds (Mire Marks at two
 * aims) and every pulse mask. Any change makes the test run the full sweep
 * and ask for a new LANTERN_VALIDATED entry and a rules bump.
 */
export function lanternPatternTableHash(): string {
  let h = 0x811c9dc5;
  const byte = (b: number) => { h = Math.imul(h ^ (b & 255), 0x01000193) >>> 0; };
  const int = (n: number) => { byte(n); byte(n >>> 8); byte(n >>> 16); byte(n >>> 24); };
  const str = (s: string) => { int(s.length); for (let i = 0; i < s.length; i++) int(s.charCodeAt(i)); };
  const mask = (m: Uint8Array) => { for (let i = 0; i < N; i++) if (m[i]) int(i); int(-1); };
  mask(LANTERN_STANDABLE); mask(LANTERN_PLANK);
  for (const s of LANTERN_SPRINGS) int(s);
  for (const s of LANTERN_SPAWNS) int(s);
  for (const p of LANTERN_PATTERNS) { int(p.kind); str(p.key); int(p.aimed ? 1 : 0); }
  for (const ph of [1, 2, 3] as const) { int(ph); for (const k of LANTERN_POOLS[ph]) int(k); for (const o of lanternPulseOffsets(ph)) int(o); }
  for (const c of [LANTERN_LEAD, LANTERN_DEN_PATTERNS, LANTERN_DIVE_TICKS, LANTERN_TIDE_TICKS, LANTERN_EBB_TICKS, LANTERN_CHOKE_TICKS,
    LANTERN_PULSE_DAMAGE, LANTERN_DROWN_DAMAGE, LANTERN_BITE_DAMAGE, LANTERN_IFRAME_TICKS, LANTERN_SWING_TICKS,
    LANTERN_HP_BASE, LANTERN_HP_PER_MEMBER, LANTERN_TIME_LIMIT, LANTERN_ENRAGE_TICKS, LANTERN_MIN_WEAPON_DAMAGE]) int(c);
  for (const d of LANTERN_BLOW_DAMAGE) int(d);
  for (const d of LANTERN_FEED_HEAL) int(d);
  for (const p of LANTERN_PATTERNS) for (let s = 0; s < 64; s++) for (const aim of p.aimed ? LANTERN_HASH_AIMS : [-1]) {
    for (const b of lanternBuildPattern(p.kind, s, aim)) { int(b.at); mask(b.tiles); }
  }
  for (let s = 0; s < 4; s++) for (let t = 0; t < 2; t++) mask(lanternPulseTiles(s, t));
  return h.toString(16).padStart(8, '0');
}
