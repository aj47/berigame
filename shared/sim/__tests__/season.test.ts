import { describe, expect, it } from 'vitest';
import { areaOf, bossNoPvpZone, enterRule } from '../areas';
import { GRID_SIZE, SPAWN_TILE, TICK_MS } from '../constants';
import { blockedSetFromTiles, chebyshev, isLandTile } from '../grid';
import { getItemDef, TREE_SEEDS } from '../items';
import { reachableTiles } from '../pathfinding';
import { NODE_SEEDS, RECIPES, SEASON_RECIPES, TIER_NODE_SEEDS, harvestTicksFor, nodeLevelRejection, nodeMinLevel, regrowTicksFor } from '../nodes';
import { SEASON_ITEMS, TIER_BIOMES, TIER_ID_BLOCK, TIER_NODES, FIRST_TIER_NODE_ID, placeTierNodes, tierNode } from '../season';
import { biomeOf } from '../expanse';
import { HARVEST_XP, SKILL_MAX_LEVEL, Skill, harvestTicksAtLevel, harvestXp, levelForXp, skillForNode, xpForLevel } from '../skills';
import { ENERGY_MAX, ENERGY_REGEN_MS, energyRestedLine } from '../energy';
import { LEDGER_SEALS_PER_DAY, LEDGER_TEMPLATES } from '../ledger';
import { DROP_BOXES } from '../banking';
import { WAYSTONES } from '../expanse';
import { SCENERY_BLOCKERS, LANDMARKS, trailDistance } from '../terrain';
import type { Tile } from '../types';

const tileOf = (k: number): Tile => ({ x: k % GRID_SIZE, z: Math.floor(k / GRID_SIZE) });

