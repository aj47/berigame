import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { playerView } from '../spacetime/playerView';
import { useMyPlayer, usePlayerByHex, usePlayers, usePlayersByHex } from '../spacetime/hooks';

const mock = vi.hoisted(() => ({ connection: null as any, identity: { __identity__: 1n, toHexString: () => 'me' } }));
vi.mock('spacetimedb/react', () => ({ useSpacetimeDB: () => ({ identity: mock.identity, getConnection: () => mock.connection }) }));

/** An SDK-like table keyed by identity: rows are replaced on update, callbacks fire after the change. */
function table() {
  const rows = new Map<bigint, any>();
  const cbs = { insert: new Set<Function>(), update: new Set<Function>(), delete: new Set<Function>() };
  let tx = 0;
  return {
    rows,
    iter: () => rows.values(),
    count: () => rows.size,
    identity: { find: (id: any) => rows.get(id.__identity__) },
    onInsert: (cb: Function) => cbs.insert.add(cb), removeOnInsert: (cb: Function) => cbs.insert.delete(cb),
    onDelete: (cb: Function) => cbs.delete.add(cb), removeOnDelete: (cb: Function) => cbs.delete.delete(cb),
    onUpdate: (cb: Function) => cbs.update.add(cb), removeOnUpdate: (cb: Function) => cbs.update.delete(cb),
    put(row: any) {
      const prev = rows.get(row.identity.__identity__);
      rows.set(row.identity.__identity__, row);
      const ctx = { event: { id: `tx${++tx}` } };
      if (prev) for (const cb of cbs.update) cb(ctx, prev, row); else for (const cb of cbs.insert) cb(ctx, row);
    },
    del(id: any) {
      const prev = rows.get(id.__identity__);
      rows.delete(id.__identity__);
      if (prev) for (const cb of cbs.delete) cb({ event: { id: `tx${++tx}` } }, prev);
    },
    listeners: () => cbs.insert.size + cbs.update.size + cbs.delete.size,
  };
}
const identity = (n: number) => ({ __identity__: BigInt(n), toHexString: () => (n === 1 ? 'me' : `p${n}`) });
const player = (n: number, patch = {}) => ({ identity: identity(n), name: `P${n}`, online: true, hp: 30, x: 10, z: 10, facing: 0, targetX: undefined, targetZ: undefined, region: 'bramblewild', ...patch });
const pos = (n: number, patch = {}) => ({ identity: identity(n), region: 'bramblewild', x: 10, z: 10, facing: 0, targetX: undefined, targetZ: undefined, lastInputTick: 0, inputsThisTick: 0, ...patch });

beforeEach(() => {
  mock.connection = { db: { player: table(), playerPos: table(), world: table() } };
});

describe('playerView', () => {
  it('merges the live position into player rows and keeps row objects stable until one of the two changes', () => {
    const db = mock.connection.db;
    db.player.put(player(2, { x: 1, z: 1 }));
    const view = playerView(mock.connection);
    // No player_pos row (offline, or not subscribed): the player row itself.
    expect(view.identity.find(identity(2))).toBe(db.player.rows.get(2n));
    db.playerPos.put(pos(2, { x: 40, z: 41, facing: 3, targetX: 44, targetZ: 41 }));
    const a = view.identity.find(identity(2))!;
    expect(a).toMatchObject({ name: 'P2', x: 40, z: 41, facing: 3, targetX: 44, targetZ: 41 });
    expect(view.identity.find(identity(2))).toBe(a);
    expect([...view.iter()][0]).toBe(a);
    db.playerPos.put(pos(2, { x: 41, z: 41 }));
    expect(view.identity.find(identity(2))).not.toBe(a);
    expect(view.identity.find(identity(2))!.x).toBe(41);
  });

  it('reports a step as an update of the merged row, and player row changes with the live position', () => {
    const db = mock.connection.db;
    db.player.put(player(2));
    db.playerPos.put(pos(2, { x: 20 }));
    const view = playerView(mock.connection);
    const seen: [number, number, number][] = [];
    const cb = (_ctx: unknown, prev: any, row: any) => seen.push([prev.x, row.x, row.hp]);
    view.onUpdate(cb);
    db.playerPos.put(pos(2, { x: 21 }));
    db.player.put(player(2, { hp: 12 })); // its saved x (10) is stale: the live one wins
    db.playerPos.del(identity(2)); // offline: the saved position again
    expect(seen).toEqual([[20, 21, 30], [21, 21, 12], [21, 10, 12]]);
    view.removeOnUpdate(cb);
    expect(db.player.listeners() + db.playerPos.listeners()).toBe(0);
  });
});

describe('player hooks', () => {
  it('return merged rows and follow player_pos steps', () => {
    const db = mock.connection.db;
    db.player.put(player(1, { x: 5, z: 5 }));
    db.player.put(player(2, { x: 5, z: 5 }));
    db.playerPos.put(pos(1, { x: 30, z: 31 }));
    db.playerPos.put(pos(2, { x: 50, z: 51 }));
    const mine = renderHook(useMyPlayer);
    const all = renderHook(usePlayers);
    const byHex = renderHook(usePlayersByHex);
    const other = renderHook(() => usePlayerByHex('p2'));
    expect(mine.result.current).toMatchObject({ x: 30, z: 31 });
    expect(all.result.current.map((p) => p.x)).toEqual([30, 50]);
    expect(byHex.result.current.get('p2')).toMatchObject({ x: 50, z: 51 });
    const before = mine.result.current;
    // Another player's step: your row object is unchanged, theirs moves.
    act(() => db.playerPos.put(pos(2, { x: 51, z: 51 })));
    expect(mine.result.current).toBe(before);
    expect(other.result.current).toMatchObject({ x: 51 });
    expect(all.result.current.map((p) => p.x)).toEqual([30, 51]);
    // Your own step.
    act(() => db.playerPos.put(pos(1, { x: 31, z: 31, facing: 2 })));
    expect(mine.result.current).toMatchObject({ x: 31, facing: 2, name: 'P1' });
  });
});
