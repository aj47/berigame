import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import GameWebMCPTools from '../agent/GameWebMCPTools';
import { homePoint, homeTarget } from '../../../shared/sim/frontier/homeMap';

const mock = vi.hoisted(() => ({ player: null as any, rows: [] as any[], tools: new Map<string, any>() }));
vi.mock('../frontier/recovery', () => ({ exportRecovery: vi.fn() }));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({}) }));
vi.mock('../spacetime/hooks', () => ({
  ...Object.fromEntries(['useAdventureProfiles', 'useExpeditions', 'useExpeditionMembers', 'useFriendlyDuels',
    'useIslandProjects', 'useGardenShowcases', 'useTradeRows', 'useFrontierViews', 'useInventoryRows', 'useGiants']
    .map(name => [name, () => []])),
  useFrontierObjects: () => mock.rows,
  useMyPlayer: () => mock.player,
  usePlayers: () => [mock.player],
  useTrees: () => [{ id: 1, kind: 0, x: 27, z: 25, itemId: 'berry_greenberry', cooldownUntilTick: 0 }],
  useMySkills: () => ({ foragingXp: 0 }),
  useTick: () => 100,
  useGiantRaid: () => null,
}));
vi.mock('../store', () => ({ useLoadingStore: (pick: any) => pick({ websocketConnected: true, gameDataLoaded: true, worldUpdatesStalled: false }) }));
vi.mock('../spacetime/stores/firstDayStore', () => ({ useFirstDayStore: { getState: () => ({ done: [], seen: {} }) } }));
const row = (kind: string, data: unknown) => ({ kind, data: JSON.stringify(data) });
const id = 'a'.repeat(64);
beforeEach(() => {
  mock.tools.clear();
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
