import { describe, expect, it, vi } from 'vitest';

// The real reducers and lifecycle hook, without a live database (as in server-reducers.test.ts).
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
import { clearSpectators as registeredClear, grantSpectator as registeredGrant } from '../../../spacetimedb/src/reducers/access';
import { onConnect as registeredConnect, onDisconnect as registeredDisconnect } from '../../../spacetimedb/src/reducers/lifecycle';
import { MAX_SPECTATORS, MAX_SPECTATOR_CONNECTIONS, SPECTATOR_PASS_SECONDS } from '../admission';

type Reducer = (ctx: any, args?: any) => void;
const grant = registeredGrant as unknown as Reducer;
const connect = registeredConnect as unknown as Reducer;
const disconnect = registeredDisconnect as unknown as Reducer;
const clear = registeredClear as unknown as Reducer;
const id = (hex: string) => ({ toHexString: () => hex, isEqual: (o: any) => o?.toHexString() === hex });
const OWNER = id('owner'), GATEWAY = id('gateway'), VIEWER = id('viewer'), STRANGER = id('stranger');
const NOW = 1_000_000_000_000n;

function world(requireAdmission = true) {
  const rows = new Map<string, any>();
  const inserted: any[] = [];
  const keyed = (map: Map<string, any>) => ({
    find: (identity: any) => map.get(identity.toHexString()) ?? null,
    delete: (identity: any) => map.delete(identity.toHexString()),
    update: (row: any) => { map.set(row.identity.toHexString(), row); return row; },
  });
  const db: any = {
    accessPolicy: { id: { find: () => ({ id: 0, owner: OWNER, gateway: GATEWAY, requireAdmission }) } },
    spectator: {
      identity: keyed(rows), count: () => BigInt(rows.size), iter: () => rows.values(),
      insert: (row: any) => rows.set(row.identity.toHexString(), row),
    },
    playerGrant: { identity: keyed(new Map()), count: () => 0n },
    player: { identity: keyed(new Map()), count: () => 0n, insert: (row: any) => inserted.push(row), iter: () => [] },
    playerPos: { identity: keyed(new Map()) },
    world: { id: { find: () => ({ tick: 1 }) } },
  };
  const ctx = (sender: any, micros = NOW) => ({ db, sender, timestamp: { microsSinceUnixEpoch: micros } });
  return { ctx, rows, inserted };
}

describe('spectator passes', () => {
  it('lets a registered viewer connect with no character', () => {
    const w = world();
    grant(w.ctx(GATEWAY), { identity: VIEWER, lifetimeSeconds: 3600 });
    connect(w.ctx(VIEWER));
    expect(w.inserted).toEqual([]);
  });

  it('refuses an expired pass rather than letting it become a player', () => {
    for (const admission of [true, false]) {
      const w = world(admission);
      grant(w.ctx(GATEWAY), { identity: VIEWER, lifetimeSeconds: 60 });
      expect(() => connect(w.ctx(VIEWER, NOW + 61_000_000n))).toThrow('spectator pass expired');
      expect(w.inserted).toEqual([]);
    }
  });

  it('takes grants only from the gateway or the owner', () => {
    const w = world();
    expect(() => grant(w.ctx(STRANGER), { identity: STRANGER, lifetimeSeconds: 3600 })).toThrow('world owner or gateway required');
    expect(() => grant(w.ctx(VIEWER), { identity: VIEWER, lifetimeSeconds: 3600 })).toThrow('world owner or gateway required');
    grant(w.ctx(OWNER), { identity: VIEWER, lifetimeSeconds: 3600 });
    expect(w.rows.size).toBe(1);
  });

  it('bounds the lifetime and wants a fresh identity', () => {
    const w = world();
    expect(() => grant(w.ctx(GATEWAY), { identity: VIEWER, lifetimeSeconds: 59 })).toThrow('lifetime');
    expect(() => grant(w.ctx(GATEWAY), { identity: VIEWER, lifetimeSeconds: SPECTATOR_PASS_SECONDS + 1 })).toThrow('lifetime');
    expect(() => grant(w.ctx(GATEWAY), { identity: GATEWAY, lifetimeSeconds: 3600 })).toThrow('fresh');
    grant(w.ctx(GATEWAY), { identity: VIEWER, lifetimeSeconds: 3600 });
    expect(() => grant(w.ctx(GATEWAY), { identity: VIEWER, lifetimeSeconds: 3600 })).toThrow('fresh');
  });

  it('caps live viewers, and expired passes make room', () => {
    const w = world();
    for (let i = 0; i < MAX_SPECTATORS; i++) grant(w.ctx(GATEWAY), { identity: id(`v${i}`), lifetimeSeconds: 60 });
    expect(() => grant(w.ctx(GATEWAY), { identity: VIEWER, lifetimeSeconds: 60 })).toThrow('spectator capacity reached');
    grant(w.ctx(GATEWAY, NOW + 61_000_000n), { identity: VIEWER, lifetimeSeconds: 60 });
    expect(w.rows.size).toBe(1);
  });

  it('keeps expired passes in a world without admission, where a forgotten token would get a character', () => {
    const w = world(false);
    for (let i = 0; i < MAX_SPECTATORS; i++) grant(w.ctx(OWNER), { identity: id(`v${i}`), lifetimeSeconds: 60 });
    expect(() => grant(w.ctx(OWNER, NOW + 61_000_000n), { identity: VIEWER, lifetimeSeconds: 60 })).toThrow('spectator capacity reached');
    expect(w.rows.size).toBe(MAX_SPECTATORS);
  });
});

