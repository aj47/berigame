import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../spacetimedb/node_modules/spacetimedb/dist/server/index.mjs', () => ({
  t: new Proxy({}, { get: () => () => ({}) }), SenderError: class SenderError extends Error {},
}));
vi.mock('../../../spacetimedb/src/schema', () => ({ default: {
  reducer: (...args: unknown[]) => args.at(-1), init: (fn: unknown) => fn,
  clientConnected: (fn: unknown) => fn, clientDisconnected: (fn: unknown) => fn,
} }));
import { configureAccess, grantAgent, grantPlayer, renewGrant, resumeGrant, revokePlayer, endVisit } from '../../../spacetimedb/src/reducers/access';
import { IDLE_LOGOUT_TICKS, logOutIfIdle } from '../../../spacetimedb/src/lib/idle';
import { onConnect, onDisconnect } from '../../../spacetimedb/src/reducers/lifecycle';
import { requirePlayer } from '../../../spacetimedb/src/lib/players';
import { sendChat } from '../../../spacetimedb/src/reducers/chat';

import { MAX_ONLINE_PLAYERS } from '../admission';

const id = (hex: string) => ({ toHexString: () => hex });
const owner = id('owner'), gateway = id('gateway'), guest = id('guest');
type Fn = (ctx: any, args?: any) => void;
const call = (fn: unknown, ctx: any, args?: any) => (fn as Fn)(ctx, args);
function world() {
  const grants = new Map<string, any>(), players = new Map<string, any>(), idle = new Map<string, any>();
  const policies = new Map([[0, { id: 0, owner, gateway, requireAdmission: true }]]);
  const keyed = (rows: Map<string, any>) => ({
    iter: () => rows.values(), count: () => BigInt(rows.size), insert: (row: any) => rows.set(row.identity.toHexString(), row),
    identity: { find: (identity: any) => rows.get(identity.toHexString()), update: (row: any) => rows.set(row.identity.toHexString(), row) },
  });
  const ctx = { sender: guest, timestamp: { microsSinceUnixEpoch: 100_000_000n }, db: {
    accessPolicy: { id: { find: (key: number) => policies.get(key), update: (row: any) => policies.set(row.id, row) } },
    playerGrant: keyed(grants), player: keyed(players), idleState: keyed(idle), tree: { id: { find: () => undefined } },
    world: { id: { find: () => ({ tick: 20 }) } }, chatMessage: { iter: () => [] }, trade: { a: { filter: () => [] }, b: { filter: () => [] } },
  } };
  return { ctx, grants, players, policies, idle };
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

  it('allows a LAN-sized batch of permits without treating offline characters as online slots', () => {
    const w = world(); w.ctx.sender = gateway;
    for (let i = 0; i < 512; i++) call(grantAgent, w.ctx, { identity: id(String(i)), lifetimeSeconds: 60, combat: false, chat: false });
    expect(w.grants.size).toBe(512);
    expect(w.players.size).toBe(0);
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

  it('renewal keeps the same character across permit expiry, and returning players are not newcomers', () => {
    const w = world(); w.ctx.sender = gateway;
    call(grantAgent, w.ctx, { identity: guest, lifetimeSeconds: 60, combat: false, chat: false });
    w.ctx.sender = guest; call(onConnect, w.ctx);
    const first = w.players.get('guest');
    w.players.set('guest', { ...first, hp: 3, connections: 0, online: false });
    w.ctx.timestamp = { microsSinceUnixEpoch: 200_000_000n }; // permit ended
    expect(() => call(onConnect, w.ctx)).toThrow('access required');
    w.ctx.sender = gateway;
    call(renewGrant, w.ctx, { identity: guest, lifetimeSeconds: 3600 });
    expect(w.grants.get('guest').expiresAtMicros).toBe(200_000_000n + 3_600_000_000n);
    w.ctx.sender = guest; call(onConnect, w.ctx);
    expect(w.players.size).toBe(1);
    const back = w.players.get('guest');
    expect(back.name).toBe(first.name);
    expect(back.hp).toBe(3);
    expect(back.respawnTick).toBe(first.respawnTick);
    expect(back.online).toBe(true);
  });

  it('only the issuing gateway renews, never unknown, owner-issued or revoked permits', () => {
    const w = world();
    const args = { identity: guest, lifetimeSeconds: 3600 };
    w.ctx.sender = gateway;
    expect(() => call(renewGrant, w.ctx, args)).toThrow('no renewable permit');
    expect(() => call(renewGrant, w.ctx, { ...args, lifetimeSeconds: 3601 })).toThrow('lifetime');
    w.ctx.sender = owner;
    call(grantPlayer, w.ctx, { identity: guest, lifetimeSeconds: 60, combat: false, chat: false });
    w.ctx.sender = gateway;
    expect(() => call(renewGrant, w.ctx, args)).toThrow('no renewable permit');
    w.grants.clear();
    call(grantAgent, w.ctx, { identity: guest, lifetimeSeconds: 60, combat: false, chat: false });
    for (const sender of [guest, owner]) {
      w.ctx.sender = sender;
      expect(() => call(renewGrant, w.ctx, args)).toThrow('gateway required');
    }
    w.ctx.sender = gateway;
    call(revokePlayer, w.ctx, { identity: guest });
    expect(() => call(renewGrant, w.ctx, args)).toThrow('revoked');
    w.ctx.sender = guest;
    expect(() => call(onConnect, w.ctx)).toThrow('access required');
  });

  it('enforces the online cap on direct connections, frees a slot on disconnect, and admits a waiting character', () => {
    const w = world(); w.ctx.sender = gateway;
    const args = { lifetimeSeconds: 60, combat: false, chat: false };
    // Issue before anyone connects: the final connection check must be authoritative.
    for (let i = 0; i <= MAX_ONLINE_PLAYERS; i++) call(grantAgent, w.ctx, { ...args, identity: id(String(i)) });
    for (let i = 0; i < MAX_ONLINE_PLAYERS; i++) { w.ctx.sender = id(String(i)); call(onConnect, w.ctx); }
    w.ctx.sender = id(String(MAX_ONLINE_PLAYERS));
    expect(() => call(onConnect, w.ctx)).toThrow('world is full');
    // A second tab of an online character uses the same world slot.
    w.ctx.sender = id('0'); call(onConnect, w.ctx); call(onDisconnect, w.ctx);
    expect(w.players.get('0').online).toBe(true);
    call(onDisconnect, w.ctx);
    expect(w.players.get('0').online).toBe(false);
    w.ctx.sender = id(String(MAX_ONLINE_PLAYERS)); call(onConnect, w.ctx);
    expect([...w.players.values()].filter(p => p.online)).toHaveLength(MAX_ONLINE_PLAYERS);
  });

  it('keeps online players renewing at capacity while returning offline players wait', () => {
    const w = world(); w.ctx.sender = gateway;
    call(grantAgent, w.ctx, { identity: guest, lifetimeSeconds: 60, combat: false, chat: false });
    for (let i = 0; i < MAX_ONLINE_PLAYERS; i++) {
      const identity = id(String(i)); w.ctx.sender = gateway;
      call(grantAgent, w.ctx, { identity, lifetimeSeconds: 60, combat: false, chat: false });
      w.ctx.sender = identity; call(onConnect, w.ctx);
    }
    w.ctx.sender = gateway;
    expect(() => call(grantAgent, w.ctx, { identity: id('new'), lifetimeSeconds: 60, combat: false, chat: false })).toThrow('world is full');
    expect(() => call(renewGrant, w.ctx, { identity: guest, lifetimeSeconds: 3600 })).toThrow('world is full');
    call(renewGrant, w.ctx, { identity: id('0'), lifetimeSeconds: 3600 });
  });
});

it('ending a visit preserves renewal, while operator revocation remains final', () => {
  const w = world(); w.ctx.sender = gateway;
  call(grantAgent,w.ctx,{identity:guest,lifetimeSeconds:3600,combat:true,chat:true});
  call(endVisit,w.ctx,{identity:guest});
  expect(w.grants.get('guest').expiresAtMicros).toBe(w.ctx.timestamp.microsSinceUnixEpoch);
  call(renewGrant,w.ctx,{identity:guest,lifetimeSeconds:3600});
  expect(w.grants.get('guest').expiresAtMicros).toBeGreaterThan(w.ctx.timestamp.microsSinceUnixEpoch);
  call(revokePlayer,w.ctx,{identity:guest});
  call(endVisit,w.ctx,{identity:guest});
  expect(()=>call(renewGrant,w.ctx,{identity:guest,lifetimeSeconds:3600})).toThrow('revoked');
  w.ctx.sender=guest; expect(()=>call(endVisit,w.ctx,{identity:guest})).toThrow('gateway');
});

describe('idle logout', () => {
  const later = 20 + IDLE_LOGOUT_TICKS;
  function admitted() {
    const w = world(); w.ctx.sender = gateway;
    call(grantAgent, w.ctx, { identity: guest, lifetimeSeconds: 3600, combat: true, chat: true });
    w.ctx.sender = guest; call(onConnect, w.ctx); // connected at tick 20
    return w;
  }

  it('ends the permit of a character with no input since connecting, and only an explicit return renews it', () => {
    const w = admitted();
    expect(logOutIfIdle(w.ctx as any, w.players.get('guest'), later - 1, gateway)).toBe(false);
    expect(logOutIfIdle(w.ctx as any, w.players.get('guest'), later, gateway)).toBe(true);
    expect(w.grants.get('guest').expiresAtMicros).toBe(w.ctx.timestamp.microsSinceUnixEpoch);
    expect(w.idle.get('guest').loggedOut).toBe(true);
    // A reloading page cannot bring it back: reconnects are refused and plain renewal is too.
    w.players.set('guest', { ...w.players.get('guest'), online: false, connections: 0 });
    expect(() => call(onConnect, w.ctx)).toThrow('access required');
    w.ctx.sender = gateway;
    expect(() => call(renewGrant, w.ctx, { identity: guest, lifetimeSeconds: 3600 })).toThrow('inactivity');
    call(resumeGrant, w.ctx, { identity: guest, lifetimeSeconds: 3600 });
    expect(w.idle.get('guest').loggedOut).toBe(false);
    w.ctx.sender = guest; call(onConnect, w.ctx);
    expect(w.players.get('guest').online).toBe(true);
    w.ctx.sender = gateway;
    call(renewGrant, w.ctx, { identity: guest, lifetimeSeconds: 3600 });
  });

  it('keeps players who acted or just connected, and leaves owner-granted players and revoked permits alone', () => {
    const w = admitted();
    w.players.set('guest', { ...w.players.get('guest'), lastInputTick: later - 5 });
    expect(logOutIfIdle(w.ctx as any, w.players.get('guest'), later, gateway)).toBe(false);
    // An old lastInputTick does not count against a fresh connection.
    w.players.set('guest', { ...w.players.get('guest'), lastInputTick: 0 });
    w.idle.set('guest', { ...w.idle.get('guest'), activeTick: later - 5 });
    expect(logOutIfIdle(w.ctx as any, w.players.get('guest'), later, gateway)).toBe(false);
    // Online since before idle logout existed: its clock starts now.
    w.idle.clear();
    expect(logOutIfIdle(w.ctx as any, w.players.get('guest'), later, gateway)).toBe(false);
    expect(w.idle.get('guest').activeTick).toBe(later);
    w.idle.set('guest', { identity: guest, activeTick: 0, loggedOut: false });
    w.ctx.sender = owner;
    call(grantPlayer, w.ctx, { identity: guest, lifetimeSeconds: 86400, combat: true, chat: true });
    expect(logOutIfIdle(w.ctx as any, w.players.get('guest'), later, gateway)).toBe(false);
    w.ctx.sender = gateway;
    w.grants.set('guest', { ...w.grants.get('guest'), agent: true, issuer: gateway, expiresAtMicros: 0n });
    expect(logOutIfIdle(w.ctx as any, w.players.get('guest'), later, gateway)).toBe(false);
    expect(w.grants.get('guest').expiresAtMicros).toBe(0n);
  });

  it('returning brings back a character whose gateway connection stayed open', () => {
    const w = admitted();
    logOutIfIdle(w.ctx as any, w.players.get('guest'), later, gateway);
    w.players.set('guest', { ...w.players.get('guest'), online: false }); // the tick's expiry check
    w.ctx.sender = gateway;
    call(resumeGrant, w.ctx, { identity: guest, lifetimeSeconds: 3600 });
    expect(w.players.get('guest').online).toBe(true);
    expect(w.grants.get('guest').expiresAtMicros).toBe(w.ctx.timestamp.microsSinceUnixEpoch + 3_600_000_000n);
  });
});
