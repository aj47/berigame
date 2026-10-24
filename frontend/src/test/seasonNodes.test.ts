import { Box3 } from 'three';
import { NODE_SEEDS, NodeKind, TIER_NODES, TICK_MS, xpForLevel } from '@sim';
import { SEASON_MODEL_KINDS, seasonMaterial, seasonNodeGeometry, seasonNodeHeight } from '../Components/3D/nodes/SeasonNodes';
import { triangleCount } from '../Components/3D/nodes/lowPoly';
import { NODE_VIEW_CELL, NODE_VIEW_RADIUS, nearbyNodes, nodeViewCell } from '../Components/3D/nodes/nearbyNodes';
import { harvestStatus, mySkillLevel } from '../Components/harvestUi';
import { minimapModel } from '../Components/minimapModel';
import { HOME_JOIN, MEADOW_OFFSET } from '../../../shared/sim/frontier/homeMap';

const node = (kind: number, extra: Record<string, unknown> = {}) =>
  ({ id: 1000, x: 10, z: 10, kind, itemId: TIER_NODES[kind - 4]?.itemId ?? 'driftwood', cooldownUntilTick: 0, ...extra }) as any;

describe('Long Season node models', () => {
  it('every tier kind has a model', () => {
    expect(SEASON_MODEL_KINDS).toEqual(TIER_NODES.map((d) => d.kind));
    expect(seasonNodeGeometry(NodeKind.Driftwood, true)).toBeUndefined();
  });

  for (const def of TIER_NODES) {
    for (const ripe of [true, false]) {
      it(`${def.key} (${ripe ? 'ripe' : 'regrowing'}) is low-poly, vertex-coloured, glow-weighted, shared and on the ground`, () => {
        const g = seasonNodeGeometry(def.kind, ripe)!;
        expect(g).toBe(seasonNodeGeometry(def.kind, ripe));
        expect(triangleCount(g)).toBeLessThan(400);
        expect(triangleCount(g)).toBeGreaterThan(40);
        const n = g.getAttribute('position').count;
        expect(g.getAttribute('color').count).toBe(n);
        expect(g.getAttribute('glow').count).toBe(n);
        for (const v of g.getAttribute('position').array as Float32Array) expect(Number.isFinite(v)).toBe(true);
        const box = new Box3().setFromBufferAttribute(g.getAttribute('position') as any);
        expect(box.min.y).toBeGreaterThan(-0.25);
        expect(box.max.y).toBeLessThan(2.4);
        expect(Math.max(box.max.x - box.min.x, box.max.z - box.min.z)).toBeLessThan(2.4);
      });
    }
    it(`${def.key} states differ`, () => expect(seasonNodeGeometry(def.kind, true)).not.toBe(seasonNodeGeometry(def.kind, false)));
  }

  it('the kinds are distinct shapes', () => {
    const sizes = new Set(TIER_NODES.map((d) => triangleCount(seasonNodeGeometry(d.kind, true)!)));
    expect(sizes.size).toBeGreaterThanOrEqual(8);
  });

  it('glowing kinds glow when ripe and dim while regrowing', () => {
    const maxGlow = (kind: number, ripe: boolean) => Math.max(...(seasonNodeGeometry(kind, ripe)!.getAttribute('glow').array as Float32Array));
    for (const key of ['glowcap_ring', 'starblossom', 'moonstone_vein', 'fallen_star']) {
      const kind = TIER_NODES.find((d) => d.key === key)!.kind;
      expect(maxGlow(kind, true)).toBeGreaterThan(0.4);
      expect(maxGlow(kind, false)).toBeLessThan(maxGlow(kind, true));
    }
  });

  it('shares one material and gives each kind a ring height', () => {
    expect(seasonMaterial()).toBe(seasonMaterial());
    expect(seasonMaterial().vertexColors).toBe(true);
    for (const def of TIER_NODES) expect(seasonNodeHeight(def.kind)).toBeGreaterThan(0.3);
  });
});

