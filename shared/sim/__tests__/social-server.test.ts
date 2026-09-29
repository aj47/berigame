import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerState } from '../types';
import { STICK_ITEM_ID } from '../items';
import { INVENTORY_SIZE } from '../constants';
import { TRADE_BREAK_RANGE, TRADE_REQUEST_TICKS, executeTrade, formatOffer, parseOffer, removeItemCount } from '../trade';
import {
  CHAT_BUBBLE_MAX_CHARS, CHAT_NEARBY_RADIUS, INVITE_CODE_LEN, INVITE_TTL_MICROS, bubbleText, chatVisible, generateInviteCode,
  inviteUrl, joinSpot, normalizeInviteCode,
} from '../friends';
import { areaOf, isBramble } from '../areas';
import { emptySlots } from '../inventory';
import { tileKey } from '../grid';
import type { Slot } from '../types';

// Run the real social reducers against an in-memory stand-in for the database
// (same approach as server-reducers.test.ts).
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
vi.mock('../../../spacetimedb/src/tables', () => ({ tickSchedule: { rowType: {} } }));
import * as tradeReducers from '../../../spacetimedb/src/reducers/trade';
import * as friendReducers from '../../../spacetimedb/src/reducers/friends';
import { onDisconnect as registeredDisconnect } from '../../../spacetimedb/src/reducers/lifecycle';
import { tick as registeredTick } from '../../../spacetimedb/src/reducers/tick';
import { sendChat as registeredChat } from '../../../spacetimedb/src/reducers/chat';

type Reducer = (ctx: any, args?: any) => void;
const R = (f: unknown) => f as Reducer;
const requestTrade = R(tradeReducers.requestTrade);
const respondTrade = R(tradeReducers.respondTrade);
const setTradeOffer = R(tradeReducers.setTradeOffer);
const confirmTrade = R(tradeReducers.confirmTrade);
const cancelTrade = R(tradeReducers.cancelTradeRequest);
const createInvite = R(friendReducers.createInvite);
const redeemInvite = R(friendReducers.redeemInvite);
const addFriend = R(friendReducers.addFriend);
const removeFriend = R(friendReducers.removeFriend);
const onDisconnect = R(registeredDisconnect);
const scheduledTick = R(registeredTick);
const sendChat = R(registeredChat);

const identity = (value: string) => ({ toHexString: () => value });
const A = identity('a');
const B = identity('b');
const C = identity('c');

function indexed<T extends Record<string, any>>(key: string, rows: Map<any, T>) {
  return { filter: (id: any) => [...rows.values()].filter((r) => r[key].toHexString() === id.toHexString()) };
}

