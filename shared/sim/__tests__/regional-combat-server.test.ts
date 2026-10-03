import { describe, expect, it, vi } from 'vitest';
import { adventureTables, testTable } from './adventureHarness';
import { EventKind, Pending } from '../types';
import { newProfile } from '../frontier/model';
import { PLOTS, REGIONS, WEEK } from '../frontier/catalog';
import { regionalPvPProblem } from '../frontier/combat';
vi.mock('../../../spacetimedb/node_modules/spacetimedb/dist/server/index.mjs', () => ({
  t: new Proxy({}, { get: () => () => ({}) }), SenderError: class SenderError extends Error {},
}));
vi.mock('../../../spacetimedb/src/schema', () => ({ default: { reducer: (...args: unknown[]) => args.at(-1) } }));
import { attack, follow } from '../../../spacetimedb/src/reducers/combat';
import { cancel } from '../../../spacetimedb/src/reducers/movement';
import { requestTrade } from '../../../spacetimedb/src/reducers/trade';
import { frontierAction } from '../../../spacetimedb/src/reducers/frontier';
import { frontierRepository, tickFrontier } from '../../../spacetimedb/src/lib/frontier';

function fixture() {
  const identities = [1, 2].map(n => ({ toHexString: () => n.toString().padStart(64, '0') }));
  const db = { ...adventureTables(), player: testTable('identity'), inventorySlot: testTable('id', true),
    accessPolicy: testTable(), playerGrant: testTable('identity'), world: testTable(), tree: testTable(),
    combatEvent: testTable('id', true), socialEvent: testTable('id', true), socialPair: testTable('pair'), trade: testTable('id', true) };
  db.accessPolicy.insert({ id: 0, owner: identities[0], requireAdmission: false });
  db.world.insert({ id: 0, tick: 10 });
  for (const [i, identity] of identities.entries()) db.player.insert({ identity, name: `Player ${i + 1}`, region: 'settlement', online: true,
    state: 0, x: 20 + i * 8, z: 50, hp: 30, maxHp: 30, weapon: '', hostile: false,
    facing: 0, lastInputTick: 0, inputsThisTick: 0, harvestTreeId: 0, pending: 0, nextSwingTick: 0, respawnTick: 0 });
  const ctx: any = { db, sender: identities[0], timestamp: { microsSinceUnixEpoch: 1_000_000_000n } };
  const repo = frontierRepository(ctx);
  repo.put('config', { id: 'world', enabled: true, pausedAt: 0, sequence: 0 });
  for (const identity of identities) repo.put('profile', newProfile(identity.toHexString()));
  const player = (n = 0) => db.player.identity.find(identities[n]);
  const move = (n: number, patch: object) => db.player.identity.update({ ...player(n), ...patch });
  const tick = () => { ctx.timestamp.microsSinceUnixEpoch += 600_000n; db.world.id.update({ id: 0, tick: db.world.id.find(0).tick + 1 }); tickFrontier(ctx); };
  const hits = () => [...db.combatEvent.iter()].filter(e => e.kind === EventKind.Hit);
  const start = () => (attack as any)(ctx, { target: identities[1] });
  return { db, ctx, repo, player, move, tick, hits, start, identities };
}

