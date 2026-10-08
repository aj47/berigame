import React from 'react';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerState } from '@sim';
import PlayerAvatar from '../Components/3D/PlayerAvatar';
import { usePlayers } from '../spacetime/hooks';
import { avatarFrontierState } from '../frontier/avatarFrontierState';
import { useSettingsStore } from '../spacetime/stores/settingsStore';
import { PLOTS } from '../../../shared/sim/frontier/catalog';

const mock = vi.hoisted(() => ({ connection: null as any, identity: { __identity__: 1n, toHexString: () => 'me' }, labels: vi.fn(), attack: vi.fn() }));
vi.mock('spacetimedb/react', () => ({ useSpacetimeDB: () => ({ identity: mock.identity, getConnection: () => mock.connection }) }));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({ attack: mock.attack }) }));
vi.mock('../hooks/useTileMotion', () => ({ useTileMotion: () => React.useRef({}) }));
vi.mock('../Components/3D/AdventurerModel', () => ({ default: () => null, BASE_MODEL_URL: 'avatar', modelUrl: () => 'avatar' }));
vi.mock('../Components/3D/AvatarDecals', () => ({ useAvatarDecal: () => {} }));
vi.mock('../Components/3D/AvatarOverlay', () => ({ useAvatarLabels: (_: any, labels: any) => mock.labels(labels.id) }));
vi.mock('@react-three/drei', () => ({ Html: () => null }));

