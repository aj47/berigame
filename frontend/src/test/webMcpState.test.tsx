import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import GameWebMCPTools from '../agent/GameWebMCPTools';
import { homePoint, homeTarget } from '../../../shared/sim/frontier/homeMap';
import { BOSS_CONFIG_DEFAULTS, ClatterState, SPIRE_NONE, SPIRE_RULES_VERSION, SpireMemberState, SpireStage, freshClatterhorn } from '../../../shared/sim';
import { useBossStore } from '../bosses/bossStore';

const mock = vi.hoisted(() => ({ player: null as any, others: [] as any[], rows: [] as any[], tools: new Map<string, any>(), actions: {} as Record<string, any>, inventory: [] as any[] }));
vi.mock('../frontier/recovery', () => ({ exportRecovery: vi.fn() }));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => mock.actions }));
vi.mock('../spacetime/hooks', () => ({
  ...Object.fromEntries(['useAdventureProfiles', 'useExpeditions', 'useExpeditionMembers', 'useFriendlyDuels',
    'useIslandProjects', 'useGardenShowcases', 'useTradeRows', 'useFrontierViews', 'useGiants']
    .map(name => [name, () => []])),
  useFrontierObjects: () => mock.rows,
  useMyPlayer: () => mock.player,
  usePlayers: () => [mock.player, ...mock.others],
  useInventoryRows: () => mock.inventory,
  useTrees: () => [{ id: 1, kind: 0, x: 27, z: 25, itemId: 'berry_greenberry', cooldownUntilTick: 0 }],
  useMySkills: () => ({ foragingXp: 0 }),
  useMyCosmetics: () => null,
  useGroundItems: () => [],
  useTick: () => 100,
  useGiantRaid: () => null,
}));
vi.mock('../store', () => ({ useLoadingStore: (pick: any) => pick({ websocketConnected: true, gameDataLoaded: true, worldUpdatesStalled: false }) }));
vi.mock('../spacetime/stores/firstDayStore', () => ({ useFirstDayStore: { getState: () => ({ done: [], seen: {} }) } }));
const row = (kind: string, data: unknown) => ({ kind, data: JSON.stringify(data) });
const id = 'a'.repeat(64);
beforeEach(() => {
  mock.tools.clear();
  mock.others = []; mock.inventory = []; mock.actions = {};
  useBossStore.getState().reset();
  mock.player = { identity: { toHexString: () => id }, name: 'Inspector', x: 33, z: 52, region: 'settlement',
    hp: 20, maxHp: 30, weapon: '', state: 0, pending: 0, pendingId: 0n, harvestEndTick: 0,
    harvestTreeId: 0, respawnTick: 0, lastInputTick: 0, online: true };
  mock.rows = [row('config', { enabled: true })];
  Object.defineProperty(document, 'modelContext', { configurable: true, value: {
    registerTool: (tool: any) => { mock.tools.set(tool.name, tool); },
  } });
});
afterEach(() => { cleanup(); delete (document as any).modelContext; });
async function setup() {
  const onStatusChange = vi.fn();
  const ui = render(<GameWebMCPTools onStatusChange={onStatusChange} />);
  await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith('ready'));
  return { ...ui, inspect: () => JSON.parse(mock.tools.get('inspect_game_state').execute({})),
    refresh: () => ui.rerender(<GameWebMCPTools onStatusChange={onStatusChange} />) };
}

it('WebMCP reports live chopping and Meadows objective instead of the island tutorial', async () => {
  const now = Date.now();
  mock.rows.push(row('resource', { id: 'settlement-timber', region: 'settlement', x: 33, z: 52, item: 'timber',
    harvest: { by: id, startedAt: now, completesAt: now + 3000, tool: 'axe', quantity: 2 } }));
  const ui = await setup();
  const state = ui.inspect();
  expect(state.goal).toBeNull();
  expect(state.objective).toMatchObject({ source: 'frontier_quest', id: 'steward' });
  expect(state.player).toMatchObject({ action: 'chopping', destination: null, gathering: {
    resourceId: 'settlement-timber', tool: 'axe', quantity: 2, completesAt: now + 3000,
  } });
  expect(state.world.map).toBeNull();
  expect(state.berryTrees).toEqual([]);
  mock.rows = [row('config', { enabled: true })];
  ui.refresh();
  expect(ui.inspect().player).toMatchObject({ action: 'idle', gathering: null });
});

