/**
 * Lanternmaw, the bog-angler of the Drowned Hollow under Glimmerfen
 * (docs/design/BOSSES.md section 9): the floor, the den patterns, the tide,
 * the springs, the fight state machine and the reference tick order the
 * server mirrors.
 *
 * Pure and integer-only (no trigonometry, roots or powers): the server, the
 * browser and agents resolve exactly the same tiles. Tiles are local indices
 * i = v * 15 + u on the 15 x 15 floor, u = x - LANTERN_FLOOR.x0 and
 * v = z - LANTERN_FLOOR.z0. Blows land on end-of-movement tiles (the
 * Clatterhorn rule), never on bullets' swept paths.
 */
import { LANTERN_FLOOR } from './bossZones';
import { mix32, movesWithin } from './bullets';
import {
  LANTERN_BAIT, LANTERN_BITE_DAMAGE, LANTERN_DAILY_PAID_CLEARS, LANTERN_ENTRY_FEE, LANTERN_HP_BASE, LANTERN_HP_PER_MEMBER,
  LANTERN_MIN_WEAPON_DAMAGE, LANTERN_REWARD,
} from './constants';
import { countItem } from './inventory';
import { getItemDef } from './items';
import type { Slot } from './types';
import type { Tile } from './types';

/** Stamped on every run; any change to the pattern table needs the validator and a bump (lanternmaw-patterns.test.ts). */
export const LANTERN_RULES_VERSION = 2;
export const LANTERN_BOSS_NAME = 'Lanternmaw';

// ---- Geometry ------------------------------------------------------------------------------------------------------

export const LANTERN_SIZE = 15;
export const LANTERN_CELLS = LANTERN_SIZE * LANTERN_SIZE;
const MID = 7;
export const lanternIdx = (u: number, v: number): number => v * LANTERN_SIZE + u;
export const lanternU = (i: number): number => i % LANTERN_SIZE;
export const lanternV = (i: number): number => (i - (i % LANTERN_SIZE)) / LANTERN_SIZE;
export function lanternCheb(a: number, b: number): number {
  return Math.max(Math.abs(lanternU(a) - lanternU(b)), Math.abs(lanternV(a) - lanternV(b)));
}
/** The maw's centre (blocked, like the Spire's dais). */
export const LANTERN_CENTRE = lanternIdx(MID, MID);
/** Chebyshev ring of a tile around the maw. */
export const lanternRing = (i: number): number => lanternCheb(i, LANTERN_CENTRE);

function maskOf(pred: (i: number) => boolean): Uint8Array {
  const m = new Uint8Array(LANTERN_CELLS);
  for (let i = 0; i < LANTERN_CELLS; i++) m[i] = pred(i) ? 1 : 0;
  return m;
}

/** Every tile but the 3 x 3 maw: 216 tiles. */
export const LANTERN_STANDABLE = maskOf((i) => lanternRing(i) >= 2);
/**
 * The boardwalk: the ring 4 tiles out (32) and the four spokes along the axes
 * (20 more): 52 planks. Planks stay dry at high tide; everything else floods.
 */
export const LANTERN_PLANK = maskOf((i) => {
  const d = lanternRing(i);
  return d === 4 || (d >= 2 && (lanternU(i) === MID || lanternV(i) === MID));
});
/** The four glow springs at the boardwalk's corners: 0 NW, 1 NE, 2 SE, 3 SW. */
export const LANTERN_SPRINGS: readonly number[] = [lanternIdx(3, 3), lanternIdx(11, 3), lanternIdx(11, 11), lanternIdx(3, 11)];
/** Standable tiles in row order. */
export const LANTERN_TILES: readonly number[] = Array.from({ length: LANTERN_CELLS }, (_, i) => i).filter((i) => LANTERN_STANDABLE[i] === 1);
/**
 * Swing reach: Chebyshev 2 of the maw's centre while the boss is in its den (ring 2, 16 tiles: the
 * Maw Bellow's hardest escape), and 2 of the spring while it is out.
 */
export const LANTERN_COURT_RANGE = 2;
export const LANTERN_SPRING_RANGE = 2;
/** Where members appear at the start, by slot (the south boardwalk). */
export const LANTERN_SPAWNS: readonly number[] = [lanternIdx(5, 13), lanternIdx(7, 13), lanternIdx(9, 13), lanternIdx(7, 12)];

