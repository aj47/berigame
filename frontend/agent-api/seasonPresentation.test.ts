import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEDGER_CLERK, LEDGER_DAY_MS, NodeKind, TIER_NODES, emptySlots, ledgerFor } from '../../shared/sim';
import { deliveryProblem, describeLedger, describeNodeKinds, levelError, NODE_KIND_NAMES, nodeKindOf, nodeLevelInfo, nodeLockReason, ledgerStateOf } from './seasonPresentation';
import { summarizeState } from './mcpView';

const identity = 'b'.repeat(64);
const now = 20_000 * LEDGER_DAY_MS + 3_600_000;
const day = 20_000;

test('node kind names follow NodeKind, then the season tiers', () => {
  assert.deepEqual(NODE_KIND_NAMES.slice(0, 4), ['berry', 'driftwood', 'tide_rock', 'obsidian']);
  for (const def of TIER_NODES) assert.equal(nodeKindOf(def.key), def.kind);
  assert.equal(nodeKindOf('honey_hive'), NodeKind.HoneyHive);
  assert.equal(nodeKindOf('nope'), -1);
  assert.ok(NODE_KIND_NAMES.every(name => name.length <= 16));
});

test('tier nodes show their skill, level, XP and whether you can work them', () => {
  const hive = TIER_NODES.find(d => d.key === 'honey_hive')!;
  assert.deepEqual(nodeLevelInfo(hive.kind, [14, 1, 1]), { skill: 'foraging', minLevel: 15, xp: hive.xp, locked: true });
  assert.equal(nodeLevelInfo(hive.kind, [15, 1, 1]).locked, false);
  const star = TIER_NODES.find(d => d.key === 'fallen_star')!;
  assert.deepEqual(nodeLevelInfo(star.kind, [99, 79, 1]), { skill: 'beachcombing', minLevel: 80, xp: star.xp, locked: true });
  assert.equal(nodeLockReason(star.kind, [99, 79, 1]), 'Needs Beachcombing level 80');
  assert.equal(nodeLockReason(NodeKind.Berry, [1, 1, 1]), null);
  assert.equal(nodeLevelInfo(NodeKind.Driftwood, [1, 1, 1]).locked, false);
  const kinds = describeNodeKinds([1, 1, 1]);
  assert.equal(kinds.length, NODE_KIND_NAMES.length);
  const glow = kinds.find(k => k.kind === 'glowcap_ring')!;
  assert.equal(glow.tier, 2);
  assert.equal(glow.gives?.itemId, 'glowcap');
  assert.deepEqual(glow.biomes, ['hearthvale', 'glimmerfen']);
});

test('the ledger reads today\'s done bits from your frontier_view row only', () => {
  const views = [
    { kind: 'ledger', source: `ledger:${'c'.repeat(64)}`, data: JSON.stringify({ id: 'x', day, done: 7 }) },
    { kind: 'ledger', source: `ledger:${identity}`, data: JSON.stringify({ id: identity, day, done: 2 }) },
  ];
  assert.deepEqual(ledgerStateOf(views, identity), { day, done: 2 });
  assert.equal(ledgerStateOf([{ kind: 'ledger', source: `ledger:${identity}`, data: '{' }], identity), undefined);

  const levels = [20, 20, 20];
  const expected = ledgerFor(identity, day, levels);
  const slots = emptySlots();
  slots[0] = { itemId: expected[0].itemId, quantity: expected[0].quantity };
  const ledger = describeLedger({ identity, levels, views, slots, self: { ...LEDGER_CLERK }, now });
  assert.equal(ledger.day, day);
  assert.equal(ledger.resetsInSeconds, (LEDGER_DAY_MS - 3_600_000) / 1000);
  assert.equal(ledger.nearClerk, true);
  assert.deepEqual(ledger.commissions.map(c => c.itemId), expected.map(c => c.itemId));
  assert.deepEqual(ledger.commissions.map(c => c.done), [false, true, false]);
  assert.equal(ledger.commissions[0].ready, true);
  assert.equal(ledger.commissions[0].have, expected[0].quantity);
  assert.equal(ledger.finished, 1);

  assert.equal(deliveryProblem(ledger, 0), null);
  assert.equal(deliveryProblem(ledger, 1)?.code, 'commission_done');
  assert.equal(deliveryProblem(ledger, 2)?.code, 'commission_items');

  // A row from an earlier day counts as nothing done; far from the clerk you are not near it.
  const stale = describeLedger({ identity, levels, views: [{ kind: 'ledger', source: `ledger:${identity}`, data: JSON.stringify({ day: day - 1, done: 7 }) }], slots, self: { x: 0, z: 0 }, now });
  assert.equal(stale.finished, 0);
  assert.equal(stale.nearClerk, false);
});

test('level refusals map to level_required with the server text', () => {
  assert.deepEqual(levelError(new Error('SenderError: Needs Foraging level 30')), { status: 422, code: 'level_required', message: 'Needs Foraging level 30' });
  assert.equal(levelError(new Error('Needs Crafting level 85'))?.message, 'Needs Crafting level 85');
  assert.equal(levelError(new Error('Too far away')), null);
});

test('the MCP summary keeps the ledger and flags locked nearby nodes', () => {
  const summary = summarizeState({
    player: { id: identity, tile: { x: 10, z: 10 } },
    nodes: [{ id: 1000, kind: 'honey_hive', name: 'Wild honey hive', tile: { x: 11, z: 10 }, gives: { itemId: 'honeycomb' }, ready: true, skill: 'foraging', minLevel: 15, xp: 14, locked: true }],
    ledger: { resetsInSeconds: 5, nearClerk: false, clerk: { x: 35, z: 37 }, commissions: [{ slot: 0, itemId: 'flint', quantity: 12, have: 0, skill: 'beachcombing', xp: 240, done: false, ready: false, name: 'Flint' }] },
  });
  assert.deepEqual((summary.nearby.nodes[0] as any).locked, true);
  assert.equal((summary.nearby.nodes[0] as any).minLevel, 15);
  assert.deepEqual((summary.ledger as any).commissions[0], { slot: 0, itemId: 'flint', quantity: 12, have: 0, skill: 'beachcombing', xp: 240, done: false, ready: false });
});

test('biomeAt names the biome of island and mainland tiles', async () => {
  const { biomeAt } = await import('./worldAtlas');
  assert.equal(biomeAt({ x: 25, z: 25 }), 'isle');
  assert.equal(biomeAt({ x: 172, z: 124 }), 'hearthvale');
  assert.equal(biomeAt({ x: 196, z: 220 }), 'starfall');
});