it('WebMCP exposes movement and decoded local destinations across the connected home map', async () => {
  mock.player.region = 'bramblewild'; mock.player.x = 46; mock.player.z = 25;
  const target = homeTarget(homePoint({ x: 31, z: 64 }, 'settlement'));
  mock.player.targetX = target.x; mock.player.targetZ = target.z;
  const ui = await setup();
  const state = ui.inspect();
  expect(state.player).toMatchObject({ action: 'moving', destination: { region: 'settlement', x: 31, z: 64 } });
  expect(state.world.map).not.toBeNull();
  expect(state.goal).not.toBeNull();
  expect(state.objective).toMatchObject({ source: 'first_day', region: 'bramblewild', id: state.goal.id });
});

const hexOf = (i: number) => i.toString(16).padStart(64, '0');
const ident = (hex: string) => ({ toHexString: () => hex });
const playerAt = (i: number, x: number, z: number) => ({ identity: ident(hexOf(i)), name: `P${i}`, x, z, region: 'bramblewild', hp: 30, maxHp: 30,
  weapon: '', state: 0, pending: 0, pendingId: 0n, online: true, eatCooldownUntilTick: 0 });
function bossWorld(meOnFloor: boolean) {
  mock.player.region = 'bramblewild';
  Object.assign(mock.player, meOnFloor ? { x: 74, z: 60 } : { x: 62, z: 47 });
  mock.others = [playerAt(2, 75, 61), playerAt(3, 80, 66), playerAt(4, 63, 46)];
  mock.inventory = [{ slot: 4, itemId: 'spire_key', quantity: 2 }];
  const store = useBossStore.getState();
  store.setMe(id);
  store.setRow('bossConfig', { id: 0, ...BOSS_CONFIG_DEFAULTS, clatterhornOpen: true, spireOpen: true } as any);
  store.setRow('clatterhorn', { id: 1, ...freshClatterhorn(BOSS_CONFIG_DEFAULTS), state: ClatterState.Dormant } as any);
  const run = (runId: bigint, stage: number) => ({ id: runId, leader: ident(id), stage, outcome: 0, mode: 0, isPublic: true, rules: SPIRE_RULES_VERSION,
    partySize: 2, createdTick: 50, queuedTick: 0, startTick: 90, endTick: 690, phase: 1, clearTicks: 0 });
  const member = (hex: string, runId: bigint, slot: number) => ({ identity: ident(hex), runId, slot, state: SpireMemberState.In, joinedTick: 50,
    awaySinceTick: 0, awayCount: 0, downUntilTick: 0, reviveSinceTick: 0, meals: 0 });
  store.setRow('spireRun', run(41n, SpireStage.Active) as any);
  store.setRow('spireRun', run(42n, SpireStage.Active) as any);
  if (meOnFloor) store.setRow('spireMember', member(id, 41n, 0) as any);
  store.setRow('spireMember', member(hexOf(2), 41n, 1) as any);
  store.setRow('spireMember', member(hexOf(3), 42n, 0) as any);
  store.setRow('spireFight', { runId: 41n, hp: 1700, maxHp: 1700, phase: 1, seed: 7, patternCount: 1, curKind: 0, curStart: 95, curSeed: 3, curAimX: 0, curAimZ: 0,
    prevKind: SPIRE_NONE, prevStart: 0, prevSeed: 0, prevAimX: 0, prevAimZ: 0, starWave: 0, starMask: 0,
    hitTick0: 0, hitTick1: 0, hitTick2: 0, hitTick3: 0, hits0: 0, hits1: 0, hits2: 0, hits3: 0, stars0: 0, stars1: 0, stars2: 0, stars3: 0,
    dmg0: 0, dmg1: 0, dmg2: 0, dmg3: 0, downs0: 0, downs1: 0, downs2: 0, downs3: 0 } as any);
}