export function lanternInCourt(i: number): boolean {
  return i >= 0 && i < LANTERN_CELLS && LANTERN_STANDABLE[i] === 1 && lanternRing(i) <= LANTERN_COURT_RANGE;
}

export function lanternNearSpring(i: number, spring: number): boolean {
  return i >= 0 && i < LANTERN_CELLS && LANTERN_STANDABLE[i] === 1 && lanternCheb(i, LANTERN_SPRINGS[spring & 3]) <= LANTERN_SPRING_RANGE;
}

/** Absolute tile of a local index. */
export function lanternTile(i: number): Tile {
  return { x: LANTERN_FLOOR.x0 + lanternU(i), z: LANTERN_FLOOR.z0 + lanternV(i) };
}

/** Local index of an absolute tile, -1 off the floor or for fractional coordinates. */
export function lanternLocal(t: Tile): number {
  const u = t.x - LANTERN_FLOOR.x0, v = t.z - LANTERN_FLOOR.z0;
  if (!Number.isInteger(u) || !Number.isInteger(v) || u < 0 || v < 0 || u >= LANTERN_SIZE || v >= LANTERN_SIZE) return -1;
  return lanternIdx(u, v);
}

const standableLocal = (t: Tile) => t.x >= 0 && t.z >= 0 && t.x < LANTERN_SIZE && t.z < LANTERN_SIZE && LANTERN_STANDABLE[lanternIdx(t.x, t.z)] === 1;
const MOVE_AT = new Int32Array(LANTERN_CELLS + 1);
const MOVE_TO: number[] = [];
for (let i = 0; i < LANTERN_CELLS; i++) {
  MOVE_AT[i] = MOVE_TO.length;
  if (!LANTERN_STANDABLE[i]) continue;
  for (const m of movesWithin({ x: lanternU(i), z: lanternV(i) }, standableLocal)) MOVE_TO.push(lanternIdx(m.end.x, m.end.z));
}
MOVE_AT[LANTERN_CELLS] = MOVE_TO.length;
/** Flat move table: tile i's end tiles (stay first, then 1 and 2 steps in BFS order) are MOVE_TO[AT[i]..AT[i+1]). */
export const LANTERN_MOVE_AT: Int32Array = MOVE_AT;
export const LANTERN_MOVE_TO: Int32Array = Int32Array.from(MOVE_TO);

/** End tiles reachable in one tick (up to 2 steps): stay first. */
export function lanternMoves(i: number): number[] {
  return Array.from(LANTERN_MOVE_TO.subarray(LANTERN_MOVE_AT[i], LANTERN_MOVE_AT[i + 1]));
}

// ---- Den patterns --------------------------------------------------------------------------------------------------

export const LanternKind = { Sweep: 0, Geysers: 1, Lash: 2, Ripple: 3, Marks: 4, Cross: 5, Storm: 6, Bellow: 7 } as const;
export type LanternKind = (typeof LanternKind)[keyof typeof LanternKind];
export const LANTERN_NONE = 255;

export interface LanternPatternDef { kind: number; key: string; name: string; aimed: boolean }
export const LANTERN_PATTERNS: readonly LanternPatternDef[] = [
  { kind: 0, key: 'lure_sweep', name: 'Lure Sweep', aimed: false },
  { kind: 1, key: 'mud_geysers', name: 'Mud Geysers', aimed: false },
  { kind: 2, key: 'tail_lash', name: 'Tail Lash', aimed: false },
  { kind: 3, key: 'ripple', name: 'Ripple', aimed: false },
  { kind: 4, key: 'mire_marks', name: 'Mire Marks', aimed: true },
  { kind: 5, key: 'drowning_cross', name: 'Drowning Cross', aimed: false },
  { kind: 6, key: 'lantern_storm', name: 'Lantern Storm', aimed: false },
  { kind: 7, key: 'maw_bellow', name: 'Maw Bellow', aimed: false },
];
export const LANTERN_POOLS: Readonly<Record<1 | 2 | 3, readonly number[]>> = { 1: [0, 2, 7], 2: [1, 2, 3, 4, 7], 3: [3, 4, 5, 6, 7] };
/** No blow lands before P + 3: every telegraph gives at least 3 ticks (6 tiles of movement). */
export const LANTERN_LEAD = 3;