function table(initial: any[] = []) {
  let rows = initial;
  const inserted = new Set<Function>(), deleted = new Set<Function>(), updated = new Set<Function>();
  return {
    iter: vi.fn(() => rows.values()),
    onInsert: (cb: Function) => inserted.add(cb), removeOnInsert: (cb: Function) => inserted.delete(cb),
    onDelete: (cb: Function) => deleted.add(cb), removeOnDelete: (cb: Function) => deleted.delete(cb),
    onUpdate: (cb: Function) => updated.add(cb), removeOnUpdate: (cb: Function) => updated.delete(cb),
    change(next: any[], id: string, count = 1) {
      rows = next; // The SDK commits the full transaction before dispatching its row callbacks.
      for (let i = 0; i < count; i++) for (const cb of updated) cb({ event: { id } });
    },
  };
}
const identity = (id: number) => ({ __identity__: BigInt(id), toHexString: () => id === 1 ? 'me' : `player-${id}` });
const player = (id: number, patch = {}) => ({
  identity: identity(id), name: `Player ${id}`, online: true, state: PlayerState.Alive,
  x: 35, z: 25, region: 'bramblewild', respawnTick: 0, hp: 30, maxHp: 30,
  facing: 0, weapon: '', hostile: false, pending: 0, ...patch,
}) as any;
let me: any;
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {}); // React DOM receives the mocked R3F host elements.
  me = player(1);
  mock.connection = { db: {
    player: table([me]), world: table([{ tick: 100 }]), expedition: table(), playerCosmetic: table(), frontierObject: table(),
  } };
  useSettingsStore.setState({ oneClickAttack: true });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('crowd update isolation', () => {
  it('reads a changed table once when one transaction updates many rows', () => {
    renderHook(usePlayers);
    const players = mock.connection.db.player;
    players.iter.mockClear();
    act(() => players.change([me, player(2), player(3)], 'raid-tick', 3));
    expect(players.iter).toHaveBeenCalledOnce();
  });

  it('does not rerender 32 unchanged raid avatars on a tick or the local player taking damage', () => {
    const crowd = Array.from({ length: 32 }, (_, i) => player(i + 2));
    render(<>{crowd.map(row => <PlayerAvatar key={row.name} row={row} isSelf={false} />)}</>);
    mock.labels.mockClear();
    act(() => mock.connection.db.world.change([{ tick: 101 }], 'next-tick'));
    act(() => mock.connection.db.player.change([{ ...me, hp: 20 }], 'giant-slam'));
    expect(mock.labels).not.toHaveBeenCalled();
    // A real protection-rule change still updates every affected hover/click target.
    act(() => mock.connection.db.player.change([{ ...me, x: 25 }], 'enter-safe-ring'));
    expect(mock.labels).toHaveBeenCalledTimes(crowd.length);
  });

  it('refreshes an attack target exactly when respawn protection expires', () => {
    const ui = render(<PlayerAvatar row={player(2, { respawnTick: 100 })} isSelf={false} />);
    const props = () => {
      const group = ui.container.querySelector('group') as any;
      return group[Object.keys(group).find(key => key.startsWith('__reactProps$'))!];
    };
    expect(props().userData.hoverTarget.action).toBe('Click for player actions');
    mock.labels.mockClear();
    act(() => mock.connection.db.world.change([{ tick: 109 }], 'still-protected'));
    expect(mock.labels).not.toHaveBeenCalled();
    act(() => mock.connection.db.world.change([{ tick: 110 }], 'protection-ended'));
    expect(props().userData.hoverTarget.action).toBe('Click to attack');
    expect(mock.labels).toHaveBeenCalledOnce();
  });

  it('parses each resource once for the crowd and ignores unrelated wildlife updates', () => {
    const resources = Array.from({ length: 40 }, (_, i) => ({ kind: 'resource', data: JSON.stringify({ id: `resource-${i}`, harvest: i === 0 ? { by: 'player-2', startedAt: 1, completesAt: 2 } : undefined }) }));
    const wildlife = { kind: 'creature', data: '{"id":"moth","x":1}' };
    mock.connection.db.frontierObject = table([...resources, wildlife]);
    const parse = vi.spyOn(JSON, 'parse');
    const crowd = Array.from({ length: 32 }, (_, i) => player(i + 2));
    render(<>{crowd.map(row => <PlayerAvatar key={row.name} row={row} isSelf={false} />)}</>);
    expect(parse.mock.calls.filter(([data]) => data.startsWith('{"id":"resource-'))).toHaveLength(resources.length);
    parse.mockClear(); mock.labels.mockClear();
    act(() => mock.connection.db.frontierObject.change([...resources, { ...wildlife, data: '{"id":"moth","x":2}' }], 'wildlife-moved'));
    expect(parse).not.toHaveBeenCalled();
    expect(mock.labels).not.toHaveBeenCalled();
    act(() => mock.connection.db.frontierObject.change([{ kind: 'resource', data: '{"id":"resource-0"}' }, ...resources.slice(1), wildlife], 'harvest-finished'));
    expect(parse).toHaveBeenCalledOnce();
    expect(mock.labels.mock.calls.map(([id]) => id)).toEqual(['player-2']);
  });

  it('does not rerender 32 unchanged avatars when another player starts hauling',
    () => {
      const crowd = Array.from({ length: 32 }, (_, i) => player(i + 2));
      render(<>{crowd.map(row => <PlayerAvatar key={row.name} row={row} isSelf={false} />)}</>);
      mock.labels.mockClear();
      act(() => mock.connection.db.expedition.change([{ stage: 'hauling', carrier: identity(3) }], 'haul-start'));
      expect(mock.labels.mock.calls.map(([id]) => id)).toEqual(['player-3']);
    });

  it('keeps regional claim expiry live even when no player or claim row changes', () => {
    const plot = PLOTS.find(plot => plot.region === 'reedwake')!;
    me = player(1, { region: plot.region, x: plot.x, z: plot.z });
    mock.connection.db.player = table([me]);
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const frontier = { buildings: [], plots: [{ ...plot, claim: { id: plot.id, paidUntil: 1500 }, status: 'protected' }] } as any;
    const ui = render(<PlayerAvatar row={player(2, { region: plot.region, x: plot.x + 1, z: plot.z })} frontier={frontier} isSelf={false} />);
    const action = () => {
      const group = ui.container.querySelector('group') as any;
      return group[Object.keys(group).find(key => key.startsWith('__reactProps$'))!].userData.hoverTarget.action;
    };
    expect(action()).toBe('Click for player actions');
    now.mockReturnValue(1600);
    act(() => mock.connection.db.world.change([{ tick: 101 }], 'claim-expired'));
    expect(action()).toBe('Click to attack');
  });

  it('keeps avatar frontier props stable until buildings or plot protection actually change', () => {
    const first = { buildings: [{ id: 'wall', x: 1 }], plots: [{ id: 'plot', status: 'protected', claim: { owner: 'owner' } }] } as any;
    const stable = avatarFrontierState(first);
    expect(avatarFrontierState(JSON.parse(JSON.stringify(first)))).toBe(stable);
    const row = player(2);
    const ui = render(<PlayerAvatar row={row} isSelf={false} frontier={stable} />);
    mock.labels.mockClear();
    ui.rerender(<PlayerAvatar row={row} isSelf={false} frontier={avatarFrontierState(JSON.parse(JSON.stringify(first)))} />);
    expect(mock.labels).not.toHaveBeenCalled();
    const moved = { ...first, buildings: [{ id: 'wall', x: 2 }] } as any;
    expect(avatarFrontierState(moved)).not.toBe(stable);
    ui.rerender(<PlayerAvatar row={row} isSelf={false} frontier={avatarFrontierState(moved)} />);
    expect(mock.labels).toHaveBeenCalledOnce();
    const unprotected = { ...moved, plots: [{ ...first.plots[0], status: 'available' }] } as any;
    expect(avatarFrontierState(unprotected)).not.toBe(avatarFrontierState(moved));
  });
});
