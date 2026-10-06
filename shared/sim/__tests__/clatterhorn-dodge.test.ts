/**
 * Real-map dodgeability of Clatterhorn's hazards (FINAL_SPEC 2.5, appendix A
 * `glade.ts`): every charge lane and spin ring is escapable in <= 2 steps with
 * >= 3 ticks of notice, the swarm leaves every glade tile winning at its fire
 * tick, and the flip statistics reproduce.
 */
import { describe, expect, it } from 'vitest';
import { BOSS_CONFIG_DEFAULTS } from '../bossConfig';
import { CLATTER_GLADE, CLATTER_STONES } from '../bossZones';
import { movesWithin } from '../bullets';
import {
  CLATTER_CHARGE_WINDUP, CLATTER_DIR8, CLATTER_DRUM_WINDUP, CLATTER_SPIN_WINDUP, ClatterEndKind, ClatterState,
  clatterChooseLane, clatterHitsMove, clatterLane, clatterOctant, clatterSpinTiles, clatterSwarmFreeLines, clatterSwarmHit,
  clatterValidCentre, freshClatterhorn, type ClatterRowLike,
} from '../clatterhorn';
import { GRID_SIZE } from '../constants';
import { chebyshev, tileKey } from '../grid';
import { TREE_SEEDS } from '../items';
import { NODE_SEEDS } from '../nodes';
import { worldBlockedSet } from '../social';
import { terrainLand } from '../terrain';
import type { Tile } from '../types';

const G = CLATTER_GLADE;
const blocked = worldBlockedSet([...TREE_SEEDS, ...NODE_SEEDS]);
const stand = (t: Tile) => terrainLand(t) && !blocked.has(tileKey(t));
const inG = (t: Tile) => t.x >= G.x0 && t.x <= G.x1 && t.z >= G.z0 && t.z <= G.z1;
const unkey = (k: number): Tile => ({ x: k % GRID_SIZE, z: Math.floor(k / GRID_SIZE) });
const gladeTiles: Tile[] = [];
for (let z = G.z0; z <= G.z1; z++) for (let x = G.x0; x <= G.x1; x++) gladeTiles.push({ x, z });
const centres = gladeTiles.filter(clatterValidCentre);
const NB = [[0, 1], [-1, 0], [0, -1], [1, 0], [-1, 1], [-1, -1], [1, -1], [1, 1]] as const;
const TICK_MS = 600, RTT_MS = 150;

/** Fewest steps from t to a tile outside the hazard (8-way, no corner cutting, standable tiles only). */
function escapeSteps(t: Tile, hazard: ReadonlySet<number>, limit = 6): number {
  const seen = new Map<number, number>([[tileKey(t), 0]]);
  const q: Tile[] = [t];
  for (let i = 0; i < q.length; i++) {
    const cur = q[i], d = seen.get(tileKey(cur))!;
    if (!hazard.has(tileKey(cur))) return d;
    if (d === limit) continue;
    for (const [dx, dz] of NB) {
      const n = { x: cur.x + dx, z: cur.z + dz };
      if (!stand(n) || seen.has(tileKey(n))) continue;
      if (dx && dz && (!stand({ x: cur.x + dx, z: cur.z }) || !stand({ x: cur.x, z: cur.z + dz }))) continue;
      seen.set(tileKey(n), d + 1);
      q.push(n);
    }
  }
  return 99;
}
/** Reaction time for an escape of m tiles with lead L (FINAL_SPEC 2.5). */
const reactionMs = (L: number, m: number) => (L - Math.ceil(m / 2) + 1) * TICK_MS - RTT_MS;

describe('the real glade', () => {
  it('has 153 valid centres and every glade tile but the stones is standable', () => {
    expect(centres).toHaveLength(153);
    const unstandable = gladeTiles.filter((t) => !stand(t));
    expect(unstandable.map(tileKey).sort()).toEqual(CLATTER_STONES.map(tileKey).sort());
  });
});