/** One blow: the standable tiles it hits, `at` ticks after the pattern is published. */
export interface LanternBlow { at: number; tiles: Uint8Array }

const du = (i: number) => lanternU(i) - MID;
const dv = (i: number) => lanternV(i) - MID;
function blow(at: number, pred: (i: number) => boolean): LanternBlow {
  return { at, tiles: maskOf((i) => LANTERN_STANDABLE[i] === 1 && pred(i)) };
}
/** Quarter q (0 E, 1 S, 2 W, 3 N, clockwise on screen); diagonal tiles belong to both neighbours. */
function inQuarter(q: number, i: number): boolean {
  const x = du(i), z = dv(i);
  switch (q & 3) {
    case 0: return x > 0 && Math.abs(z) <= x;
    case 1: return z > 0 && Math.abs(x) <= z;
    case 2: return x < 0 && Math.abs(z) <= -x;
    default: return z < 0 && Math.abs(x) <= -z;
  }
}
const clampUV = (n: number) => Math.max(0, Math.min(LANTERN_SIZE - 1, n));
const around = (c: number) => (i: number) => lanternCheb(i, c) <= 1;
const DIR8: readonly (readonly [number, number])[] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const GEYSER_SALT = 0x6e75, STORM_SALT = 0x5707;

function buildBlows(kind: number, seed6: number, aim: number): LanternBlow[] {
  const s = seed6 & 63;
  switch (kind) {
    case LanternKind.Sweep: {
      // The lure sweeps the four quarters on consecutive ticks, clockwise or not.
      const q0 = s & 3, step = (s >> 2) & 1 ? 1 : 3;
      return [0, 1, 2, 3].map((j) => blow(3 + j, (i) => inQuarter(q0 + j * step, i)));
    }
    case LanternKind.Geysers:
      // Six 3 x 3 geysers, one per tick.
      return [0, 1, 2, 3, 4, 5].map((j) => blow(3 + j, around(LANTERN_TILES[mix32(GEYSER_SALT + s, j) % LANTERN_TILES.length])));
    case LanternKind.Lash: {
      // The court (rings 2-3) and the boardwalk band (rings 4-5), alternating.
      const inner = (i: number) => lanternRing(i) <= 3, outer = (i: number) => lanternRing(i) >= 4 && lanternRing(i) <= 5;
      const seq = s & 1 ? [outer, inner, outer] : [inner, outer, inner];
      return seq.map((p, j) => blow(3 + 3 * j, p));
    }
    case LanternKind.Ripple: {
      // A ring expanding 1 tile per tick from the maw or from a spring; jump through it. Odd seeds send a second one 3 ticks behind.
      const origin = (s >> 1) % 5;
      const centre = origin === 0 ? LANTERN_CENTRE : LANTERN_SPRINGS[origin - 1];
      const first = origin === 0 ? 2 : 0, last = origin === 0 ? MID : 11;
      const out: LanternBlow[] = [];
      for (let d = first; d <= last; d++) out.push(blow(3 + d - first, (i) => lanternCheb(i, centre) === d));
      if (s & 1) for (let d = first; d <= last; d++) out.push(blow(6 + d - first, (i) => lanternCheb(i, centre) === d));
      return out.sort((a, b) => a.at - b.at);
    }
    case LanternKind.Marks: {
      // Three 3 x 3 stomps: on the aimed tile, then two seeded 2-tile hops.
      const a = aim >= 0 && aim < LANTERN_CELLS ? aim : LANTERN_SPAWNS[0];
      const [ax, az] = DIR8[s & 7], [bx, bz] = DIR8[(s >> 3) & 7];
      const c1 = lanternIdx(clampUV(lanternU(a) + 2 * ax), clampUV(lanternV(a) + 2 * az));
      const c2 = lanternIdx(clampUV(lanternU(c1) + 2 * bx), clampUV(lanternV(c1) + 2 * bz));
      return [blow(3, around(a)), blow(4, around(c1)), blow(5, around(c2))];
    }
    case LanternKind.Cross: {
      // 3-wide bands along the axes and along the diagonals, alternating.
      const axes = (i: number) => Math.abs(du(i)) <= 1 || Math.abs(dv(i)) <= 1;
      const diag = (i: number) => Math.abs(Math.abs(du(i)) - Math.abs(dv(i))) <= 1;
      const seq = s & 1 ? [diag, axes, diag] : [axes, diag, axes];
      return seq.map((p, j) => blow(3 + 2 * j, p));
    }
    case LanternKind.Bellow: {
      // Everything but the outer edge (rings 2-6), then the edge and the boardwalk band (rings 5-7): run out to
      // ring 7 and straight back in. From ring 2 the first escape needs all 3 ticks of notice.
      const late = 6 + (s & 1);
      return [blow(3, (i) => lanternRing(i) <= 6), blow(late, (i) => lanternRing(i) >= 5)];
    }
    case LanternKind.Storm:
      // Ten geysers, two per tick.
      return Array.from({ length: 10 }, (_, j) => blow(3 + (j >> 1), around(LANTERN_TILES[mix32(STORM_SALT + s, j) % LANTERN_TILES.length])));
    default:
      return [];
  }
}