function harness() {
  let now = 100;
  let micros = 1_000_000_000n;
  const players = new Map<string, any>();
  for (const [id, x, name] of [[A, 30, 'Ann'], [B, 31, 'Bo'], [C, 32, 'Cy']] as const) {
    players.set(id.toHexString(), {
      identity: id, name, online: true, connections: 1, state: PlayerState.Alive,
      x, z: 30, hp: 30, maxHp: 30, respawnTick: 0, hostile: false, combatTarget: undefined,
      nextSwingTick: 0, harvestTreeId: 0, harvestEndTick: 0, pending: 0, pendingId: 0n, targetX: undefined, targetZ: undefined,
      lastInputTick: 0, inputsThisTick: 0, eatCooldownUntilTick: 0, weapon: '', facing: 0,
    });
  }
  const inventory = new Map<bigint, any>();
  let nextInv = 1n;
  const trades = new Map<bigint, any>();
  let nextTrade = 1n;
  const friends = new Map<bigint, any>();
  let nextFriend = 1n;
  const codes = new Map<string, any>();
  const notices: any[] = [];
  const chat = new Map<bigint, any>();
  let nextChat = 1n;
  const trees = new Map<number, any>();
  const dummies = new Map<number, any>();
  const giants = new Map<number, any>();
  let rolls: number[] = [];
  const ctx: any = {
    random: vi.fn(() => (rolls.length ? rolls.shift()! : 0.5)),
    sender: A, identity: identity('module'),
    get timestamp() { return { microsSinceUnixEpoch: micros }; },
    db: {
      accessPolicy: { id: { find: () => ({ id: 0, owner: identity('owner'), gateway: identity('gw'), requireAdmission: false }) } },
      playerGrant: { identity: { find: () => undefined } },
      world: { id: { find: () => ({ id: 0, tick: now }), update: (row: any) => { now = row.tick; } } },
      player: { iter: () => players.values(), count: () => BigInt(players.size), identity: {
        find: (id: any) => players.get(id.toHexString()),
        update: (p: any) => players.set(p.identity.toHexString(), p),
      } },
      tree: { iter: () => trees.values(), insert: (row: any) => trees.set(row.id, row), id: { find: (id: number) => trees.get(id), update: (row: any) => trees.set(row.id, row) } },
      trainingDummy: { iter: () => dummies.values(), insert: (row: any) => { dummies.set(row.id, row); return row; }, id: { find: (id: number) => dummies.get(id), update: (row: any) => dummies.set(row.id, row) } },
      groundItem: { iter: () => [][Symbol.iterator](), id: { find: () => undefined } },
      combatEvent: { insert: vi.fn() },
      dummyEvent: { insert: vi.fn() },
      inventorySlot: {
        owner: indexed('owner', inventory),
        insert: (row: any) => { const id = nextInv++; inventory.set(id, { ...row, id }); },
        id: { update: (row: any) => inventory.set(row.id, row), delete: (id: bigint) => inventory.delete(id) },
      },
      trade: {
        iter: () => trades.values(), count: () => BigInt(trades.size),
        insert: (row: any) => { const id = nextTrade++; trades.set(id, { ...row, id }); return { ...row, id }; },
        a: indexed('a', trades), b: indexed('b', trades),
        id: { find: (id: bigint) => trades.get(id), update: (row: any) => trades.set(row.id, row), delete: (id: bigint) => trades.delete(id) },
      },
      friend: {
        insert: (row: any) => { const id = nextFriend++; friends.set(id, { ...row, id }); },
        owner: indexed('owner', friends),
        id: { delete: (id: bigint) => friends.delete(id) },
      },
      inviteCode: {
        iter: () => codes.values(), insert: (row: any) => codes.set(row.code, row),
        code: { find: (c: string) => codes.get(c), delete: (c: string) => codes.delete(c) },
      },
      socialEvent: { insert: (row: any) => notices.push(row) },
      giant: { iter: () => giants.values(), insert: (row: any) => { giants.set(row.id, row); return row; }, id: { find: (id: number) => giants.get(id), update: (row: any) => giants.set(row.id, row) } },
      giantContribution: { iter: () => [][Symbol.iterator](), identity: { find: () => undefined, delete: () => {} } },
      giantEvent: { insert: vi.fn() },
      chatMessage: {
        iter: () => chat.values(),
        insert: (row: any) => { const id = nextChat++; chat.set(id, { ...row, id }); },
        id: { delete: (id: bigint) => chat.delete(id) },
      },
    },
  };
  const give = (owner: any, slot: number, itemId: string, quantity: number) => {
    inventory.set(nextInv, { id: nextInv, owner, slot, itemId, quantity });
    nextInv++;
  };
  const slotsOf = (owner: any): Slot[] => {
    const s = emptySlots();
    for (const r of inventory.values()) if (r.owner.toHexString() === owner.toHexString()) s[r.slot] = { itemId: r.itemId, quantity: r.quantity };
    return s;
  };
  const count = (owner: any, itemId: string) => slotsOf(owner).reduce((n, s) => n + (s?.itemId === itemId ? s.quantity : 0), 0);
  const as = (id: any) => { ctx.sender = id; return ctx; };
  const advance = () => { now += 1; };
  return {
    ctx, players, trades, friends, codes, notices, chat, give, slotsOf, count, as, advance,
    setMicros: (m: bigint) => { micros = m; }, micros: () => micros, setRolls: (r: number[]) => { rolls = r; },
    runTick: () => { ctx.sender = ctx.identity; scheduledTick(ctx, { timer: {} }); },
    p: (id: any) => players.get(id.toHexString()),
    tickNow: () => now,
  };
}

