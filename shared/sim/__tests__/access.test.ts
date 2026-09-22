import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../spacetimedb/node_modules/spacetimedb/dist/server/index.mjs', () => ({
  t: new Proxy({}, { get: () => () => ({}) }), SenderError: class SenderError extends Error {},
}));
vi.mock('../../../spacetimedb/src/schema', () => ({ default: {
  reducer: (...args: unknown[]) => args.at(-1), init: (fn: unknown) => fn,
  clientConnected: (fn: unknown) => fn, clientDisconnected: (fn: unknown) => fn,
} }));
import { configureAccess, grantAgent, grantPlayer, revokePlayer } from '../../../spacetimedb/src/reducers/access';
import { onConnect } from '../../../spacetimedb/src/reducers/lifecycle';
import { requirePlayer } from '../../../spacetimedb/src/lib/players';
import { sendChat } from '../../../spacetimedb/src/reducers/chat';

const id = (hex: string) => ({ toHexString: () => hex });
const owner = id('owner'), gateway = id('gateway'), guest = id('guest');
type Fn = (ctx: any, args?: any) => void;
const call = (fn: unknown, ctx: any, args?: any) => (fn as Fn)(ctx, args);
function world() {
  const grants = new Map<string, any>(), players = new Map<string, any>();
  const policies = new Map([[0, { id: 0, owner, gateway, requireAdmission: true }]]);
  const keyed = (rows: Map<string, any>) => ({
    iter: () => rows.values(), count: () => BigInt(rows.size), insert: (row: any) => rows.set(row.identity.toHexString(), row),
    identity: { find: (identity: any) => rows.get(identity.toHexString()), update: (row: any) => rows.set(row.identity.toHexString(), row) },
  });
  const ctx = { sender: guest, timestamp: { microsSinceUnixEpoch: 100_000_000n }, db: {
    accessPolicy: { id: { find: (key: number) => policies.get(key), update: (row: any) => policies.set(row.id, row) } },
    playerGrant: keyed(grants), player: keyed(players), tree: { id: { find: () => undefined } },
    world: { id: { find: () => ({ tick: 20 }) } }, chatMessage: { iter: () => [] },
  } };
  return { ctx, grants, players, policies };
}

describe('world admission and operator authority', () => {
  it('refuses uninvited connections before allocating a player row, including existing anonymous characters', () => {
    const w = world();
    expect(() => call(onConnect, w.ctx)).toThrow('access required');
    expect(w.players.size).toBe(0);
    w.players.set('guest', { identity: guest, online: true });
    expect(() => requirePlayer(w.ctx as any)).toThrow('access required');
  });

  it('only the captured world owner can configure or grant human access; missing policy cannot be claimed', () => {
    const w = world();
    expect(() => call(configureAccess, w.ctx, { gateway: guest, requireAdmission: false })).toThrow('owner required');
    w.ctx.sender = gateway;
    expect(() => call(grantPlayer, w.ctx, { identity: guest, lifetimeSeconds: 3600, combat: true, chat: true })).toThrow('owner required');
    w.ctx.sender = owner;
    call(configureAccess, w.ctx, { gateway, requireAdmission: true });
    w.policies.clear();
    expect(() => call(configureAccess, w.ctx, { gateway, requireAdmission: true })).toThrow('owner required');
  });

  it('only the gateway can grant agent access, with a one-hour ceiling and no takeover of another player', () => {
    const w = world();
    const args = { identity: guest, lifetimeSeconds: 60, combat: false, chat: false };
    expect(() => call(grantAgent, w.ctx, args)).toThrow('gateway required');
    w.ctx.sender = gateway;
    expect(() => call(grantAgent, w.ctx, { ...args, lifetimeSeconds: 3601 })).toThrow('lifetime');
    expect(() => call(grantAgent, w.ctx, { ...args, identity: owner })).toThrow('fresh agent');
    call(grantAgent, w.ctx, args);
    expect(w.grants.get('guest').expiresAtMicros).toBe(160_000_000n);
    expect(() => call(grantAgent, w.ctx, args)).toThrow('fresh agent');
    w.ctx.sender = guest;
    call(onConnect, w.ctx);
    expect(w.players.size).toBe(1);
    expect(() => call(sendChat, w.ctx, { text: 'scope bypass' })).toThrow('chat is not enabled');
  });

  it('caps active grants even if callers bypass the HTTP API', () => {
    const w = world(); w.ctx.sender = gateway;
    for (let i = 0; i < 32; i++) call(grantAgent, w.ctx, { identity: id(String(i)), lifetimeSeconds: 60, combat: false, chat: false });
    expect(() => call(grantAgent, w.ctx, { identity: guest, lifetimeSeconds: 60, combat: false, chat: false })).toThrow('capacity');
  });

  it('revocation cannot be performed by another player and immediately blocks the old identity', () => {
    const w = world(); w.ctx.sender = gateway;
    call(grantAgent, w.ctx, { identity: guest, lifetimeSeconds: 60, combat: false, chat: false });
    w.ctx.sender = guest; call(onConnect, w.ctx);
    expect(() => call(revokePlayer, w.ctx, { identity: guest })).toThrow('owner or issuing gateway');
    w.ctx.sender = gateway; call(revokePlayer, w.ctx, { identity: guest });
    w.ctx.sender = guest;
    expect(w.players.get('guest').online).toBe(false);
    expect(() => requirePlayer(w.ctx as any)).toThrow('access required');
    expect(() => call(onConnect, w.ctx)).toThrow('access required');
  });

  it('caps connections for the same admitted identity', () => {
    const w = world(); w.ctx.sender = gateway;
    call(grantAgent, w.ctx, { identity: guest, lifetimeSeconds: 60, combat: false, chat: false });
    w.ctx.sender = guest;
    for (let i = 0; i < 4; i++) call(onConnect, w.ctx);
    expect(() => call(onConnect, w.ctx)).toThrow('too many connections');
    expect(w.players.get('guest').connections).toBe(4);
  });
});