const patternMemo = new Map<number, LanternBlow[]>();
/** The blows of one pattern instance (memoized: callers must not mutate them). `aim` matters only for Mire Marks. */
export function lanternBuildPattern(kind: number, seed6: number, aim: number): LanternBlow[] {
  const key = (kind * 64 + (seed6 & 63)) * 256 + (LANTERN_PATTERNS[kind]?.aimed ? aim & 255 : 255);
  let b = patternMemo.get(key);
  if (!b) { b = buildBlows(kind, seed6, aim); patternMemo.set(key, b); }
  return b;
}

/** Ticks from publication to the last blow; the next pattern is published on that tick. */
export function lanternPatternDuration(kind: number, seed6: number): number {
  const b = lanternBuildPattern(kind, seed6, LANTERN_SPAWNS[0]);
  return b.length ? b[b.length - 1].at : 0;
}

// ---- The tide and the springs --------------------------------------------------------------------------------------

/** Den patterns per cycle, then a dive. */
export const LANTERN_DEN_PATTERNS = 3;
/** Spring and flood telegraph: the boss surfaces this many ticks after the dive starts. */
export const LANTERN_DIVE_TICKS = 8;
/** High tide: ticks S .. S + 14 from the surfacing tick S. */
export const LANTERN_TIDE_TICKS = 15;
/** The boss swims back to its den: not attackable. */
export const LANTERN_EBB_TICKS = 3;
/** A capped spring chokes it for ticks S .. S + 8: double damage, no heal, no pulses. */
export const LANTERN_CHOKE_TICKS = 9;
/** Lure pulses, as offsets from S: alternating A (the spring and its neighbours) and B (the ring 2 out). */
const PULSES_CALM: readonly number[] = [3, 6, 9, 12];
const PULSES_WILD: readonly number[] = [3, 4, 7, 8, 11, 12];
export function lanternPulseOffsets(phase: number): readonly number[] {
  return phase >= 3 ? PULSES_WILD : PULSES_CALM;
}
const pulseMemo: Uint8Array[] = [];
/** Pulse type 0 (A): standable tiles within 1 of the spring; type 1 (B): standable tiles exactly 2 away. */
export function lanternPulseTiles(spring: number, type: number): Uint8Array {
  const k = (spring & 3) * 2 + (type & 1);
  if (!pulseMemo[k]) {
    const c = LANTERN_SPRINGS[spring & 3];
    pulseMemo[k] = maskOf((i) => LANTERN_STANDABLE[i] === 1 && (type & 1 ? lanternCheb(i, c) === 2 : lanternCheb(i, c) <= 1));
  }
  return pulseMemo[k];
}

// ---- Numbers -------------------------------------------------------------------------------------------------------