let h: ReturnType<typeof harness>;
beforeEach(() => { h = harness(); });

/** A opens a trade with B and B accepts. Returns the trade row. */
function openTrade() {
  requestTrade(h.as(A), { target: B });
  h.advance();
  const row = [...h.trades.values()][0];
  respondTrade(h.as(B), { tradeId: row.id, accept: true });
  h.advance();
  return h.trades.get(row.id);
}
const current = () => [...h.trades.values()][0];
function bothConfirm() {
  const row = current();
  confirmTrade(h.as(A), { tradeId: row.id, aOffer: row.aOffer, bOffer: row.bOffer });
  h.advance();
  const again = current();
  confirmTrade(h.as(B), { tradeId: again.id, aOffer: again.aOffer, bOffer: again.bOffer });
  h.advance();
}

describe('trading: request, offers, two-sided confirmation, atomic swap', () => {
  it('swaps both offers at once when both confirm, and tells both players', () => {
    h.give(A, 3, 'berry_blueberry', 5);
    h.give(B, 0, STICK_ITEM_ID, 1);
    const row = openTrade();
    expect(row.accepted).toBe(true);
    setTradeOffer(h.as(A), { tradeId: row.id, offer: 'berry_blueberry:3' });
    h.advance();
    setTradeOffer(h.as(B), { tradeId: row.id, offer: `${STICK_ITEM_ID}:1` });
    h.advance();
    bothConfirm();
    expect(h.trades.size).toBe(0);
    expect(h.count(A, 'berry_blueberry')).toBe(2);
    expect(h.count(A, STICK_ITEM_ID)).toBe(1);
    expect(h.count(B, 'berry_blueberry')).toBe(3);
    expect(h.count(B, STICK_ITEM_ID)).toBe(0);
    expect(h.notices.filter((n) => n.kind === 5).map((n) => n.to.toHexString()).sort()).toEqual(['a', 'b']);
  });

  it('a gift (one side offers nothing) works', () => {
    h.give(A, 3, 'berry_goldberry', 2);
    const row = openTrade();
    setTradeOffer(h.as(A), { tradeId: row.id, offer: 'berry_goldberry:2' });
    bothConfirm();
    expect(h.count(B, 'berry_goldberry')).toBe(2);
    expect(h.count(A, 'berry_goldberry')).toBe(0);
  });

  it('any offer change clears both confirmations', () => {
    h.give(A, 3, 'berry_blueberry', 5);
    const row = openTrade();
    setTradeOffer(h.as(A), { tradeId: row.id, offer: 'berry_blueberry:1' });
    h.advance();
    const r1 = current();
    confirmTrade(h.as(B), { tradeId: r1.id, aOffer: r1.aOffer, bOffer: r1.bOffer });
    expect(current().bConfirmed).toBe(true);
    h.advance();
    setTradeOffer(h.as(A), { tradeId: row.id, offer: 'berry_blueberry:4' });
    expect(current().bConfirmed).toBe(false);
    expect(current().aConfirmed).toBe(false);
    expect(h.count(A, 'berry_blueberry')).toBe(5);
  });

  it('confirming offers that changed since you looked is rejected', () => {
    h.give(A, 3, 'berry_blueberry', 5);
    const row = openTrade();
    setTradeOffer(h.as(A), { tradeId: row.id, offer: 'berry_blueberry:1' });
    h.advance();
    expect(() => confirmTrade(h.as(B), { tradeId: row.id, aOffer: '', bOffer: '' })).toThrow('offer changed');
    expect(current().bConfirmed).toBe(false);
  });

  it('you cannot offer what you do not have, or your wielded weapon', () => {
    h.give(A, 0, STICK_ITEM_ID, 1);
    h.give(A, 3, 'berry_blueberry', 1);
    h.p(A).weapon = STICK_ITEM_ID;
    const row = openTrade();
    expect(() => setTradeOffer(h.as(A), { tradeId: row.id, offer: `${STICK_ITEM_ID}:1` })).toThrow('Unwield');
    h.advance();
    expect(() => setTradeOffer(h.as(A), { tradeId: row.id, offer: 'berry_blueberry:2' })).toThrow('do not have');
    h.advance();
    expect(() => setTradeOffer(h.as(A), { tradeId: row.id, offer: 'nonsense' })).toThrow('bad offer');
  });

  it('wielding an offered weapon before the swap fails the swap: nothing moves, confirmations clear', () => {
    h.give(A, 0, STICK_ITEM_ID, 1);
    h.give(B, 3, 'berry_blueberry', 4);
    const row = openTrade();
    setTradeOffer(h.as(A), { tradeId: row.id, offer: `${STICK_ITEM_ID}:1` });
    h.advance();
    setTradeOffer(h.as(B), { tradeId: row.id, offer: 'berry_blueberry:4' });
    h.advance();
    h.p(A).weapon = STICK_ITEM_ID; // wielded after offering
    bothConfirm();
    expect(h.trades.size).toBe(1);
    expect(current().aConfirmed || current().bConfirmed).toBe(false);
    expect(h.count(A, STICK_ITEM_ID)).toBe(1);
    expect(h.count(B, 'berry_blueberry')).toBe(4);
    expect(h.notices.some((n) => n.kind === 6 && /unwield/.test(n.text))).toBe(true);
  });

  it('an offered item eaten or dropped before the swap fails it atomically', () => {
    h.give(A, 3, 'berry_blueberry', 2);
    h.give(B, 3, 'berry_goldberry', 1);
    const row = openTrade();
    setTradeOffer(h.as(A), { tradeId: row.id, offer: 'berry_blueberry:2' });
    h.advance();
    setTradeOffer(h.as(B), { tradeId: row.id, offer: 'berry_goldberry:1' });
    h.advance();
    // A eats one (bag changes outside the trade)
    for (const r of h.ctx.db.inventorySlot.owner.filter(A)) h.ctx.db.inventorySlot.id.update({ ...r, quantity: 1 });
    bothConfirm();
    expect(h.count(A, 'berry_blueberry')).toBe(1);
    expect(h.count(A, 'berry_goldberry')).toBe(0);
    expect(h.count(B, 'berry_goldberry')).toBe(1);
    expect(h.count(B, 'berry_blueberry')).toBe(0);
  });

  it('respects bag capacity: a full bag fails the swap and nothing moves', () => {
    for (let i = 0; i < INVENTORY_SIZE; i++) h.give(B, i, 'berry_greenberry', 99);
    h.give(A, 3, 'berry_blueberry', 1);
    const row = openTrade();
    setTradeOffer(h.as(A), { tradeId: row.id, offer: 'berry_blueberry:1' });
    bothConfirm();
    expect(h.count(A, 'berry_blueberry')).toBe(1);
    expect(h.count(B, 'berry_blueberry')).toBe(0);
    expect(h.notices.some((n) => /too full/.test(n.text))).toBe(true);
  });

  it('a full bag still takes items when it gives a whole stack away in the same swap', () => {
    for (let i = 0; i < INVENTORY_SIZE; i++) h.give(B, i, 'berry_greenberry', 99);
    h.give(A, 3, 'berry_blueberry', 1);
    const row = openTrade();
    setTradeOffer(h.as(A), { tradeId: row.id, offer: 'berry_blueberry:1' });
    h.advance();
    setTradeOffer(h.as(B), { tradeId: row.id, offer: 'berry_greenberry:99' });
    bothConfirm();
    expect(h.count(B, 'berry_blueberry')).toBe(1);
    expect(h.count(A, 'berry_greenberry')).toBe(99);
  });

  it('requests need range; a counter-request accepts; one trade at a time', () => {
    h.p(B).x = 40;
    expect(() => requestTrade(h.as(A), { target: B })).toThrow('closer');
    h.p(B).x = 31;
    h.advance();
    requestTrade(h.as(A), { target: B });
    h.advance();
    requestTrade(h.as(B), { target: A }); // B asks back: that accepts A's request
    expect(current().accepted).toBe(true);
    h.advance();
    expect(() => requestTrade(h.as(C), { target: B })).toThrow('busy');
    expect(() => requestTrade(h.as(A), { target: A })).toThrow('yourself');
  });

  it('only the asked player can accept; declining ends it', () => {
    requestTrade(h.as(A), { target: B });
    h.advance();
    const row = current();
    expect(() => respondTrade(h.as(A), { tradeId: row.id, accept: true })).toThrow();
    h.advance();
    expect(() => respondTrade(h.as(C), { tradeId: row.id, accept: true })).toThrow('over');
    h.advance();
    respondTrade(h.as(B), { tradeId: row.id, accept: false });
    expect(h.trades.size).toBe(0);
  });

  it('offers cannot be set before the request is accepted', () => {
    h.give(A, 3, 'berry_blueberry', 1);
    requestTrade(h.as(A), { target: B });
    h.advance();
    expect(() => setTradeOffer(h.as(A), { tradeId: current().id, offer: 'berry_blueberry:1' })).toThrow('accepted');
  });

  it('the tick cancels a trade when the players walk apart, die, or a request goes unanswered', () => {
    openTrade();
    h.p(B).x = 30 + TRADE_BREAK_RANGE + 1;
    h.runTick();
    expect(h.trades.size).toBe(0);
    expect(h.notices.some((n) => /too far/.test(n.text))).toBe(true);

    h.p(B).x = 31;
    openTrade();
    h.p(A).state = PlayerState.Dead;
    h.p(A).respawnTick = h.tickNow() + 50;
    h.runTick();
    expect(h.trades.size).toBe(0);

    h.p(A).state = PlayerState.Alive;
    requestTrade(h.as(A), { target: B });
    for (let i = 0; i < TRADE_REQUEST_TICKS; i++) h.runTick();
    expect(h.trades.size).toBe(1);
    h.runTick();
    expect(h.trades.size).toBe(0);
  });

  it('disconnecting cancels the trade', () => {
    openTrade();
    onDisconnect(h.as(B));
    expect(h.trades.size).toBe(0);
  });

  it('cancel is open to either side and ignores strangers', () => {
    const row = openTrade();
    cancelTrade(h.as(C), { tradeId: row.id });
    expect(h.trades.size).toBe(1);
    cancelTrade(h.as(B), { tradeId: row.id });
    expect(h.trades.size).toBe(0);
  });
});