describe('spectator sockets and clearing', () => {
  it('admits a pass on at most MAX_SPECTATOR_CONNECTIONS sockets at once, and a disconnect frees one', () => {
    const w = world();
    grant(w.ctx(GATEWAY), { identity: VIEWER, lifetimeSeconds: 3600 });
    expect(w.rows.get('viewer').connections).toBe(0);
    for (let i = 0; i < MAX_SPECTATOR_CONNECTIONS; i++) connect(w.ctx(VIEWER));
    expect(w.rows.get('viewer').connections).toBe(MAX_SPECTATOR_CONNECTIONS);
    expect(() => connect(w.ctx(VIEWER))).toThrow('too many connections for this pass');
    disconnect(w.ctx(VIEWER));
    expect(w.rows.get('viewer').connections).toBe(MAX_SPECTATOR_CONNECTIONS - 1);
    connect(w.ctx(VIEWER));
    for (let i = 0; i < 5; i++) disconnect(w.ctx(VIEWER));
    expect(w.rows.get('viewer').connections).toBe(0);
    expect(w.inserted).toEqual([]);
  });

  it('clearing is the owner\'s alone', () => {
    const w = world();
    grant(w.ctx(GATEWAY), { identity: VIEWER, lifetimeSeconds: 3600 });
    for (const who of [GATEWAY, VIEWER, STRANGER]) {
      expect(() => clear(w.ctx(who), { expiredOnly: false })).toThrow('world owner required');
    }
    expect(w.rows.size).toBe(1);
  });

  it('clears expired passes that no socket holds, and leaves live ones', () => {
    const w = world();
    grant(w.ctx(GATEWAY), { identity: id('old'), lifetimeSeconds: 60 });
    grant(w.ctx(GATEWAY), { identity: id('held'), lifetimeSeconds: 60 });
    grant(w.ctx(GATEWAY), { identity: VIEWER, lifetimeSeconds: 3600 });
    connect(w.ctx(id('held')));
    clear(w.ctx(OWNER, NOW + 61_000_000n), { expiredOnly: true });
    expect([...w.rows.keys()].sort()).toEqual(['held', 'viewer']);
    // The held one goes when its last socket closes.
    disconnect(w.ctx(id('held'), NOW + 62_000_000n));
    expect([...w.rows.keys()]).toEqual(['viewer']);
  });

  it('clearing all ends every pass: idle rows go, held ones are refused from then on and go on disconnect', () => {
    const w = world();
    grant(w.ctx(GATEWAY), { identity: VIEWER, lifetimeSeconds: 3600 });
    grant(w.ctx(GATEWAY), { identity: id('held'), lifetimeSeconds: 3600 });
    connect(w.ctx(id('held')));
    clear(w.ctx(OWNER), { expiredOnly: false });
    expect([...w.rows.keys()]).toEqual(['held']);
    expect(() => connect(w.ctx(id('held'), NOW + 1n))).toThrow('spectator pass expired');
    disconnect(w.ctx(id('held'), NOW + 2n));
    expect(w.rows.size).toBe(0);
    // Capacity is back.
    for (let i = 0; i < MAX_SPECTATORS; i++) grant(w.ctx(GATEWAY, NOW + 3n), { identity: id(`v${i}`), lifetimeSeconds: 60 });
  });

  it('never deletes a pass in a world without admission, where its token would then get a character', () => {
    const w = world(false);
    grant(w.ctx(OWNER), { identity: VIEWER, lifetimeSeconds: 60 });
    expect(() => clear(w.ctx(OWNER, NOW + 61_000_000n), { expiredOnly: true })).toThrow('admission');
    disconnect(w.ctx(VIEWER, NOW + 62_000_000n));
    expect(w.rows.size).toBe(1);
  });
});