export const LANTERN_MAX_PARTY = 4;
export const LANTERN_INTRO_TICKS = 5;
/** 6:00 after the intro. */
export const LANTERN_TIME_LIMIT = 600;
/** From 4:12 the den draws from the phase 3 pool and every blow and pulse deals 1 more. */
export const LANTERN_ENRAGE_TICKS = 420;
export const LANTERN_ENRAGE_BONUS = 1;
/** Den blow damage by phase (index 1..3). */
export const LANTERN_BLOW_DAMAGE = [0, 10, 13, 15] as const;
export const LANTERN_PULSE_DAMAGE = 7;
/** Per tick on a flooded tile; no i-frames either way. */
export const LANTERN_DROWN_DAMAGE = 4;
export const LANTERN_IFRAME_TICKS = 2;
/** Heal per tide tick while it feeds, by party size (index 1..4): always below one stick swing per member per 4 ticks. */
export const LANTERN_FEED_HEAL = [0, 1, 2, 3, 4] as const;
/** Swing cadence: slot s swings on ticks with (T - startTick) mod 4 == s. */
export const LANTERN_SWING_TICKS = 4;
export const LANTERN_MEALS = 6;
export const LANTERN_KO_HP = 10;
/** Damage dealt in the run needed for the clear reward. */
export const LANTERN_MIN_DAMAGE = 40;
export function lanternMaxHp(members: number, base = LANTERN_HP_BASE, perMember = LANTERN_HP_PER_MEMBER): number {
  return base + perMember * (Math.max(1, Math.min(LANTERN_MAX_PARTY, members)) - 1);
}

/** HP thirds, or phase 3 once enraged; the fight never lets the phase go back. */
export function lanternPhaseFor(hp: number, maxHp: number, elapsed: number): 1 | 2 | 3 {
  if (elapsed >= LANTERN_ENRAGE_TICKS || 3 * hp <= maxHp) return 3;
  if (3 * hp <= 2 * maxHp) return 2;
  return 1;
}

export function lanternEnraged(startTick: number, T: number): boolean {
  return T - startTick >= LANTERN_ENRAGE_TICKS;
}

export function lanternQualifies(dealt: number, online: boolean): boolean {
  return online && dealt >= LANTERN_MIN_DAMAGE;
}

/** The UTC day of a timestamp in milliseconds (the daily cap's key). */
export function lanternUtcDay(ms: number): number {
  return Math.floor(ms / 86_400_000);
}

/**
 * What a member gets at a clear. Qualifying members get Fighting XP; fenlight
 * only while `paidClearsToday` (this character's paid clears this UTC day,
 * before this one) is under LANTERN_DAILY_PAID_CLEARS.
 */
export function lanternClearReward(dealt: number, online: boolean, paidClearsToday: number): { items: readonly { itemId: string; quantity: number }[]; fightingXp: number; paid: boolean } {
  if (!lanternQualifies(dealt, online)) return { items: [], fightingXp: 0, paid: false };
  const paid = paidClearsToday < LANTERN_DAILY_PAID_CLEARS;
  return { items: paid ? LANTERN_REWARD.items : [], fightingXp: LANTERN_REWARD.fightingXp, paid };
}

/**
 * Why a member cannot start a run, or null: a weapon of at least
 * LANTERN_MIN_WEAPON_DAMAGE wielded or in the bag (fists cannot win in time),
 * one Fen Bait, and the coin fee.
 */
export function lanternEntryRejection(slots: readonly Slot[], coins: number, wielded: string): string | null {
  const damage = (id: string) => (id ? getItemDef(id)?.weaponDamage ?? 0 : 0);
  if (damage(wielded) < LANTERN_MIN_WEAPON_DAMAGE && !slots.some((s) => s && damage(s.itemId) >= LANTERN_MIN_WEAPON_DAMAGE)) {
    return 'Bring a weapon to the Drowned Hollow: a stone club or better';
  }
  if (countItem(slots, LANTERN_BAIT.itemId) < 1) return `You need a ${LANTERN_BAIT.name}`;
  if (coins < LANTERN_ENTRY_FEE) return `You need ${LANTERN_ENTRY_FEE} coins`;
  return null;
}

// ---- The fight ---------------------------------------------------------------------------------------------------

export const LanternStage = { Den: 0, Dive: 1, Tide: 2, Ebb: 3 } as const;
export type LanternStage = (typeof LanternStage)[keyof typeof LanternStage];
export const LANTERN_STAGE_NAMES: readonly string[] = ['den', 'dive', 'tide', 'ebb'];