it('WebMCP adds the boss blocks and hides floor players from an overworld viewer', async () => {
  bossWorld(false);
  useBossStore.getState().pushNotice({ tick: 99, boss: 1, kind: 0, player: ident(id), runId: 0n, amount: 6, total: 20, hp: 0, half: 0, quantity: 0, itemId: '', x: 0, z: 0 } as any);
  const ui = await setup();
  const state = ui.inspect();
  expect(state.clatterhorn).toMatchObject({ open: true, state: 'dormant', tile: { x: 84, z: 106 }, you: { contribution: 20, qualified: true } });
  expect(state.spire).toMatchObject({ open: true, atGate: true, key: { held: 2 }, capacity: { active: 2, inside: 2 }, you: null, run: null });
  expect(state.onlinePlayers.map((p: any) => p.name)).toEqual(['Inspector', 'P4']);
  expect(state.world.map).not.toBeNull();
});

it('WebMCP inside the Spire: slim state, only your run, and the danger feed', async () => {
  bossWorld(true);
  Object.assign(mock.player, { x: 71, z: 63 }); // hit-free at tick + 1 in this pattern
  const ui = await setup();
  const state = ui.inspect();
  expect(state.onlinePlayers.map((p: any) => p.name)).toEqual(['Inspector', 'P2']);
  expect(state.world.map).toBeNull();
  expect(state.berryTrees).toEqual([]);
  expect(state.goal).toBeNull();
  expect(state.spire.run).toMatchObject({ runId: '41', stage: 'active' });
  const feed = JSON.parse(mock.tools.get('inspect_danger').execute({}));
  expect(feed).toMatchObject({ v: 1, tick: 100, where: 'spire', you: { x: 71, z: 63, state: 'in' }, grid: { x0: 70, z0: 55, w: 15, h: 15 } });
  expect(feed.moves.length).toBeGreaterThan(0);
  expect(feed.best).toEqual({ to: feed.moves[0].to, via: feed.moves[0].via });
  expect(feed.party.map((p: any) => p.name)).toEqual(['P2']);
});

it('WebMCP boss actions reach the game actions with the HTTP checks', async () => {
  bossWorld(true);
  const calls: unknown[][] = [];
  const ok = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); return Promise.resolve(true); };
  mock.actions = { attackClatterhorn: ok('attackClatterhorn'), spireOpen: ok('spireOpen'), spireJoin: ok('spireJoin'), spireStart: ok('spireStart'),
    spireLeave: ok('spireLeave'), setTarget: ok('setTarget') };
  await setup();
  const run = (name: string, input: object) => mock.tools.get(name).execute(input);
  expect(await run('spire_party', { op: 'open', runId: '4' })).toMatch(/Only join takes a runId/);
  await run('spire_party', { op: 'open' });
  await run('spire_party', { op: 'join', runId: '41' });
  await run('spire_party', { op: 'join' });
  await run('spire_party', { op: 'start' });
  await run('spire_party', { op: 'leave' });
  await run('attack_clatterhorn', {});
  expect(await run('dodge_to_tile', { x: 77, z: 60 })).toMatch(/dodge_too_far/);
  expect(await run('dodge_to_tile', { x: 76, z: 61 })).toMatch(/dodge_target/);
  expect(await run('dodge_to_tile', { x: 75, z: 58 })).toMatch(/Dodging to 75, 58/);
  expect(await run('move_to_tile', { x: 30, z: 30 })).toMatch(/only through the Spire Gate/);
  expect(calls).toEqual([['spireOpen'], ['spireJoin', 41n], ['spireJoin', 0n], ['spireStart'], ['spireLeave'], ['attackClatterhorn'],
    ['setTarget', 75, 58], ['setTarget', 30, 30]]);
});