describe('charge lanes', () => {
  it('are escapable in at most 2 steps in all 21,056 (centre, direction, tile) cases', () => {
    let cases = 0, worst = 0, over2 = 0;
    const lens: number[] = [];
    for (const c of centres) for (let o = 0; o < 8; o++) {
      const l = clatterLane(c, o);
      if (l.len < 2) continue;
      lens.push(l.len);
      const hazard = new Set(l.tiles);
      for (const k of l.tiles) {
        const t = unkey(k);
        if (!stand(t)) continue;
        cases++;
        const e = escapeSteps(t, hazard);
        worst = Math.max(worst, e);
        if (e > 2) over2++;
      }
    }
    lens.sort((a, b) => a - b);
    expect({ cases, worst, over2, median: lens[lens.length >> 1], max: lens[lens.length - 1] })
      .toEqual({ cases: 21056, worst: 2, over2: 0, median: 5, max: 14 });
  }, 60_000);

  it('give at least 3 ticks of notice: 2,250 ms in phase 1 and 1,650 ms later for a 2-step escape at 150 ms RTT', () => {
    expect(Math.min(...CLATTER_CHARGE_WINDUP.slice(1))).toBeGreaterThanOrEqual(3);
    expect(reactionMs(CLATTER_CHARGE_WINDUP[1], 2)).toBe(2250);
    expect(reactionMs(CLATTER_CHARGE_WINDUP[2], 2)).toBe(1650);
    expect(reactionMs(CLATTER_CHARGE_WINDUP[3], 2)).toBe(1650);
  });

  it('flip 15.2% and glance 45.6% of random charges (<= 25% flips)', () => {
    let pairs = 0, flips = 0, glances = 0;
    for (const c of centres) for (const t of gladeTiles) {
      if (chebyshev(c, t) < 3 || !stand(t)) continue;
      const l = clatterLane(c, clatterOctant(t.x - c.x, t.z - c.z, 0));
      if (l.len < 2) continue;
      pairs++;
      if (l.endKind === ClatterEndKind.Flip) flips++;
      if (l.endKind === ClatterEndKind.Glance) glances++;
    }
    expect((100 * flips / pairs).toFixed(1)).toBe('15.2');
    expect((100 * glances / pairs).toFixed(1)).toBe('45.6');
    expect(flips / pairs).toBeLessThanOrEqual(0.25);
  });

  it('flip on 100% of aligned-bait charges that happen (248 of 248; 128 too close choose another direction)', () => {
    const outcomes: Record<string, number> = {};
    for (const c of centres) for (const s of CLATTER_STONES) {
      const ddx = s.x - c.x, ddz = s.z - c.z;
      if (!(ddx === 0 || ddz === 0 || Math.abs(ddx) === Math.abs(ddz))) continue;
      if (Math.max(Math.abs(ddx), Math.abs(ddz)) < 3) continue;
      const o = clatterOctant(ddx, ddz, 0), [ox, oz] = CLATTER_DIR8[o];
      for (let back = 1; back <= 3; back++) {
        const t = { x: s.x + back * ox, z: s.z + back * oz };
        if (!inG(t) || !stand(t)) continue;
        const l = clatterLane(c, clatterOctant(t.x - c.x, t.z - c.z, 0));
        const kind = l.len < 2 ? 'short' : l.endKind === ClatterEndKind.Flip ? 'flip' : 'other';
        outcomes[kind] = (outcomes[kind] ?? 0) + 1;
        const chosen = clatterChooseLane(c, t, 0);
        if (kind === 'flip') expect(chosen?.dir).toBe(o);
        else expect(chosen === null || chosen.dir !== o).toBe(true);
      }
    }
    expect(outcomes).toEqual({ flip: 248, short: 128 });
  });
});

describe('shell spin', () => {
  it('is escapable in 1 step from every ring tile of every centre, with 3 ticks of notice', () => {
    let worst = 0, cases = 0;
    for (const c of centres) {
      const ring = new Set(clatterSpinTiles(c));
      for (const k of ring) {
        const t = unkey(k);
        if (!stand(t)) continue;
        cases++;
        worst = Math.max(worst, escapeSteps(t, ring));
      }
    }
    expect(cases).toBeGreaterThan(2000);
    expect(worst).toBe(1);
    expect(CLATTER_SPIN_WINDUP).toBe(3);
    expect(reactionMs(CLATTER_SPIN_WINDUP, 1)).toBe(1650);
  });
});

describe('the swarm', () => {
  const tiles = gladeTiles.filter(stand);
  const okIn = (t: Tile) => inG(t) && stand(t);
  const MOVES = new Map(tiles.map((t) => [tileKey(t), movesWithin(t, okIn)]));
  const swarmRow = (side: number, free: number, F: number): ClatterRowLike => ({
    ...freshClatterhorn({ ...BOSS_CONFIG_DEFAULTS, clatterhornOpen: true }),
    state: ClatterState.Drumming, swarmTick: F, stateUntilTick: F + 20, swarmSide: side, swarmFree: free, engagedTick: 1, hp: 300, maxHp: 1000,
  });

  it('leaves every glade tile winning at the fire tick for all 12 (side, free) cases, first contact F+1, free columns never hit', () => {
    const F = 500;
    let freeHit = 0, firstMin = Infinity;
    for (let side = 0; side < 4; side++) for (let free = 0; free < 3; free++) {
      const r = swarmRow(side, free, F);
      let first = Infinity, last = 0;
      for (let T = F; T <= F + 22; T++) for (const t of tiles) {
        if (clatterSwarmHit(r, T, t, t, t)) { first = Math.min(first, T); last = Math.max(last, T); }
      }
      firstMin = Math.min(firstMin, first - F);
      // Backward induction: a tile is winning at the end of tick T-1 when some move in tick T is hit-free and ends on a
      // tile winning at the end of T.
      let safe = new Set(tiles.map(tileKey));
      for (let T = last; T > F; T--) {
        const prev = new Set<number>();
        for (const t of tiles) {
          for (const m of MOVES.get(tileKey(t))!) {
            if (!safe.has(tileKey(m.end))) continue;
            if (clatterSwarmHit(r, T, t, m.mid, m.end)) continue;
            prev.add(tileKey(t));
            break;
          }
        }
        safe = prev;
      }
      expect(safe.size, `side ${side} free ${free}`).toBe(tiles.length);
      // The same verdicts through clatterHitsMove (what /danger uses).
      for (const t of tiles) for (let T = F + 1; T <= F + 3; T++) expect(clatterHitsMove(r, T, t, t, t)).toBe(clatterSwarmHit(r, T, t, t, t));
      const lines = clatterSwarmFreeLines(r);
      for (const t of tiles) {
        if (!lines.includes(side === 0 || side === 2 ? t.x : t.z)) continue;
        for (let T = F; T <= last; T++) if (clatterSwarmHit(r, T, t, t, t)) { freeHit++; break; }
      }
    }
    expect(firstMin).toBe(1);
    expect(freeHit).toBe(0);
    // Lead: windup 3 + first contact one tick after firing.
    expect(CLATTER_DRUM_WINDUP + firstMin).toBe(4);
    expect(reactionMs(CLATTER_DRUM_WINDUP + firstMin, 2)).toBe(2250);
  }, 60_000);
});