/** The fight row: everything else (blows, flood, pulses) is a function of these fields. */
export interface LanternFightLike {
  seed: number; hp: number; maxHp: number; phase: number; partySize: number;
  stage: number; cycle: number; denCount: number; patternCount: number;
  curKind: number; curStart: number; curSeed: number; curAim: number;
  /** Tick S the boss surfaces at `spring` (valid from the dive on). */
  surfaceTick: number; spring: number; pulseSeed: number; capped: boolean;
}

function publish<F extends LanternFightLike>(f: F, startTick: number, T: number, targets: readonly number[]): F {
  const k = f.patternCount + 1;
  const phase = Math.max(f.phase, lanternPhaseFor(f.hp, f.maxHp, T - startTick)) as 1 | 2 | 3;
  const pool = LANTERN_POOLS[phase];
  let j = mix32(f.seed, 2 * k) % pool.length;
  if (pool[j] === f.curKind) j = (j + 1) % pool.length;
  const aim = targets.length ? targets[k % targets.length] : LANTERN_SPAWNS[0];
  return {
    ...f, phase, patternCount: k, denCount: f.denCount + 1,
    curKind: pool[j], curStart: T, curSeed: mix32(f.seed, 2 * k + 1) & 63, curAim: aim,
  };
}

/** A fight that starts at `startTick` with its first den pattern published on that tick. */
export function lanternFreshFight(seed: number, partySize: number, startTick: number, targets: readonly number[], hp = lanternMaxHp(partySize)): LanternFightLike {
  const f: LanternFightLike = {
    seed: seed >>> 0, hp, maxHp: hp, phase: 1, partySize: Math.max(1, Math.min(LANTERN_MAX_PARTY, partySize)),
    stage: LanternStage.Den, cycle: 0, denCount: 0, patternCount: 0,
    curKind: LANTERN_NONE, curStart: startTick, curSeed: 0, curAim: 0,
    surfaceTick: 0, spring: 0, pulseSeed: 0, capped: false,
  };
  return publish(f, startTick, startTick, targets);
}

/**
 * End of tick T: publish the next den pattern, start a dive after the third, and
 * walk the dive, tide and ebb. `targets` are present members' end tiles by slot
 * (Mire Marks aims at targets[k mod n]). Pure: returns the same object when nothing changes.
 */
export function lanternAdvance<F extends LanternFightLike>(f: F, T: number, startTick: number, targets: readonly number[]): F {
  switch (f.stage) {
    case LanternStage.Den: {
      if (f.curKind !== LANTERN_NONE && T < f.curStart + lanternPatternDuration(f.curKind, f.curSeed)) return f;
      if (f.denCount < LANTERN_DEN_PATTERNS) return publish(f, startTick, T, targets);
      const phase = Math.max(f.phase, lanternPhaseFor(f.hp, f.maxHp, T - startTick));
      return {
        ...f, phase, stage: LanternStage.Dive, curKind: LANTERN_NONE, surfaceTick: T + LANTERN_DIVE_TICKS,
        spring: mix32(f.seed, 0x5000 + f.cycle) & 3, pulseSeed: mix32(f.seed, 0x6000 + f.cycle) & 63, capped: false,
      };
    }
    case LanternStage.Dive:
      return T >= f.surfaceTick - 1 ? { ...f, stage: LanternStage.Tide } : f;
    case LanternStage.Tide:
      return T >= f.surfaceTick + LANTERN_TIDE_TICKS - 1 ? { ...f, stage: LanternStage.Ebb } : f;
    case LanternStage.Ebb:
      if (T < f.surfaceTick + LANTERN_TIDE_TICKS + LANTERN_EBB_TICKS - 1) return f;
      return publish({ ...f, stage: LanternStage.Den, cycle: f.cycle + 1, denCount: 0, curKind: LANTERN_NONE }, startTick, T, targets);
    default:
      return f;
  }
}

const inTide = (f: LanternFightLike, T: number) =>
  (f.stage === LanternStage.Dive || f.stage === LanternStage.Tide) && T >= f.surfaceTick && T < f.surfaceTick + LANTERN_TIDE_TICKS;

/** Swings land in the den and at the spring during the tide; never in the dive or the ebb. */
export function lanternAttackable(f: LanternFightLike, T: number): boolean {
  return f.stage === LanternStage.Den || (f.stage === LanternStage.Tide && inTide(f, T));
}