describe('invite links and friends', () => {
  it('creates one short code per inviter and replaces it on renewal', () => {
    createInvite(h.as(A));
    expect(h.codes.size).toBe(1);
    const first = [...h.codes.values()][0];
    expect(first.code).toHaveLength(INVITE_CODE_LEN);
    expect(first.expiresAtMicros).toBe(h.micros() + INVITE_TTL_MICROS);
    h.advance();
    h.setRolls([0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9]);
    createInvite(h.as(A));
    expect(h.codes.size).toBe(1);
    expect([...h.codes.values()][0].code).not.toBe(first.code);
  });

  it('redeeming makes friends both ways and places the joiner beside the inviter', () => {
    h.p(B).x = 12; h.p(B).z = 12;
    createInvite(h.as(A));
    const code = [...h.codes.keys()][0];
    redeemInvite(h.as(B), { code: code.toLowerCase() });
    const b = h.p(B);
    expect(Math.max(Math.abs(b.x - 30), Math.abs(b.z - 30))).toBe(1);
    expect([...h.friends.values()].map((f) => `${f.owner.toHexString()}>${f.friend.toHexString()}`).sort()).toEqual(['a>b', 'b>a']);
    expect(h.notices.find((n) => n.to.toHexString() === 'b')?.text).toMatch(/joined Ann/);
  });

  it('a joiner without a stick lands at the nearest Grove tile when the inviter is past the brambles', () => {
    h.p(A).x = 25; h.p(A).z = 3; // the Coast, north
    h.p(B).x = 25; h.p(B).z = 40;
    createInvite(h.as(A));
    redeemInvite(h.as(B), { code: [...h.codes.keys()][0] });
    const b = h.p(B);
    expect(areaOf(b)).toBe('grove');
    expect(b.z).toBe(9);
    expect(h.notices.find((n) => n.to.toHexString() === 'b')?.text).toMatch(/stick/);
  });

  it('a joiner holding a stick can land on the Coast beside the inviter', () => {
    h.p(A).x = 25; h.p(A).z = 3;
    h.give(B, 0, STICK_ITEM_ID, 1);
    createInvite(h.as(A));
    redeemInvite(h.as(B), { code: [...h.codes.keys()][0] });
    expect(areaOf(h.p(B))).toBe('coast');
  });

  it('rejects expired, unknown and own codes; never moves a joiner mid-fight', () => {
    createInvite(h.as(A));
    const code = [...h.codes.keys()][0];
    h.advance();
    expect(() => redeemInvite(h.as(A), { code })).toThrow('own');
    h.advance();
    expect(() => redeemInvite(h.as(B), { code: 'ZZZZZZZZ' })).toThrow('expired');
    h.advance();
    h.p(C).x = 10; h.p(C).z = 10;
    h.p(B).hostile = true; h.p(B).combatTarget = C;
    redeemInvite(h.as(C), { code });
    expect(h.p(C).x).toBe(10);
    expect(h.notices.find((n) => n.to.toHexString() === 'c')?.text).toMatch(/fight/);
    h.setMicros(h.micros() + INVITE_TTL_MICROS + 1n);
    h.advance();
    expect(() => redeemInvite(h.as(B), { code })).toThrow('expired');
  });

  it('addFriend is one-way, idempotent, and removeFriend removes only your side', () => {
    addFriend(h.as(A), { target: B });
    h.advance();
    addFriend(h.as(A), { target: B });
    expect(h.friends.size).toBe(1);
    h.advance();
    expect(() => addFriend(h.as(A), { target: A })).toThrow();
    removeFriend(h.as(A), { target: B });
    expect(h.friends.size).toBe(0);
  });
});

