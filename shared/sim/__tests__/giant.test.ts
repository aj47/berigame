import { describe, expect, it } from 'vitest';
import {
  areaOf, boulderLineTiles, BOULDERS_ENTRY, canEnter, enterRule, inBoulders, isBoulderLine,
} from '../areas';
import { GRID_SIZE, ISLAND_SIZE, SPAWN_TILE } from '../constants';
import {
  chooseGiantTarget, freshGiant, GIANT_AGGRO_RANGE, GIANT_MAX_HP, GIANT_MIN_CONTRIBUTION, GIANT_RECOVER_TICKS,
  GIANT_REGEN_IDLE_TICKS, GIANT_RESPAWN_TICKS, GIANT_SLAM_DAMAGE, GIANT_SLAM_RADIUS, GIANT_SLAM_WINDUP_TICKS,
  GIANT_STOMP_RADIUS, GIANT_STOMP_WINDUP_TICKS, GIANT_TILE, GiantAttack, GiantState, giantAfterHit, giantFootprint,
  giantForgot, giantHpAt, giantRewardees, inAttackArea, stepGiant, type GiantRowLike,
} from '../giant';
import { chebyshev, isLandTile, tileKey } from '../grid';
import { TREE_SEEDS } from '../items';
import { NODE_SEEDS, NodeKind } from '../nodes';
import { bfsPath, goalIsTile, reachableTiles } from '../pathfinding';
import { worldBlockedSet } from '../social';
import type { Tile } from '../types';

const blocked = worldBlockedSet([...TREE_SEEDS, ...NODE_SEEDS]);
const keyed = enterRule(true, true);
const stickOnly = enterRule(true, false);
const none = enterRule(false, false);
const allTiles = (): Tile[] => {
  const out: Tile[] = [];
  for (let z = 0; z < GRID_SIZE; z++) for (let x = 0; x < GRID_SIZE; x++) out.push({ x, z });
  return out;
};

describe('M3: the Boulders geometry and gate', () => {
  it('grows the grid with the old island unchanged: 2500 + a 29-tile boulder line + 559 Boulders tiles of land', () => {
    expect(GRID_SIZE).toBe(64);
    const land = allTiles().filter(isLandTile);
    expect(land.filter((t) => t.x < ISLAND_SIZE && t.z < ISLAND_SIZE)).toHaveLength(2500);
    expect(boulderLineTiles()).toHaveLength(29);
    expect(land.filter(inBoulders)).toHaveLength(559);
    expect(land).toHaveLength(2500 + 29 + 559);
    expect(areaOf(SPAWN_TILE)).toBe('grove');
    expect(areaOf({ x: 46, z: 46 })).toBe('coast');
    expect(areaOf({ x: 50, z: 44 })).toBe('boulder-line');
    expect(areaOf(GIANT_TILE)).toBe('boulders');
    expect(areaOf({ x: 60, z: 10 })).toBe('sea');
  });

  it('has no gaps: every step from the Coast into the Boulders lands on the boulder line', () => {
    for (const t of allTiles()) {
      if (!isLandTile(t) || areaOf(t) !== 'coast') continue;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        expect(inBoulders({ x: t.x + dx, z: t.z + dz })).toBe(false);
      }
    }
  });

  it('the boulder line needs a stone club from the Coast, never from the Boulders; the sea is never enterable', () => {
    const coast = { x: 49, z: 44 }, line = { x: 50, z: 44 }, boulders = { x: 51, z: 44 };
    expect(isBoulderLine(line)).toBe(true);
    expect(canEnter(coast, line, true, false)).toBe(false);
    expect(canEnter(coast, line, true, true)).toBe(true);
    expect(canEnter(boulders, line, false, false)).toBe(true);
    expect(canEnter(line, coast, false, false)).toBe(true);
    expect(canEnter({ x: 49, z: 30 }, { x: 50, z: 30 }, true, true)).toBe(false);
  });

  it('reachability: a stick alone stops at the line; stick + club reach all walkable land; the way home is one-way', () => {
    const land = allTiles().filter(isLandTile).filter((t) => !blocked.has(tileKey(t)));
    const withStick = reachableTiles(SPAWN_TILE, blocked, stickOnly);
    expect([...withStick].some((k) => inBoulders({ x: k % GRID_SIZE, z: Math.floor(k / GRID_SIZE) }))).toBe(false);
    expect(reachableTiles(SPAWN_TILE, blocked, keyed).size).toBe(land.length);
    // Clubless and stickless in the Boulders: you can still walk home to spawn.
    expect(bfsPath({ x: 60, z: 60 }, goalIsTile(SPAWN_TILE), blocked, none)).not.toBeNull();
    // The sea blocks even with no rule at all.
    expect(bfsPath(SPAWN_TILE, goalIsTile({ x: 60, z: 10 }), blocked)).toBeNull();
    // A club holder from spawn reaches the chip's Boulders entry.
    expect(bfsPath(SPAWN_TILE, goalIsTile(BOULDERS_ENTRY), blocked, keyed)).not.toBeNull();
  });

  it('obsidian outcrops sit in the Boulders, reachable only with the club, and far from the Giant', () => {
    const obsidian = NODE_SEEDS.filter((n) => n.kind === NodeKind.Obsidian);
    expect(obsidian).toHaveLength(2);
    for (const n of obsidian) {
      expect(inBoulders(n)).toBe(true);
      expect(chebyshev(n, GIANT_TILE)).toBeGreaterThan(GIANT_AGGRO_RANGE + 2);
      const adj = (t: Tile) => chebyshev(t, n) === 1;
      expect(bfsPath(SPAWN_TILE, adj, blocked, keyed)).not.toBeNull();
      expect(bfsPath(SPAWN_TILE, adj, blocked, stickOnly)).toBeNull();
    }
  });
});