describe('Long Season tier nodes', () => {
  it('defines ten kinds, two per tier, one per gathering skill, gated 15/30/45/60/80', () => {
    expect(TIER_NODES.map((d) => d.kind)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    for (let tier = 1; tier <= 5; tier++) {
      const pair = TIER_NODES.filter((d) => d.tier === tier);
      expect(pair.map((d) => d.skill).sort()).toEqual([Skill.Foraging, Skill.Beachcombing]);
      expect(new Set(pair.map((d) => d.minLevel)).size).toBe(1);
    }
    expect(TIER_NODES.filter((d) => d.skill === 0).map((d) => d.minLevel)).toEqual([15, 30, 45, 60, 80]);
    for (const d of TIER_NODES) {
      expect(getItemDef(d.itemId), d.itemId).toBeDefined();
      expect(skillForNode(d.kind)).toBe(d.skill);
      expect(harvestXp(d.kind)).toBe(d.xp);
      expect([harvestTicksFor(d.kind), regrowTicksFor(d.kind)]).toEqual([d.harvestTicks, d.regrowTicks]);
      expect(nodeMinLevel(d.kind)).toBe(d.minLevel);
      expect(nodeLevelRejection(d.kind, d.minLevel - 1)).toMatch(/^Needs (Foraging|Beachcombing) level \d+$/);
      expect(nodeLevelRejection(d.kind, d.minLevel)).toBeNull();
    }
    expect(nodeLevelRejection(0, 1)).toBeNull();
    expect(tierNode(3)).toBeUndefined();
  });

  it('pays more XP per second of harvest each tier, every second still costing one energy point', () => {
    const berry = HARVEST_XP[0] / (harvestTicksFor(0) * TICK_MS / 1000);
    let last = berry;
    for (let tier = 1; tier <= 5; tier++) {
      const d = TIER_NODES.find((n) => n.tier === tier)!;
      const perSecond = d.xp / (d.harvestTicks * TICK_MS / 1000);
      expect(perSecond).toBeGreaterThan(last);
      expect(perSecond).toBeLessThan(10);
      last = perSecond;
    }
  });

  it('places at least 80% of each kind, on Coast land, with stable ids', () => {
    for (const d of TIER_NODES) {
      const placed = TIER_NODE_SEEDS.filter((s) => s.kind === d.kind);
      expect(placed.length, d.key).toBeGreaterThanOrEqual(Math.floor(d.count * 0.8));
      const block = FIRST_TIER_NODE_ID + (d.kind - 4) * TIER_ID_BLOCK;
      for (const s of placed) expect(s.id >= block && s.id < block + d.count).toBe(true);
    }
    expect(TIER_NODE_SEEDS.length).toBeGreaterThan(900);
    expect(new Set(NODE_SEEDS.map((s) => s.id)).size).toBe(NODE_SEEDS.length);
    for (const s of TIER_NODE_SEEDS) {
      expect(isLandTile(s)).toBe(true);
      expect(areaOf(s)).toBe('coast');
      expect(bossNoPvpZone(s)).toBeNull();
      expect(trailDistance(s.x, s.z)).toBeGreaterThanOrEqual(2);
      for (const l of LANDMARKS) expect(chebyshev(s, l)).toBeGreaterThanOrEqual(4);
    }
  });

  it('grows each tier in its own biomes, the top tiers furthest along the roads', () => {
    for (const n of TIER_NODE_SEEDS) expect(TIER_BIOMES[tierNode(n.kind)!.tier - 1]).toContain(biomeOf(n));
    const avg = (tier: number) => {
      const s = TIER_NODE_SEEDS.filter((n) => tierNode(n.kind)!.tier === tier);
      return s.reduce((a, n) => a + Math.hypot(n.x - SPAWN_TILE.x, n.z - SPAWN_TILE.z), 0) / s.length;
    };
    expect(avg(5)).toBeGreaterThan(Math.max(avg(1), avg(2), avg(3), avg(4)));
    expect(avg(1)).toBeLessThan(Math.min(avg(2), avg(3), avg(4), avg(5)));
  });

  it('keeps a gap to every other blocker, the drop boxes and the waystones', () => {
    const others = [...TREE_SEEDS, ...NODE_SEEDS];
    const near = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
    const bad: string[] = [];
    for (const s of TIER_NODE_SEEDS) {
      for (const o of others) if (o.id !== s.id && near(s, o) < (o.id >= FIRST_TIER_NODE_ID ? 2 : 3)) bad.push(`${s.id} vs node ${o.id}`);
      for (const o of SCENERY_BLOCKERS) if (near(s, o) < 2) bad.push(`${s.id} vs scenery ${o.x},${o.z}`);
      for (const b of DROP_BOXES) if (near(s, b) <= 3) bad.push(`${s.id} vs drop box ${b.id}`);
      for (const w of WAYSTONES) if (near(s, w) <= 3) bad.push(`${s.id} vs waystone ${w.id}`);
    }
    expect(bad).toEqual([]);
  });

  it('is deterministic, and the connectivity repair drops only a handful', () => {
    const base = NODE_SEEDS.filter((s) => s.id < FIRST_TIER_NODE_ID);
    const placed = placeTierNodes([...TREE_SEEDS, ...base], [...DROP_BOXES, ...WAYSTONES]);
    expect(placeTierNodes([...TREE_SEEDS, ...base], [...DROP_BOXES, ...WAYSTONES])).toEqual(placed);
    const byId = new Map(placed.map((s) => [s.id, s]));
    for (const s of TIER_NODE_SEEDS) expect(byId.get(s.id)).toEqual({ ...s });
    expect(placed.length - TIER_NODE_SEEDS.length).toBeLessThanOrEqual(5);
  });

  it('every node can be reached with a stick, with every node blocking its tile', () => {
    const blocked = new Set([...blockedSetFromTiles([...TREE_SEEDS, ...NODE_SEEDS]), ...blockedSetFromTiles(SCENERY_BLOCKERS)]);
    const all = reachableTiles(SPAWN_TILE, blocked, enterRule(true));
    const reach = new Set(all);
    for (const n of TIER_NODE_SEEDS) {
      let ok = false;
      for (let dz = -1; dz <= 1 && !ok; dz++) for (let dx = -1; dx <= 1 && !ok; dx++) {
        if (!dx && !dz) continue;
        ok = reach.has((n.z + dz) * GRID_SIZE + n.x + dx);
      }
      expect(ok, `node ${n.id} at ${n.x},${n.z}`).toBe(true);
    }
    expect([...all].map(tileOf).length).toBeGreaterThan(30000);
  });
});

describe('Long Season goods', () => {
  it('every season recipe uses known items, and nothing level-gated heals or hits', () => {
    for (const r of SEASON_RECIPES) {
      expect(RECIPES).toContain(r);
      for (const i of r.inputs) expect(getItemDef(i.itemId), `${r.id} ${i.itemId}`).toBeDefined();
      if (r.output) {
        const out = getItemDef(r.output.itemId)!;
        expect(out.healthRestore).toBe(0);
        expect(out.weaponDamage).toBe(0);
      }
    }
    for (const m of SEASON_ITEMS) expect((m.healthRestore ?? 0)).toBeLessThan(getItemDef('berry_blueberry')!.healthRestore);
  });

  it('every tier material has a recipe that uses it, and every crafted good a later use', () => {
    const used = new Set(RECIPES.flatMap((r) => r.inputs.map((i) => i.itemId)));
    const asked = new Set(LEDGER_TEMPLATES.map((t) => t.itemId));
    for (const d of TIER_NODES) expect(used.has(d.itemId), d.itemId).toBe(true);
    for (const r of SEASON_RECIPES) if (r.output) expect(used.has(r.output.itemId) || asked.has(r.output.itemId), r.id).toBe(true);
  });

  it('seal keepsakes need about two weeks of full ledgers', () => {
    const seals = SEASON_RECIPES.reduce((n, r) => n + (r.inputs.find((i) => i.itemId === 'ledger_seal')?.quantity ?? 0), 0);
    expect(seals / LEDGER_SEALS_PER_DAY).toBeGreaterThanOrEqual(10);
    expect(seals / LEDGER_SEALS_PER_DAY).toBeLessThanOrEqual(20);
  });
});

/**
 * A month of 8-hour days: 16 h away fills the meter, then half the session is
 * spent harvesting (the rest walking, crafting, fighting, chatting), split
 * between the two gathering skills at the best node each has unlocked, with
 * everything gathered crafted and a full ledger every day. No contention: this
 * is the fastest honest pace, so the slowest it can be is what a crowd does.
 */
function simulate(days: number) {
  const xp = [0, 0, 0];
  const levelUps: number[] = [];
  const rested = energyRestedLine(ENERGY_MAX);
  for (let day = 0; day < days; day++) {
    const before = xp.map(levelForXp);
    let points = ENERGY_MAX, tired = 0;
    const session = 8 * 3600, harvestShare = 0.5;
    let t = 0, regen = 0;
    while (t < session) {
      const skill = (Math.floor(t / 1800) % 2) as 0 | 1;
      const level = levelForXp(xp[skill]);
      const best = [...TIER_NODES].reverse().find((d) => d.skill === skill && level >= d.minLevel);
      const kind = best?.kind ?? (skill === 0 ? 0 : 2);
      const ticks = harvestTicksAtLevel(harvestTicksFor(kind), level);
      const seconds = ticks * TICK_MS / 1000;
      let payout = 0;
      if (points < seconds) { tired = (tired + 1) % 4; payout = tired === 0 ? 1 : 0; }
      else { payout = points > rested ? 2 : 1; points -= seconds; }
      const gained = harvestXp(kind) * payout;
      xp[skill] += gained;
      xp[2] += gained / 2;
      const elapsed = seconds / harvestShare;
      t += elapsed;
      regen += elapsed * 1000;
      while (regen >= ENERGY_REGEN_MS) { regen -= ENERGY_REGEN_MS; if (points < rested) points++; }
    }
    // Ledger: three commissions at the levels of the day.
    for (let s = 0; s < 3; s++) {
      const top = LEDGER_TEMPLATES.filter((tm) => tm.skill === s && levelForXp(xp[s]) >= tm.level).sort((a, b) => b.level - a.level)[0];
      xp[s] += top.xp;
    }
    const after = xp.map(levelForXp);
    levelUps.push(after.reduce((n, l, i) => n + l - before[i], 0));
  }
  return { levels: xp.map(levelForXp), levelUps, xp };
}

describe('Long Season pacing', () => {
  it('8 hours a day keeps levelling for a month without capping everything', () => {
    const month = simulate(30);
    // Every day of the month brings at least one level somewhere.
    expect(month.levelUps.every((n) => n >= 1), JSON.stringify(month.levelUps)).toBe(true);
    // A month of full days reaches the top tiers but not the cap in every skill.
    expect(Math.min(...month.levels)).toBeGreaterThanOrEqual(80);
    expect(Math.min(...month.levels)).toBeLessThan(SKILL_MAX_LEVEL);
    // The first day still gets a new player to the first tier (level 15).
    expect(Math.max(...simulate(1).levels)).toBeGreaterThanOrEqual(15);
  });

  it('the cap is a long-term goal: about two months at 8 hours a day', () => {
    let days = 0, r = simulate(1);
    for (days = 30; days <= 120; days += 10) { r = simulate(days); if (Math.min(...r.levels) >= SKILL_MAX_LEVEL) break; }
    expect(days).toBeGreaterThanOrEqual(40);
    expect(days).toBeLessThanOrEqual(100);
    expect(xpForLevel(SKILL_MAX_LEVEL)).toBeGreaterThan(xpForLevel(80) * 2);
  });
});