describe('chat position for the Nearby filter', () => {
  it('records where the sender stood', () => {
    sendChat(h.as(B), { text: ' hello ' });
    const row = [...h.chat.values()][0];
    expect(row).toMatchObject({ text: 'hello', x: 31, z: 30 });
  });
});

describe('pure social rules', () => {
  it('chat filter: all shows everything; nearby is Chebyshev radius from you, unknown places are far', () => {
    const me = { x: 20, z: 20 };
    expect(chatVisible('all', me, { x: -1, z: -1 })).toBe(true);
    expect(chatVisible('nearby', me, { x: 20 + CHAT_NEARBY_RADIUS, z: 20 })).toBe(true);
    expect(chatVisible('nearby', me, { x: 20 + CHAT_NEARBY_RADIUS + 1, z: 20 })).toBe(false);
    expect(chatVisible('nearby', me, { x: -1, z: -1 })).toBe(false);
    expect(chatVisible('nearby', null, { x: 20, z: 20 })).toBe(false);
  });

  it('bubble text is one capped line', () => {
    expect(bubbleText('a\n  b')).toBe('a b');
    const long = bubbleText('x'.repeat(200));
    expect(long.length).toBe(CHAT_BUBBLE_MAX_CHARS);
    expect(long.endsWith('…')).toBe(true);
  });

  it('invite codes: alphabet, normalisation and a link that carries only the code', () => {
    const code = generateInviteCode(() => 0.3);
    expect(normalizeInviteCode(` ${code.slice(0, 4).toLowerCase()}-${code.slice(4)} `)).toBe(code);
    expect(normalizeInviteCode('O0O0O0O0')).toBeNull();
    expect(normalizeInviteCode('short')).toBeNull();
    const url = inviteUrl('https://game.example/play?token=secret#x', code);
    expect(url).toBe(`https://game.example/play?join=${code}`);
  });

  it('joinSpot avoids blocked tiles, the inviter and brambles without a stick', () => {
    const blocked = new Set([tileKey({ x: 29, z: 29 })]);
    const spot = joinSpot({ x: 30, z: 30 }, false, blocked);
    expect(spot.clamped).toBe(false);
    expect(blocked.has(tileKey(spot.tile))).toBe(false);
    expect(spot.tile).not.toEqual({ x: 30, z: 30 });
    const hedge = joinSpot({ x: 42, z: 30 }, false, new Set());
    expect(hedge.clamped).toBe(true);
    expect(isBramble(hedge.tile)).toBe(false);
    expect(areaOf(hedge.tile)).toBe('grove');
  });

  it('joinSpot never lands in the sea or past the boulder line without a club', () => {
    const noClub = joinSpot({ x: 57, z: 57 }, true, new Set());
    expect(noClub.clamped).toBe(true);
    expect(noClub.barrier).toBe('boulders');
    expect(areaOf(noClub.tile)).toBe('coast');
    const club = joinSpot({ x: 57, z: 57 }, true, new Set(), true);
    expect(club.clamped).toBe(false);
    expect(areaOf(club.tile)).toBe('boulders');
    const edge = joinSpot({ x: 49, z: 20 }, true, new Set());
    expect(edge.clamped).toBe(false);
    expect(areaOf(edge.tile)).not.toBe('sea');
    const noStick = joinSpot({ x: 57, z: 57 }, false, new Set(), true);
    expect(noStick.barrier).toBe('brambles');
    expect(areaOf(noStick.tile)).toBe('grove');
  });

  it('offers: canonical format, strict parsing', () => {
    expect(formatOffer([{ itemId: 'stick', quantity: 1 }, { itemId: 'berry_blueberry', quantity: 2 }, { itemId: 'stick', quantity: 0 }]))
      .toBe('berry_blueberry:2,stick:1');
    expect(parseOffer('berry_blueberry:2,stick:1')).toEqual([{ itemId: 'berry_blueberry', quantity: 2 }, { itemId: 'stick', quantity: 1 }]);
    for (const bad of ['stick', 'stick:0', 'stick:1,stick:1', 'unknown:1', 'stick:-1', 'STICK:1']) expect(parseOffer(bad)).toBeNull();
    expect(parseOffer('')).toEqual([]);
  });

  it('removeItemCount takes from the back of the bag first, keeping the quick bar', () => {
    const slots = emptySlots();
    slots[0] = { itemId: 'berry_blueberry', quantity: 3 };
    slots[10] = { itemId: 'berry_blueberry', quantity: 2 };
    const out = removeItemCount(slots, 'berry_blueberry', 3);
    expect(out[10]).toBeNull();
    expect(out[0]).toEqual({ itemId: 'berry_blueberry', quantity: 2 });
    expect(() => removeItemCount(slots, 'berry_blueberry', 6)).toThrow();
  });

  it('executeTrade never half-applies', () => {
    const a = emptySlots(); a[3] = { itemId: 'berry_blueberry', quantity: 1 };
    const b = emptySlots();
    const r = executeTrade({ slots: a, weapon: '', offer: [{ itemId: 'berry_blueberry', quantity: 2 }], name: 'A' }, { slots: b, weapon: '', offer: [], name: 'B' });
    expect(r.ok).toBe(false);
    expect(a[3]).toEqual({ itemId: 'berry_blueberry', quantity: 1 });
  });
});