/** A member at `i` can swing at T: within 3 of the maw in the den, within 2 of the spring at the tide. */
export function lanternInReach(f: LanternFightLike, T: number, i: number): boolean {
  if (!lanternAttackable(f, T)) return false;
  return f.stage === LanternStage.Den ? lanternInCourt(i) : lanternNearSpring(i, f.spring);
}

export function lanternChoked(f: LanternFightLike, T: number): boolean {
  return f.capped && inTide(f, T) && T < f.surfaceTick + LANTERN_CHOKE_TICKS;
}

export function lanternSwingDue(startTick: number, T: number, slot: number): boolean {
  return T >= startTick && (T - startTick) % LANTERN_SWING_TICKS === slot;
}

/** Base weapon damage, doubled while it chokes. */
export function lanternSwingDamage(f: LanternFightLike, T: number, base: number): number {
  return lanternChoked(f, T) ? 2 * base : base;
}

/** HP it regains at T: FEED_HEAL[party] on every tide tick of an uncapped spring. */
export function lanternHealAt(f: LanternFightLike, T: number): number {
  return !f.capped && inTide(f, T) ? LANTERN_FEED_HEAL[Math.max(1, Math.min(LANTERN_MAX_PARTY, f.partySize))] : 0;
}

/** The den blow landing at T, if any. */
export function lanternBlowAt(f: LanternFightLike, T: number, startTick: number): { tiles: Uint8Array; damage: number } | null {
  if (f.stage !== LanternStage.Den || f.curKind === LANTERN_NONE) return null;
  const at = T - f.curStart;
  if (at < LANTERN_LEAD) return null;
  let tiles: Uint8Array | null = null;
  for (const b of lanternBuildPattern(f.curKind, f.curSeed, f.curAim)) {
    if (b.at !== at) continue;
    if (!tiles) tiles = b.tiles;
    else { const m = new Uint8Array(LANTERN_CELLS); for (let i = 0; i < LANTERN_CELLS; i++) m[i] = tiles[i] | b.tiles[i]; tiles = m; }
  }
  if (!tiles) return null;
  const phase = Math.min(3, Math.max(1, f.phase)) as 1 | 2 | 3;
  return { tiles, damage: LANTERN_BLOW_DAMAGE[phase] + (lanternEnraged(startTick, T) ? LANTERN_ENRAGE_BONUS : 0) };
}

/** The lure pulse landing at T, if any (none while it chokes). */
export function lanternPulseAt(f: LanternFightLike, T: number, startTick: number): { tiles: Uint8Array; damage: number } | null {
  if (!inTide(f, T) || lanternChoked(f, T)) return null;
  const offs = lanternPulseOffsets(f.phase);
  const j = offs.indexOf(T - f.surfaceTick);
  if (j < 0) return null;
  return { tiles: lanternPulseTiles(f.spring, (f.pulseSeed + j) & 1), damage: LANTERN_PULSE_DAMAGE + (lanternEnraged(startTick, T) ? LANTERN_ENRAGE_BONUS : 0) };
}

export function lanternFlooded(f: LanternFightLike, T: number, i: number): boolean {
  return inTide(f, T) && LANTERN_STANDABLE[i] === 1 && LANTERN_PLANK[i] === 0;
}

/**
 * Every tile a member could be hurt on at T, from what is published in `f`
 * (blows, pulses and the flood; the bite is a choice, not a hazard). An
 * uncapped spring is assumed until the surfacing tick resolves it.
 */
export function lanternHazardMask(f: LanternFightLike, T: number, startTick: number): Uint8Array {
  const m = new Uint8Array(LANTERN_CELLS);
  const b = lanternBlowAt(f, T, startTick);
  if (b) for (let i = 0; i < LANTERN_CELLS; i++) m[i] |= b.tiles[i];
  if (inTide(f, T)) {
    const p = lanternPulseAt(f, T, startTick);
    if (p) for (let i = 0; i < LANTERN_CELLS; i++) m[i] |= p.tiles[i];
    for (let i = 0; i < LANTERN_CELLS; i++) if (LANTERN_STANDABLE[i] && !LANTERN_PLANK[i]) m[i] = 1;
  }
  return m;
}

// ---- The reference tick ------------------------------------------------------------------------------------------

