import { describe, expect, it } from 'vitest';
import { InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';
import {
  SPIRE_NONE, SPIRE_ORIGINS, spireDangerTiles, spireFightBullets, spirePatternBullets, spireStars, sweptHit, tileKey,
  worldToTile, type SpireFightLike,
} from '@sim';
import { DANGER_CAPACITY, writeDangerInstances } from '../bosses/DangerTiles';
import { assistDots, chargeTelegraph, fightSafety, hoverVerdict, overlayDanger } from '../bosses/spire/overlayModel';
import { starView } from '../bosses/spire/starModel';
import { SPIRE_BLOCKED } from '../bosses/spire/spireView';

const fight = (over: Partial<SpireFightLike> = {}): SpireFightLike => ({
  hp: 1000, maxHp: 1000, phase: 1, seed: 1234, patternCount: 2,
  curKind: 2, curStart: 100, curSeed: 17, curAimX: 74, curAimZ: 66,
  prevKind: 1, prevStart: 88, prevSeed: 5, prevAimX: 74, prevAimZ: 66,
  starWave: 0, starMask: 0,
  hitTick0: 0, hitTick1: 0, hitTick2: 0, hitTick3: 0, hits0: 0, hits1: 0, hits2: 0, hits3: 0,
  stars0: 0, stars1: 0, stars2: 0, stars3: 0, dmg0: 0, dmg1: 0, dmg2: 0, dmg3: 0, downs0: 0, downs1: 0, downs2: 0, downs3: 0,
  ...over,
});

/** The tile keys under a DangerTiles mesh's quads. */
function quadTiles(tiles: Set<number>): Set<number> {
  const mesh = new InstancedMesh(new PlaneGeometry(1, 1), new MeshBasicMaterial(), DANGER_CAPACITY);
  const n = writeDangerInstances(mesh, tiles);
  const out = new Set<number>(), m = new Matrix4(), p = new Vector3();
  for (let i = 0; i < n; i++) {
    mesh.getMatrixAt(i, m);
    p.setFromMatrixPosition(m);
    expect(p.y).toBeCloseTo(0.03);
    out.add(tileKey(worldToTile(p.x, p.z)));
  }
  return out;
}

describe('the danger overlay (server timeline)', () => {
  it('draws exactly spireDangerTiles at τ+1 (red) and τ+2 (amber)', () => {
    const f = fight();
    const bullets = spireFightBullets(f);
    let drawn = 0;
    for (let tau = 100; tau < 122; tau++) {
      const { red, amber } = overlayDanger(bullets, tau);
      expect(quadTiles(red)).toEqual(spireDangerTiles(bullets, tau + 1));
      expect(quadTiles(amber)).toEqual(spireDangerTiles(bullets, tau + 2));
      drawn += red.size;
    }
    expect(drawn).toBeGreaterThan(50);
  });

  it('marks a diagonal slip between two adjacent wall bullets as a hit', () => {
    // Two wall bullets moving south in lanes x 74 and 75 (q 1), fired at 100. During tick 102 both move
    // from row 55 to row 56; a player slipping diagonally from (74,56) to (75,55) passes between them.
    const wall = new Int32Array([100, 74, 54, 0, 1, 1, 100, 75, 54, 0, 1, 1]);
    const tau = 101, p0 = { x: 74, z: 56 }, p2 = { x: 75, z: 55 };
    // The swap-only rule would let it through: neither bullet swaps tiles with the player.
    const a0 = { x: 74, z: 55 }, a1 = { x: 74, z: 56 }, b0 = { x: 75, z: 55 }, b1 = { x: 75, z: 56 };
    expect(p0.x + p2.x === a0.x + a1.x || p0.x + p2.x === b0.x + b1.x).toBe(false);
    expect(sweptHit(p0, p2, p2, a0, a1, a1)).toBe(1);
    const v = hoverVerdict(wall, tau, p0, p2, null, SPIRE_BLOCKED, 3);
    expect(v).toMatchObject({ kind: 'hit', half: 1, damage: 3, tile: p2 });
    // Sidestepping along the row below the wall is safe.
    expect(hoverVerdict(wall, tau, { x: 74, z: 58 }, { x: 76, z: 58 }, null, SPIRE_BLOCKED, 3)?.kind).toBe('safe');
    // Outside Chebyshev 2, on the dais or off the floor: no ring.
    expect(hoverVerdict(wall, tau, p0, { x: 77, z: 56 }, null, SPIRE_BLOCKED, 3)).toBeNull();
    expect(hoverVerdict(wall, tau, { x: 75, z: 62 }, { x: 76, z: 62 }, null, SPIRE_BLOCKED, 3)).toBeNull();
  });

  it('colours a hit-free hover amber when it is not winning, green when it is', () => {
    const f = fight({ prevKind: SPIRE_NONE, curKind: 6, curSeed: 3, curStart: 100 });
    const bullets = spireFightBullets(f);
    const safety = fightSafety('run-1', f, bullets, SPIRE_BLOCKED);
    expect(fightSafety('run-1', f, bullets, SPIRE_BLOCKED)).toBe(safety);
    let safe = 0, risky = 0;
    for (let tau = 100; tau < 126; tau++) {
      for (let x = 70; x <= 84; x++) for (const z of [57, 60, 66]) {
        const me = { x, z };
        if (!safety.winning(tau, me)) continue;
        for (const m of safety.movesFrom(tau, me)) {
          const v = hoverVerdict(bullets, tau, me, m.end, safety, SPIRE_BLOCKED, 4);
          if (!v) continue;
          expect(v.kind).toBe(m.hit ? 'hit' : m.winning ? 'safe' : 'risky');
          if (v.kind === 'safe') safe++;
          if (v.kind === 'risky') risky++;
        }
      }
    }
    expect(safe).toBeGreaterThan(0);
    expect(risky).toBeGreaterThan(0);
  });

  it('dodge assist dots are the winning, hit-free destinations agents receive', () => {
    const f = fight({ prevKind: SPIRE_NONE, curKind: 2, curStart: 100 });
    const bullets = spireFightBullets(f);
    const safety = fightSafety('run-2', f, bullets, SPIRE_BLOCKED);
    const me = { x: 77, z: 57 };
    const dots = assistDots(safety, 104, me);
    const want = new Set(safety.movesFrom(104, me).filter((m) => !m.hit && m.winning).map((m) => tileKey(m.end)));
    expect(dots).toEqual(want);
    expect(dots.size).toBeGreaterThan(0);
    expect(assistDots(null, 104, me).size).toBe(0);
  });

  it('charge telegraphs: walls show their entering row with the gap dark; rings light their pillar', () => {
    // tidewall: WALL(N) at offset 2, so at τ = P the wall fires in (τ, τ+3].
    const wall = spirePatternBullets(2, 100, 0, 77, 69);
    const t = chargeTelegraph(wall, 100);
    expect(t.fireTicks).toEqual(new Set([102]));
    expect(t.tiles.size).toBe(12); // 15 lanes minus a 3-wide gap, one tile each
    const rows = new Set([...t.tiles].map((k) => Math.floor(k / 128)));
    expect(rows.size).toBe(1);
    expect(t.pillars.size).toBe(0);
    // lattice: corner-pillar rings at offset 4 light pillars 1-4.
    const lattice = spirePatternBullets(4, 100, 0, 74, 66);
    const l = chargeTelegraph(lattice, 101);
    expect([...l.pillars].sort()).toEqual([1, 2, 3, 4]);
    for (const k of l.tiles) expect(SPIRE_ORIGINS.some((o) => tileKey(o) === k)).toBe(false);
    // Nothing fires in (τ, τ+3] once the volleys are out.
    expect(chargeTelegraph(wall, 110).tiles.size).toBe(0);
  });
});

describe('stars', () => {
  const run = { startTick: 100, partySize: 2 };
  it('shows the live wave minus caught bits, and previews the next wave in its last 2 ticks', () => {
    const f = { seed: 77, starWave: 0, starMask: 0b0101 };
    const v = starView(run, f, 104);
    expect(v.count).toBe(4);
    expect(v.caught).toBe(2);
    expect(v.live.map((s) => s.j)).toEqual([1, 3]);
    expect(v.live.map((s) => s.tile)).toEqual([1, 3].map((j) => spireStars(77, 0, 4)[j]));
    expect(v.preview).toEqual([]);
    expect(v.ending).toBe(false);
    const late = starView(run, f, 110);
    expect(late.ending).toBe(true);
    expect(late.preview).toEqual(spireStars(77, 1, 4));
    // A new wave resets the mask even before the fight row catches up.
    expect(starView(run, f, 112).live).toHaveLength(4);
    // None during the intro.
    expect(starView(run, f, 99).live).toHaveLength(0);
  });
});