describe('Long Season harvest status', () => {
  const hive = TIER_NODES.find((d) => d.key === 'honey_hive')!;
  const star = TIER_NODES.find((d) => d.key === 'fallen_star')!;

  it('uses the tier verb and regrow label', () => {
    expect(harvestStatus(node(hive.kind), 100, null, 'me').label).toBe('Smoke Honeycomb');
    expect(harvestStatus(node(star.kind), 100, null, 'me').label).toBe('Hammer Star Iron');
    const seconds = Math.ceil(10 * TICK_MS / 1000);
    expect(harvestStatus(node(hive.kind, { cooldownUntilTick: 110 }), 100, null, 'me').label).toBe(`Bees rebuilding in ${seconds}s`);
    expect(harvestStatus(node(star.kind, { cooldownUntilTick: 110 }), 100, null, 'me').label).toBe(`Cooling in ${seconds}s`);
  });

  it('locks a tier node below its level and only when a level is given', () => {
    const glowcap = TIER_NODES.find((d) => d.key === 'glowcap_ring')!;
    expect(harvestStatus(node(glowcap.kind), 100, null, 'me').locked).toBeNull();
    expect(harvestStatus(node(glowcap.kind), 100, null, 'me', 29).locked).toBe('Needs Foraging level 30');
    expect(harvestStatus(node(glowcap.kind), 100, null, 'me', 30).locked).toBeNull();
    expect(harvestStatus(node(star.kind), 100, null, 'me', 1).locked).toBe('Needs Beachcombing level 80');
    expect(harvestStatus({ ...node(NodeKind.Driftwood), itemId: 'driftwood' }, 100, null, 'me', 1).locked).toBeNull();
  });

  it('reads your level in the node’s own skill', () => {
    const skills = { foragingXp: xpForLevel(30), beachcombingXp: xpForLevel(15) };
    expect(mySkillLevel(skills, TIER_NODES.find((d) => d.key === 'glowcap_ring')!.kind)).toBe(30);
    expect(mySkillLevel(skills, TIER_NODES.find((d) => d.key === 'oyster_bed')!.kind)).toBe(15);
    expect(mySkillLevel(null, hive.kind)).toBe(1);
  });
});

describe('nearby node mounting', () => {
  it('keeps berry trees and nodes within the view radius, drops the rest', () => {
    const nodes = [
      { id: 1, x: 120, z: 120, kind: NodeKind.Berry },
      { id: 2, x: 40, z: 40, kind: NodeKind.Driftwood },
      { id: 3, x: 40 + NODE_VIEW_RADIUS, z: 40, kind: 6 },
      { id: 4, x: 40, z: 40 + NODE_VIEW_RADIUS + NODE_VIEW_CELL + 1, kind: 7 },
      { id: 5, x: 120, z: 10, kind: 13 },
    ];
    expect(nearbyNodes(nodes, nodeViewCell({ x: 40, z: 40 })).map((n) => n.id)).toEqual([1, 2, 3]);
  });

  it('never drops a node within the radius of your exact tile, wherever you stand in a cell', () => {
    for (let x = 32; x < 40; x++) for (const z of [32, 39]) {
      const cell = nodeViewCell({ x, z });
      const ids = nearbyNodes([{ x: x + NODE_VIEW_RADIUS, z: z - NODE_VIEW_RADIUS, kind: 5 }, { x: x - NODE_VIEW_RADIUS, z, kind: 5 }], cell);
      expect(ids).toHaveLength(2);
    }
  });

  it('quantizes your position, maps the Meadows into the home frame and falls back to spawn', () => {
    expect(nodeViewCell({ x: 33, z: 39 })).toBe(nodeViewCell({ x: 39, z: 32 }));
    expect(nodeViewCell({ x: 40, z: 39 })).not.toBe(nodeViewCell({ x: 39, z: 39 }));
    expect(nodeViewCell({ x: 0, z: 64, region: 'settlement' })).toBe(nodeViewCell({ x: MEADOW_OFFSET.x, z: 64 + MEADOW_OFFSET.z }));
    expect(nodeViewCell({ x: 0, z: 64, region: 'settlement' })).toBe(nodeViewCell({ x: HOME_JOIN.bramblewild.x + 1, z: HOME_JOIN.bramblewild.z }));
    expect(nodeViewCell(null)).toMatch(/^\d+,\d+$/);
  });

  it('mounts a fraction of the season nodes from any one spot', () => {
    const shown = nearbyNodes(NODE_SEEDS, nodeViewCell({ x: 64, z: 64 })).filter((n) => n.kind !== NodeKind.Berry);
    expect(NODE_SEEDS.length).toBeGreaterThan(400);
    expect(shown.length).toBeLessThan(NODE_SEEDS.filter((n) => n.kind !== NodeKind.Berry).length * 0.6);
  });
});

describe('minimap tier colours', () => {
  it('draws each tier node in its tier colour', () => {
    const model = minimapModel({
      meHex: null, players: [], groundItems: [], tick: 0,
      trees: TIER_NODES.map((d, i) => ({ id: 1000 + i, x: i, z: i, kind: d.kind, itemId: d.itemId, cooldownUntilTick: 0 })),
    } as any);
    expect(model.nodes.map((n) => n.color)).toEqual(TIER_NODES.map((d) => d.color));
  });
});
