import { describe, expect, it, vi } from 'vitest';
import { A, B, R, spireHarness } from './spireHarness';
import { testTable } from './adventureHarness';
import { Pending } from '../types';
import { NODE_SEEDS, TIER_NODE_SEEDS, nodeMinLevel } from '../nodes';
import { Cosmetic, SKILL_MAX_XP, Skill, hasCosmetic, xpForLevel } from '../skills';

vi.mock('../../../spacetimedb/node_modules/spacetimedb/dist/server/index.mjs', () => ({
  t: new Proxy({}, { get: () => () => ({}) }),
  SenderError: class SenderError extends Error {},
}));
vi.mock('../../../spacetimedb/src/schema', () => ({
  default: {
    reducer: (...args: unknown[]) => args[args.length - 1],
    init: (fn: unknown) => fn, clientConnected: (fn: unknown) => fn, clientDisconnected: (fn: unknown) => fn,
  },
}));
vi.mock('../../../spacetimedb/src/tables', () => ({ tickSchedule: { rowType: {} } }));
import { tick } from '../../../spacetimedb/src/reducers/tick';
import { startHarvest } from '../../../spacetimedb/src/reducers/harvest';
import { seedMissingNodes } from '../../../spacetimedb/src/lib/nodes';
import { grantXp } from '../../../spacetimedb/src/lib/progress';

// A Foraging level-15 node (wild honey hive) and an under-level waiter beside it.
const hive = TIER_NODE_SEEDS.find((s) => s.kind === 4)!;
const beside = { x: hive.x + 1, z: hive.z };
const skills = (h: ReturnType<typeof spireHarness>, who: typeof A, foraging: number) =>
  h.db.playerSkill.insert({ identity: who, foragingXp: xpForLevel(foraging), beachcombingXp: 0, craftingXp: 0 });

describe('Long Season level gates (server)', () => {
  it('startHarvest rejects a tier node below its level and accepts at the level', () => {
    const h = spireHarness(R(tick)); h.run();
    expect(nodeMinLevel(hive.kind)).toBe(15);
    h.place(A, beside);
    skills(h, A, 14);
    expect(() => R(startHarvest)(h.as(A), { treeId: hive.id })).toThrow('Needs Foraging level 15');
    expect(h.p(A).pending).toBe(Pending.None);
    h.db.playerSkill.identity.update({ ...h.db.playerSkill.identity.find(A), foragingXp: xpForLevel(15) });
    R(startHarvest)(h.as(A), { treeId: hive.id });
    expect(h.p(A)).toMatchObject({ pending: Pending.Harvest, pendingId: BigInt(hive.id) });
    h.run();
    expect(h.db.tree.id.find(hive.id).harvester?.toHexString()).toBe(A.toHexString());
    expect(h.p(A).harvestTreeId).toBe(hive.id);
  });

  it('the tick never hands a gated node to an under-level waiter, and drops the request', () => {
    const h = spireHarness(R(tick)); h.run();
    // Bypass the reducer, as a player who never had the level would only get here through a stale or forged row.
    h.place(A, beside, { pending: Pending.Harvest, pendingId: BigInt(hive.id) });
    h.place(B, { x: hive.x - 1, z: hive.z }, { pending: Pending.Harvest, pendingId: BigInt(hive.id) });
    skills(h, A, 1); skills(h, B, 15);
    h.run();
    const tree = h.db.tree.id.find(hive.id);
    expect(tree.harvester?.toHexString()).toBe(B.toHexString());
    expect(h.p(A)).toMatchObject({ pending: Pending.None, pendingId: 0n, harvestTreeId: 0 });
    h.run(30);
    expect(h.p(A).harvestTreeId).toBe(0);
  });
});

describe('node seeding', () => {
  it('inserts every NODE_SEED once and is a no-op afterwards', () => {
    const tree = testTable();
    const ctx: any = { db: { tree } };
    expect(seedMissingNodes(ctx)).toHaveLength(NODE_SEEDS.length);
    expect(tree.rows.size).toBe(NODE_SEEDS.length);
    expect(seedMissingNodes(ctx)).toEqual([]);
    // The tick's form: a preloaded map, updated with what was inserted or moved.
    tree.rows.delete(hive.id);
    const map = new Map<number, any>([...tree.rows.values()].map((r: any) => [r.id, r]));
    expect(seedMissingNodes(ctx, map).map((r) => r.id)).toEqual([hive.id]);
    expect(map.get(hive.id)).toMatchObject({ x: hive.x, z: hive.z, kind: hive.kind });
    expect(seedMissingNodes(ctx, map)).toEqual([]);
    expect(tree.rows.size).toBe(NODE_SEEDS.length);
  });

  it('the tick seeds without per-seed finds, writes nothing once seeded, and sees this tick’s new rows', () => {
    const h = spireHarness(R(tick));
    // Waiting on a node that does not exist until this tick seeds it.
    h.place(A, beside, { pending: Pending.Harvest, pendingId: BigInt(hive.id) });
    skills(h, A, 15);
    // Count primary-key finds on the tree table (the old seeding did two per seed per tick).
    let finds = 0;
    const real = h.db.tree;
    h.db.tree = new Proxy(real, { get: (obj: any, field: string) => {
      const v = real[field];
      return field === 'id' ? { ...v, find: (k: number) => { finds++; return v.find(k); } } : v;
    } });
    h.db.tree.id.find(hive.id); expect(finds).toBe(1); finds = 0;
    h.run();
    expect(finds).toBeLessThan(10);
    expect(h.db.tree.rows.size).toBe(NODE_SEEDS.length);
    expect(h.db.tree.id.find(hive.id).harvester?.toHexString()).toBe(A.toHexString());
    const before = h.db.tree.rows.size;
    const insert = vi.spyOn(real, 'insert');
    finds = 0;
    h.run(3);
    expect(insert).not.toHaveBeenCalled();
    expect(finds).toBeLessThan(30);
    expect(h.db.tree.rows.size).toBe(before);
  });
});

describe('Paragon Sash', () => {
  it('unlocks when the last skill reaches 99, not before', () => {
    const h = spireHarness(R(tick));
    h.db.playerSkill.insert({ identity: A, foragingXp: SKILL_MAX_XP, beachcombingXp: xpForLevel(98), craftingXp: xpForLevel(98) });
    const unlocked = () => h.db.playerCosmetic.identity.find(A)?.unlocked ?? 0;
    expect(grantXp(h.ctx, A, Skill.Crafting, SKILL_MAX_XP)).toBe(99);
    expect(hasCosmetic(unlocked(), Cosmetic.ParagonSash)).toBe(false);
    expect(grantXp(h.ctx, A, Skill.Beachcombing, SKILL_MAX_XP)).toBe(99);
    expect(hasCosmetic(unlocked(), Cosmetic.ParagonSash)).toBe(true);
  });
});