const giant = (over: Partial<GiantRowLike> = {}): GiantRowLike => ({ ...freshGiant(0), ...over });
const at = (x: number, z: number, order = 0) => ({ x, z, order });

describe('F3: the Giant AI', () => {
  it('blocks its 3x3 footprint and sits in the Boulders', () => {
    expect(giantFootprint()).toHaveLength(9);
    for (const t of giantFootprint()) { expect(blocked.has(tileKey(t))).toBe(true); expect(inBoulders(t)).toBe(true); }
  });

  it('idles (no write) with nobody in range', () => {
    expect(stepGiant(giant(), 10, []).next).toBeNull();
    expect(stepGiant(giant(), 10, [at(GIANT_TILE.x - GIANT_AGGRO_RANGE - 1, GIANT_TILE.z)]).next).toBeNull();
  });

  it('winds up on the nearest player tile, lands after the wind-up, then recovers', () => {
    const near = at(GIANT_TILE.x - 2, GIANT_TILE.z, 1), far = at(GIANT_TILE.x - 6, GIANT_TILE.z, 0);
    const w = stepGiant(giant(), 10, [far, near]);
    expect(w.windup).toBe(true);
    expect(w.next).toMatchObject({ state: GiantState.Windup, attack: GiantAttack.Slam, slamX: near.x, slamZ: near.z, stateUntilTick: 10 + GIANT_SLAM_WINDUP_TICKS });
    // Nothing lands before the wind-up ends.
    expect(stepGiant(w.next!, 10 + GIANT_SLAM_WINDUP_TICKS - 1, [near]).next).toBeNull();
    const b = stepGiant(w.next!, 10 + GIANT_SLAM_WINDUP_TICKS, [near]);
    expect(b.blow).toEqual({ x: near.x, z: near.z, radius: GIANT_SLAM_RADIUS, damage: GIANT_SLAM_DAMAGE, attack: GiantAttack.Slam });
    expect(b.next).toMatchObject({ state: GiantState.Recover, stateUntilTick: 10 + GIANT_SLAM_WINDUP_TICKS + GIANT_RECOVER_TICKS });
    // A player who walked 2 tiles away is outside the slam.
    expect(inAttackArea({ x: near.x - 2, z: near.z }, b.next!)).toBe(false);
    expect(inAttackArea(near, b.next!)).toBe(true);
    // Recovering: no new wind-up until the recover ends; then back to idle when alone.
    expect(stepGiant(b.next!, b.next!.stateUntilTick - 1, [near]).next).toBeNull();
    expect(stepGiant(b.next!, b.next!.stateUntilTick, []).next).toMatchObject({ state: GiantState.Idle });
  });

  it('every third attack is a stomp around itself with a longer telegraph', () => {
    const w = stepGiant(giant({ attackCount: 2 }), 5, [at(GIANT_TILE.x + 2, GIANT_TILE.z)]);
    expect(w.next).toMatchObject({ attack: GiantAttack.Stomp, slamX: GIANT_TILE.x, slamZ: GIANT_TILE.z, stateUntilTick: 5 + GIANT_STOMP_WINDUP_TICKS, attackCount: 3 });
    expect(stepGiant(w.next!, 5 + GIANT_STOMP_WINDUP_TICKS, []).blow?.radius).toBe(GIANT_STOMP_RADIUS);
    // Everyone in reach is inside the stomp; two steps back is outside.
    expect(inAttackArea({ x: GIANT_TILE.x + 2, z: GIANT_TILE.z }, w.next!)).toBe(true);
    expect(inAttackArea({ x: GIANT_TILE.x + 4, z: GIANT_TILE.z }, w.next!)).toBe(false);
  });

  it('ties go to tick order', () => {
    expect(chooseGiantTarget(GIANT_TILE, [at(GIANT_TILE.x + 3, GIANT_TILE.z, 2), at(GIANT_TILE.x - 3, GIANT_TILE.z, 1)])?.order).toBe(1);
  });

  it('HP: shared pool, no idle regeneration during a raid, defeat at 0, respawn after the timer', () => {
    const g = giant({ hp: 20, lastHitTick: 100 });
    expect(giantHpAt(g, 100 + GIANT_REGEN_IDLE_TICKS)).toBe(20);
    expect(giantHpAt(g, 100 + 10 * GIANT_REGEN_IDLE_TICKS)).toBe(20);
    expect(giantForgot(g, 100 + 10 * GIANT_REGEN_IDLE_TICKS)).toBe(false);
    expect(giantAfterHit(g, 8, 101)).toEqual({ hp: 12, defeated: false });
    expect(giantAfterHit(g, 25, 101)).toEqual({ hp: 0, defeated: true });
    const down = giant({ hp: 0, state: GiantState.Defeated, respawnTick: 700 });
    expect(giantHpAt(down, 650)).toBe(0);
    expect(stepGiant(down, 699, [at(GIANT_TILE.x - 2, GIANT_TILE.z)]).next).toBeNull();
    const up = stepGiant(down, 700, []);
    expect(up.respawned).toBe(true);
    expect(up.next).toMatchObject({ hp: GIANT_MAX_HP, state: GiantState.Idle, attackCount: 0 });
    expect(GIANT_RESPAWN_TICKS).toBe(500);
  });

  it('rewards everyone who dealt at least the minimum, equally', () => {
    const rows = [{ id: 'a', damage: GIANT_MIN_CONTRIBUTION }, { id: 'b', damage: GIANT_MIN_CONTRIBUTION - 1 }, { id: 'c', damage: 300 }];
    expect(giantRewardees(rows).map((r) => r.id)).toEqual(['a', 'c']);
  });
});