describe('regional player interactions', () => {
  it('approaches the moving player by identity, attacks on arrival, and keeps swinging with feedback', () => {
    const h = fixture(); h.start(); h.tick();
    expect(h.player().x).toBe(22); expect(h.hits()).toHaveLength(0);
    h.move(1, { x: 30, z: 52 });
    for (let i = 0; i < 4; i++) h.tick();
    expect(h.hits()).toHaveLength(1);
    expect(h.player(1).hp).toBe(27);
    expect(Math.max(Math.abs(h.player().x - 30), Math.abs(h.player().z - 52))).toBe(1);
    expect(h.player().nextSwingTick).toBe(h.hits()[0].tick + 4);
    while (h.db.world.id.find(0).tick < h.player().nextSwingTick - 1) h.tick();
    expect(h.hits()).toHaveLength(1); h.tick(); expect(h.hits()).toHaveLength(2);
  });

  it('preserves food recovery and an existing swing across reselection/cancel/restart', () => {
    const h = fixture(); h.move(1, { x: 21 });
    const p = h.repo.get('profile', h.identities[0].toHexString())!;
    p.nextAttack = 1_001_800; h.repo.put('profile', p);
    h.start(); h.tick(); h.start(); h.tick(); expect(h.hits()).toHaveLength(0);
    h.tick(); expect(h.hits()).toHaveLength(1);
    (cancel as any)(h.ctx); h.start(); h.tick(); h.tick(); h.tick();
    expect(h.hits()).toHaveLength(1); h.tick(); expect(h.hits()).toHaveLength(2);
    (cancel as any)(h.ctx); h.tick();
    expect(h.player().combatTarget).toBeUndefined(); expect(h.hits()).toHaveLength(2);
  });

  it.each([{ online: false }, { state: 1 }, { region: 'reedwake' }, { region: '' }])('stops when target becomes unavailable: %j', change => {
    const h = fixture(); h.start(); h.move(1, change); h.tick();
    expect(h.player().combatTarget).toBeUndefined(); expect(h.player().hostile).toBe(false);
    expect(h.hits()).toHaveLength(0); expect([...h.db.socialEvent.iter()]).toHaveLength(1);
    h.tick(); expect([...h.db.socialEvent.iter()]).toHaveLength(1);
  });

  it('rejects town, paid-home, capability-disabled and self attacks without weakening contests', () => {
    const h = fixture(); h.move(1, REGIONS.settlement.spawn);
    expect(h.start).toThrow('No fighting in Meadows town');
    const plot = PLOTS[0]; h.move(1, { x: plot.x + 2, z: plot.z + 2 });
    h.repo.put('claim', { id: plot.id, owner: h.identities[1].toHexString(), tier: 0, paidUntil: 1_000_000 + WEEK, cooldownUntil: 0, permissions: {} });
    expect(h.start).toThrow('Paid homes');
    h.move(1, { x: 28, z: 50 });
    h.db.playerGrant.insert({ identity: h.identities[1], issuer: h.identities[0], expiresAtMicros: 9_000_000_000n, combat: false, agent: false });
    expect(h.start).toThrow('Combat is not enabled');
    expect(() => (attack as any)(h.ctx, { target: h.identities[0] })).toThrow('yourself');
    const a = { id: 'a', region: plot.region, ...plot.marker, online: true, alive: true, combat: false };
    const b = { ...a, id: 'b', x: a.x - 1 };
    expect(regionalPvPProblem(a, b, [{ id: plot.id, owner: 'b', tier: 0, paidUntil: 0, cooldownUntil: 0, permissions: {},
      challenge: { by: 'a', opens: 1, closes: 100, heldSince: 0, deposit: 0, attackers: ['a'], defenders: ['b'] } }], 50)).toBeNull();
    expect(regionalPvPProblem({ ...a, combat: undefined }, { ...b, combat: undefined }, [], 50)).toBeNull();
  });

  it('stops an accepted chase if the target enters town or a home becomes protected', () => {
    const h = fixture(); h.start(); h.move(1, REGIONS.settlement.spawn); h.tick();
    expect(h.player().combatTarget).toBeUndefined(); expect(h.hits()).toHaveLength(0);
    const plot = PLOTS[0]; h.move(0, { x: plot.x + 1, z: plot.z + 1 }); h.move(1, { x: plot.x + 2, z: plot.z + 1 }); h.start();
    h.repo.put('claim', { id: plot.id, owner: 'someone', tier: 0, paidUntil: 1_000_000 + WEEK, cooldownUntil: 0, permissions: {} });
    h.tick(); expect(h.player().combatTarget).toBeUndefined(); expect(h.hits()).toHaveLength(0);
  });

  it('routes around a wall instead of hitting through it and stops at an enclosed target', () => {
    const h = fixture(); h.move(1, { x: 21 });
    h.repo.put('building', { id: 'wall', claim: PLOTS[0].id, region: 'settlement', x: 20, z: 50, rotation: 1, piece: 'wall', edge: true, label: '' });
    h.start(); h.tick(); expect(h.hits()).toHaveLength(1);
    expect(h.player().z).not.toBe(50); // Reached the target around the end of the wall.
    (cancel as any)(h.ctx); h.move(0, { x: 20, z: 50 });
    for (let rotation = 0; rotation < 4; rotation++) h.repo.put('building', {
      id: `box-${rotation}`, claim: PLOTS[0].id, region: 'settlement', x: 21, z: 50, rotation, piece: 'wall', edge: true, label: '',
    });
    h.start(); h.tick(); expect(h.player().combatTarget).toBeUndefined(); expect(h.hits()).toHaveLength(1);
    expect([...h.db.socialEvent.iter()].at(-1).text).toContain('obstacle or closed gate');
  });

  it('follows without damage, and walks into range before sending a trade request', () => {
    const h = fixture(); (follow as any)(h.ctx, { target: h.identities[1] }); h.tick();
    expect(h.player().x).toBe(22); expect(h.player().hostile).toBe(false);
    for (let i = 0; i < 5; i++) h.tick();
    expect(h.hits()).toHaveLength(0); expect(h.player().combatTarget).toBeDefined();
    h.move(1, { x: 40 }); (requestTrade as any)(h.ctx, { target: h.identities[1] });
    expect(h.player().pending).toBe(Pending.Trade); expect([...h.db.trade.iter()]).toHaveLength(0);
    for (let i = 0; i < 8; i++) h.tick();
    expect([...h.db.trade.iter()]).toHaveLength(1); expect(h.player().combatTarget).toBeUndefined();
  });

  it('ends both intents at defeat, drops regional inventory once, and preserves legacy single-hit API', () => {
    const h = fixture(); h.move(1, { x: 21, hp: 3, combatTarget: h.identities[0], hostile: true }); h.start(); h.tick();
    expect(h.player(1).state).toBe(1); expect(h.player().combatTarget).toBeUndefined(); expect(h.player(1).combatTarget).toBeUndefined();
    expect([...h.db.combatEvent.iter()].map(e => e.kind)).toEqual([EventKind.Hit, EventKind.Death]);
    expect([...h.db.frontierObject.kind.filter('drop')]).toHaveLength(1);
    h.tick(); expect(h.hits()).toHaveLength(1);
    const legacy = fixture(); legacy.move(1, { x: 21 });
    (frontierAction as any)(legacy.ctx, { command: JSON.stringify({ action: 'attack', id: legacy.identities[1].toHexString() }) });
    expect(legacy.player(1).hp).toBe(27); expect(legacy.player().combatTarget).toBeUndefined();
    for (let i = 0; i < 5; i++) legacy.tick(); expect(legacy.player(1).hp).toBe(27);
  });

  it('keeps Bramblewild attacks on the original engine and rejects legacy-region targets from Meadows', () => {
    const h = fixture(); h.move(0, { region: 'bramblewild', x: 40, z: 20 }); h.move(1, { region: '', x: 41, z: 20 });
    h.start(); const initial = h.player().nextSwingTick; h.tick();
    expect(h.player(1).hp).toBe(30); expect(h.player().nextSwingTick).toBe(initial); expect(h.player().combatTarget).toBeDefined();
    h.move(0, { region: 'settlement' }); expect(h.start).toThrow('target unavailable');
  });
});
