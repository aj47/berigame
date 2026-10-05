import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homePoint, homeTarget, MEADOW_OFFSET } from '../../shared/sim/frontier/homeMap';
import { frontierSnapshot } from '../../shared/sim/frontier/snapshot';
import { newProfile } from '../../shared/sim/frontier/model';
import { describeDestination, describeGathering, describeObjective } from './statePresentation';

const identity = 'a'.repeat(64);
const now = 100_000;
const publicRow = (kind: string, value: unknown) => ({ kind, data: JSON.stringify(value) });
const config = publicRow('config', { enabled: true });
const state = () => frontierSnapshot([config], [], identity, now);

test('cross-district destinations decode into reusable region-local coordinates in both directions', () => {
  const outward = homeTarget(homePoint({ x: 31, z: 64 }, 'settlement'));
  // The tagged internal coordinate (256 + joined-frame x) seen in playtests.
  assert.equal(outward.x, 256 + MEADOW_OFFSET.x + 31);
  assert.deepEqual(describeDestination({ region: 'bramblewild', targetX: outward.x, targetZ: outward.z }),
    { region: 'settlement', x: 31, z: 64 });
  const inward = homeTarget(homePoint({ x: 46, z: 25 }, 'bramblewild'));
  assert.deepEqual(describeDestination({ region: 'settlement', targetX: inward.x, targetZ: inward.z }),
    { region: 'bramblewild', x: 46, z: 25 });
  assert.deepEqual(describeDestination({ region: 'reedwake', targetX: 20, targetZ: 40 }),
    { region: 'reedwake', x: 20, z: 40 });
  assert.equal(describeDestination({ region: 'settlement' }), null);
  assert.equal(describeDestination({ targetX: 2 }), null);
  assert.deepEqual(describeDestination({ targetX: 0, targetZ: 0 }), { region: 'bramblewild', x: 0, z: 0 });
});

test('a reserved resource remains visible through its deadline until server completion or cancellation', () => {
  const resource = { id: 'settlement-stone', region: 'settlement', x: 32, z: 56, item: 'stone',
    harvest: { by: identity, startedAt: now, completesAt: now + 3000, origin: { x: 31, z: 56 }, hp: 20, tool: 'hands', quantity: 1 } };
  const frontier = frontierSnapshot([config, publicRow('resource', resource)], [], identity, now);
  assert.deepEqual(describeGathering(frontier, identity, now + 1000), {
    resourceId: 'settlement-stone', itemId: 'stone', region: 'settlement', tile: { x: 32, z: 56 },
    tool: 'hands', quantity: 1, startedAt: now, completesAt: now + 3000, remainingMs: 2000,
  });
  assert.equal(describeGathering(frontier, identity, now + 4000)?.remainingMs, 0);
  assert.equal(describeGathering(frontier, 'another-player', now), null);
  assert.equal(describeGathering(state(), identity, now), null);
  assert.equal(describeGathering({ ...frontier, enabled: false }, identity, now), null);
});

test('the next objective follows the active region and advances after the steward reward', () => {
  const frontier = state();
  const goal = { id: 'find-stick' as const, text: 'Gather for a sturdy stick', hint: 'Pick berries', action: null };
  assert.deepEqual(describeObjective('bramblewild', goal, frontier), { source: 'first_day', region: 'bramblewild', ...goal });
  assert.equal(describeObjective('bramblewild', null, frontier), null);
  assert.equal(describeObjective('settlement', null, frontier)?.id, 'steward');
  const profile = newProfile(identity);
  profile.quests = ['steward'];
  profile.events['gather:timber'] = 2;
  const progress = frontierSnapshot([config], [publicRow('profile', profile)], identity, now);
  const next = describeObjective('settlement', null, progress);
  assert.ok(next?.source === 'frontier_quest');
  assert.equal(next.id, 'supplies');
  assert.equal(next.progress, 2);
  assert.equal(next.required, 6);
  assert.equal(next.coins, 15);
  assert.equal(describeObjective('settlement', null, { ...frontier, enabled: false }), null);
  assert.equal(describeObjective('cinder', null, { ...frontier, quests: [] }), null);
});