export interface LanternMemberSim {
  slot: number; tile: number; hp: number; maxHp: number; weapon: number; present: boolean;
  nextSwingTick: number; hitTick: number; dealt: number; hits: number; drowned: number; caps: number; meals: number;
}
export type LanternOutcome = '' | 'cleared' | 'wiped' | 'timeout';
export interface LanternRunSim {
  startTick: number; endTick: number; fight: LanternFightLike; members: LanternMemberSim[]; outcome: LanternOutcome; clearTick: number;
}

/** A run whose fight starts at `startTick` (after the intro), members at full HP. */
export function lanternNewRun(seed: number, members: readonly { tile: number; weapon: number; hp?: number }[], startTick: number): LanternRunSim {
  const ms: LanternMemberSim[] = members.map((m, slot) => ({
    slot, tile: m.tile, hp: m.hp ?? 30, maxHp: 30, weapon: m.weapon, present: true,
    nextSwingTick: 0, hitTick: 0, dealt: 0, hits: 0, drowned: 0, caps: 0, meals: 0,
  }));
  return {
    startTick, endTick: startTick + LANTERN_TIME_LIMIT, outcome: '', clearTick: 0, members: ms,
    fight: lanternFreshFight(seed, ms.length, startTick, ms.map((m) => m.tile)),
  };
}

/**
 * One tick of an Active run, with every member's end tile for T already set
 * (the server runs movement first). Order: 1 surfacing (cap and bite),
 * 2 swings (a kill clears before any hazard), 3 blows and pulses (2-tick
 * i-frames) and the flood, knockouts at 0 HP, 4 heal, 5 wipe and timeout,
 * 6 advance. Pure.
 */
export function lanternResolveTick(run: LanternRunSim, T: number): LanternRunSim {
  if (run.outcome) return run;
  let f = run.fight;
  const ms = run.members.map((m) => ({ ...m }));
  const present = ms.filter((m) => m.present);
  // 1. Surfacing: anyone on the spring caps it and is bitten.
  if (f.stage === LanternStage.Tide && T === f.surfaceTick) {
    const cappers = present.filter((m) => m.tile === LANTERN_SPRINGS[f.spring]);
    if (cappers.length) {
      f = { ...f, capped: true };
      for (const m of cappers) { m.hp -= LANTERN_BITE_DAMAGE; m.caps++; }
    }
  }
  // 2. Swings.
  for (const m of present) {
    if (m.hp <= 0 || !lanternSwingDue(run.startTick, T, m.slot) || T < m.nextSwingTick || !lanternInReach(f, T, m.tile)) continue;
    const d = Math.min(f.hp, lanternSwingDamage(f, T, m.weapon));
    f = { ...f, hp: f.hp - d };
    m.dealt += d;
    if (f.hp <= 0) return { ...run, fight: f, members: ms, outcome: 'cleared', clearTick: T };
  }
  // 3. Hazards.
  const b = lanternBlowAt(f, T, run.startTick), p = lanternPulseAt(f, T, run.startTick);
  for (const m of present) {
    if (m.hp > 0 && !(m.hitTick > 0 && T <= m.hitTick + LANTERN_IFRAME_TICKS)) {
      const dmg = Math.max(b && b.tiles[m.tile] ? b.damage : 0, p && p.tiles[m.tile] ? p.damage : 0);
      if (dmg > 0) { m.hp -= dmg; m.hitTick = T; m.hits++; }
    }
    if (m.hp > 0 && lanternFlooded(f, T, m.tile)) { m.hp -= LANTERN_DROWN_DAMAGE; m.drowned++; }
    if (m.hp <= 0) m.present = false;
  }
  // 4. Heal.
  const heal = lanternHealAt(f, T);
  if (heal) f = { ...f, hp: Math.min(f.maxHp, f.hp + heal) };
  // 5. Wipe, timeout.
  if (!ms.some((m) => m.present)) return { ...run, fight: f, members: ms, outcome: 'wiped' };
  if (T >= run.endTick) return { ...run, fight: f, members: ms, outcome: 'timeout' };
  // 6. Advance.
  f = lanternAdvance(f, T, run.startTick, ms.filter((m) => m.present).map((m) => m.tile));
  return { ...run, fight: f, members: ms };
}
