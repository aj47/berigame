import { adventureTables } from './adventureHarness';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Pending, PlayerState } from '../types';
import { STICK_ITEM_ID, STONE_CLUB_ITEM_ID } from '../items';
import { HOTBAR_SIZE, INVENTORY_SIZE } from '../constants';
import { TRADE_BREAK_RANGE, TRADE_RANGE, TRADE_REQUEST_TICKS, executeTrade, formatOffer, parseOffer, removeItemCount } from '../trade';
import {
  CHAT_BUBBLE_MAX_CHARS, CHAT_NEARBY_RADIUS, INVITE_CODE_LEN, INVITE_TTL_MICROS, bubbleText, chatVisible, generateInviteCode,
  inviteUrl, joinSpot, normalizeInviteCode, MAX_FRIENDS,
} from '../friends';
import { areaOf, isBramble } from '../areas';
import { emptySlots } from '../inventory';
import { chebyshev, tileKey } from '../grid';
import { Cosmetic, hasCosmetic } from '../skills';
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
import { cancel as registeredStop, setTarget as registeredMove } from '../../../spacetimedb/src/reducers/movement';
import * as friendReducers from '../../../spacetimedb/src/reducers/friends';
import { onConnect as registeredConnect, onDisconnect as registeredDisconnect } from '../../../spacetimedb/src/reducers/lifecycle';
import { NOTICE_COOLDOWN_MICROS } from '../../../spacetimedb/src/lib/social';
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
const onConnect = R(registeredConnect);
const scheduledTick = R(registeredTick);
const sendChat = R(registeredChat);
const stop = R(registeredStop);
const move = R(registeredMove);

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
  const pairs = new Map<string, any>();
  const stats = new Map<string, any>();
  const chat = new Map<bigint, any>();
  let nextChat = 1n;
  const trees = new Map<number, any>();
  const dummies = new Map<number, any>();
  const giants = new Map<number, any>();
  const cosmetics = new Map<string, any>();
  const raids = new Map<number, any>();
  const mentees = new Map<string, any>();
  const mentorStats = new Map<string, any>();
  const byId = (map: Map<string, any>) => ({
    insert: (row: any) => { map.set(row.identity.toHexString(), row); return row; },
    identity: { find: (id: any) => map.get(id.toHexString()), update: (row: any) => map.set(row.identity.toHexString(), row) },
  });
  let rolls: number[] = [];
  const ctx: any = {
    random: vi.fn(() => (rolls.length ? rolls.shift()! : 0.5)),
    sender: A, identity: identity('module'),
    get timestamp() { return { microsSinceUnixEpoch: micros }; },
    db: {
      ...adventureTables(),
      accessPolicy: { id: { find: () => ({ id: 0, owner: identity('owner'), gateway: identity('gw'), requireAdmission: false }) } },
      playerGrant: { identity: { find: () => undefined } },
      world: { id: { find: () => ({ id: 0, tick: now }), update: (row: any) => { now = row.tick; } } },
      player: { iter: () => players.values(), count: () => BigInt(players.size), insert: (p: any) => players.set(p.identity.toHexString(), p), identity: {
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
      socialPair: { insert: (row: any) => pairs.set(row.pair, row), pair: { find: (k: string) => pairs.get(k), update: (row: any) => pairs.set(row.pair, row) } },
      playStats: {
        insert: (row: any) => stats.set(row.identity.toHexString(), row),
        identity: { find: (id: any) => stats.get(id.toHexString()), update: (row: any) => stats.set(row.identity.toHexString(), row) },
      },
      giant: { iter: () => giants.values(), insert: (row: any) => { giants.set(row.id, row); return row; }, id: { find: (id: number) => giants.get(id), update: (row: any) => giants.set(row.id, row) } },
      giantContribution: { iter: () => [][Symbol.iterator](), identity: { find: () => undefined, delete: () => {} } },
      giantEvent: { insert: vi.fn() },
      playerCosmetic: { insert: (row: any) => cosmetics.set(row.identity.toHexString(), row), identity: { find: (id: any) => cosmetics.get(id.toHexString()), update: (row: any) => cosmetics.set(row.identity.toHexString(), row) } },
      giantRaid: { insert: (row: any) => { raids.set(row.id, row); return row; }, id: { find: (id: number) => raids.get(id), update: (row: any) => raids.set(row.id, row) } },
      mentee: byId(mentees),
      mentorStat: byId(mentorStats),
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
    ctx, cosmetics, mentees, mentorStats, pairs, stats, players, trades, friends, codes, notices, chat, give, slotsOf, count, as, advance,
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
/** Confirm on both sides inside the safe ring, where no attack can land, so the swap runs at once. */
function bothConfirm() {
  Object.assign(h.p(A), { x: 24, z: 25 });
  Object.assign(h.p(B), { x: 25, z: 25 });
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

  it('allows offering a wielded weapon without changing equipment, but rejects missing items', () => {
    h.give(A, 0, STICK_ITEM_ID, 1);
    h.give(A, 3, 'berry_blueberry', 1);
    h.p(A).weapon = STICK_ITEM_ID;
    const row = openTrade();
    const before = h.slotsOf(A);
    setTradeOffer(h.as(A), { tradeId: row.id, offer: `${STICK_ITEM_ID}:1` });
    expect(current().aOffer).toBe(`${STICK_ITEM_ID}:1`);
    expect(h.p(A).weapon).toBe(STICK_ITEM_ID);
    expect(h.slotsOf(A)).toEqual(before);
    h.advance();
    expect(() => setTradeOffer(h.as(A), { tradeId: row.id, offer: 'berry_blueberry:2' })).toThrow('do not have');
    h.advance();
    expect(() => setTradeOffer(h.as(A), { tradeId: row.id, offer: 'nonsense' })).toThrow('bad offer');
  });

  it('completes the trade when an offered weapon is wielded before confirmation', () => {
    h.give(A, 0, STICK_ITEM_ID, 1);
    h.give(B, 3, 'berry_blueberry', 4);
    const row = openTrade();
    setTradeOffer(h.as(A), { tradeId: row.id, offer: `${STICK_ITEM_ID}:1` });
    h.advance();
    setTradeOffer(h.as(B), { tradeId: row.id, offer: 'berry_blueberry:4' });
    h.advance();
    h.p(A).weapon = STICK_ITEM_ID; // wielded after offering
    bothConfirm();
    expect(h.trades.size).toBe(0);
    expect(h.count(A, STICK_ITEM_ID)).toBe(0);
    expect(h.count(A, 'berry_blueberry')).toBe(4);
    expect(h.slotsOf(B)[HOTBAR_SIZE]).toEqual({ itemId: STICK_ITEM_ID, quantity: 1 });
    expect(h.p(A).weapon).toBe('');
    expect(h.p(B).weapon).toBe('');
    expect(h.notices.filter(n => n.kind === 5)).toHaveLength(2);
  });

  it('puts away both players’ traded weapons and does not equip the received weapons', () => {
    h.give(A, 0, STICK_ITEM_ID, 1);
    h.give(B, 2, STONE_CLUB_ITEM_ID, 1);
    h.p(A).weapon = STICK_ITEM_ID;
    h.p(B).weapon = STONE_CLUB_ITEM_ID;
    const row = openTrade();
    setTradeOffer(h.as(A), { tradeId: row.id, offer: `${STICK_ITEM_ID}:1` });
    h.advance();
    setTradeOffer(h.as(B), { tradeId: row.id, offer: `${STONE_CLUB_ITEM_ID}:1` });
    bothConfirm();
    expect(h.trades.size).toBe(0);
    expect(h.slotsOf(A)[0]).toBeNull();
    expect(h.slotsOf(B)[2]).toBeNull();
    expect(h.slotsOf(A)[HOTBAR_SIZE]).toEqual({ itemId: STONE_CLUB_ITEM_ID, quantity: 1 });
    expect(h.slotsOf(B)[HOTBAR_SIZE]).toEqual({ itemId: STICK_ITEM_ID, quantity: 1 });
    expect(h.p(A).weapon).toBe('');
    expect(h.p(B).weapon).toBe('');
  });

  it.each([1, 2])('trades %i spare sticks from the bag first and keeps any remaining quick-slot copy wielded', quantity => {
    h.give(A, 0, STICK_ITEM_ID, 1);
    h.give(A, 2, STICK_ITEM_ID, 1);
    h.give(A, 8, STICK_ITEM_ID, 1);
    h.give(B, 1, STICK_ITEM_ID, 1);
    h.p(A).weapon = STICK_ITEM_ID;
    h.p(B).weapon = STICK_ITEM_ID;
    const row = openTrade();
    setTradeOffer(h.as(A), { tradeId: row.id, offer: `${STICK_ITEM_ID}:${quantity}` });
    bothConfirm();
    expect(h.slotsOf(A)[8]).toBeNull();
    expect(h.slotsOf(A)[2]).toEqual(quantity === 1 ? { itemId: STICK_ITEM_ID, quantity: 1 } : null);
    expect(h.slotsOf(A)[0]).toEqual({ itemId: STICK_ITEM_ID, quantity: 1 });
    expect(h.count(B, STICK_ITEM_ID)).toBe(quantity + 1);
    expect(h.p(A).weapon).toBe(STICK_ITEM_ID);
    expect(h.p(B).weapon).toBe(STICK_ITEM_ID);
  });

  it('does not keep a weapon wielded when the same weapon is received back into the bag', () => {
    h.give(A, 0, STICK_ITEM_ID, 1);
    h.give(B, 1, STICK_ITEM_ID, 1);
    h.p(A).weapon = STICK_ITEM_ID;
    h.p(B).weapon = STICK_ITEM_ID;
    const row = openTrade();
    setTradeOffer(h.as(A), { tradeId: row.id, offer: `${STICK_ITEM_ID}:1` });
    h.advance();
    setTradeOffer(h.as(B), { tradeId: row.id, offer: `${STICK_ITEM_ID}:1` });
    bothConfirm();
    for (const owner of [A, B]) {
      expect(h.slotsOf(owner).slice(0, HOTBAR_SIZE)).toEqual([null, null, null]);
      expect(h.slotsOf(owner)[HOTBAR_SIZE]).toEqual({ itemId: STICK_ITEM_ID, quantity: 1 });
      expect(h.p(owner).weapon).toBe('');
    }
  });

  it('keeps equipment and both inventories unchanged after one confirmation and cancellation', () => {
    h.give(A, 0, STICK_ITEM_ID, 1);
    h.give(B, 1, STONE_CLUB_ITEM_ID, 1);
    h.p(A).weapon = STICK_ITEM_ID;
    h.p(B).weapon = STONE_CLUB_ITEM_ID;
    const row = openTrade();
    setTradeOffer(h.as(A), { tradeId: row.id, offer: `${STICK_ITEM_ID}:1` });
    const beforeA = h.slotsOf(A), beforeB = h.slotsOf(B);
    confirmTrade(h.as(A), { tradeId: row.id, aOffer: current().aOffer, bOffer: current().bOffer });
    expect(current().aConfirmed).toBe(true);
    expect(h.slotsOf(A)).toEqual(beforeA);
    expect(h.slotsOf(B)).toEqual(beforeB);
    expect(h.p(A).weapon).toBe(STICK_ITEM_ID);
    expect(h.p(B).weapon).toBe(STONE_CLUB_ITEM_ID);
    h.advance();
    cancelTrade(h.as(B), { tradeId: row.id });
    expect(h.trades.size).toBe(0);
    expect(h.slotsOf(A)).toEqual(beforeA);
    expect(h.slotsOf(B)).toEqual(beforeB);
    expect(h.p(A).weapon).toBe(STICK_ITEM_ID);
    expect(h.p(B).weapon).toBe(STONE_CLUB_ITEM_ID);
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

  it('preserves both inventories and wielded weapons when the receiving bag is full', () => {
    h.give(A, 0, STICK_ITEM_ID, 1);
    h.give(B, 0, STONE_CLUB_ITEM_ID, 1);
    for (let i = 1; i < INVENTORY_SIZE; i++) h.give(B, i, 'berry_greenberry', 99);
    h.p(A).weapon = STICK_ITEM_ID;
    h.p(B).weapon = STONE_CLUB_ITEM_ID;
    const row = openTrade();
    const beforeA = h.slotsOf(A), beforeB = h.slotsOf(B);
    setTradeOffer(h.as(A), { tradeId: row.id, offer: `${STICK_ITEM_ID}:1` });
    bothConfirm();
    expect(h.trades.size).toBe(1);
    expect(current().aConfirmed || current().bConfirmed).toBe(false);
    expect(h.slotsOf(A)).toEqual(beforeA);
    expect(h.slotsOf(B)).toEqual(beforeB);
    expect(h.p(A).weapon).toBe(STICK_ITEM_ID);
    expect(h.p(B).weapon).toBe(STONE_CLUB_ITEM_ID);
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

  it('a nearby counter-request accepts; one trade at a time', () => {
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

describe('walk into range to trade', () => {
  function separate() {
    Object.assign(h.p(A), { x: 22, z: 25 });
    Object.assign(h.p(B), { x: 31, z: 25 });
  }
  function arrive(maxTicks = 30) {
    for (let i = 0; i < maxTicks && !h.trades.size; i++) h.runTick();
    expect(h.trades.size).toBe(1);
    expect(chebyshev(h.p(A), h.p(B))).toBeLessThanOrEqual(TRADE_RANGE);
  }
  it('walks at normal speed, sends one request on arrival, and stops following', () => {
    separate();
    requestTrade(h.as(A), { target: B });
    expect(h.p(A)).toMatchObject({ pending: Pending.Trade, combatTarget: B, hostile: false });
    expect(h.trades.size).toBe(0);
    const start = { ...h.p(A) };
    h.runTick();
    expect(chebyshev(start, h.p(A))).toBe(2);
    expect(h.trades.size).toBe(0);
    arrive();
    expect(h.p(A)).toMatchObject({ pending: Pending.None, combatTarget: undefined });
    expect(current()).toMatchObject({ a: A, b: B, accepted: false });
    const atArrival = { ...h.p(A) };
    for (let i = 0; i < 4; i++) h.runTick();
    expect(h.trades.size).toBe(1);
    expect(chebyshev(atArrival, h.p(A))).toBe(0);
    expect(h.notices.filter(n => n.text === 'Ann wants to trade')).toHaveLength(1);
  });
  it('tracks a moving partner and waits until both final positions are in range', () => {
    separate();
    move(h.as(B), { x: 34, z: 29 });
    requestTrade(h.as(A), { target: B });
    arrive();
  });
  it('handles reciprocal approaches without duplicate trades', () => {
    separate();
    requestTrade(h.as(A), { target: B });
    requestTrade(h.as(B), { target: A });
    arrive();
    expect(current().accepted).toBe(true);
    expect(h.p(B).pending).toBe(Pending.None);
  });
  it.each(['stop', 'move'])('cancels the queued request when the player chooses %s', (action) => {
    separate();
    requestTrade(h.as(A), { target: B });
    h.runTick();
    if (action === 'stop') stop(h.as(A));
    else move(h.as(A), { x: 23, z: 27 });
    for (let i = 0; i < 12; i++) h.runTick();
    expect(h.trades.size).toBe(0);
    expect(h.p(A)).toMatchObject({ pending: Pending.None, combatTarget: undefined });
  });
  it.each(['offline', 'dead', 'busy'])('cancels if the partner becomes %s while approaching', (reason) => {
    separate();
    requestTrade(h.as(A), { target: B });
    if (reason === 'offline') onDisconnect(h.as(B));
    else if (reason === 'dead') Object.assign(h.p(B), { state: PlayerState.Dead, respawnTick: h.tickNow() + 100 });
    else h.ctx.db.trade.insert({ id: 0n, a: B, b: C, accepted: true, aOffer: '', bOffer: '', aConfirmed: false, bConfirmed: false, createdTick: h.tickNow() });
    h.runTick();
    expect(h.p(A)).toMatchObject({ pending: Pending.None, combatTarget: undefined });
    expect([...h.trades.values()].some(t => t.a === A || t.b === A)).toBe(false);
    expect(h.notices.some(n => /not available|busy trading/.test(n.text))).toBe(true);
  });
  it('stops and explains an unreachable partner instead of bypassing route locks', () => {
    separate();
    Object.assign(h.p(B), { x: 60, z: 40 });
    requestTrade(h.as(A), { target: B });
    h.runTick();
    expect(h.p(A)).toMatchObject({ x: 22, z: 25, pending: Pending.None, combatTarget: undefined });
    expect(h.trades.size).toBe(0);
    expect(h.notices.some(n => n.text === 'Cannot reach them to trade')).toBe(true);
  });
  it('being hit cancels the approach without leaving a follow target', () => {
    Object.assign(h.p(A), { x: 20, z: 34 });
    Object.assign(h.p(B), { x: 30, z: 34 });
    Object.assign(h.p(C), { x: 21, z: 33, hostile: true, combatTarget: A, nextSwingTick: 0 });
    requestTrade(h.as(A), { target: B });
    h.runTick();
    expect(h.p(A).hp).toBeLessThan(30);
    expect(h.p(A)).toMatchObject({ pending: Pending.None, combatTarget: undefined });
    expect(h.trades.size).toBe(0);
  });
  it('replaces a pending partner and keeps repeated requests idempotent', () => {
    separate();
    Object.assign(h.p(C), { x: 30, z: 30 });
    requestTrade(h.as(A), { target: B });
    h.advance();
    requestTrade(h.as(A), { target: C });
    h.advance();
    requestTrade(h.as(A), { target: C });
    for (let i = 0; i < 30 && !h.trades.size; i++) h.runTick();
    expect(h.trades.size).toBe(1);
    expect(current().b).toBe(C);
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
    // Landing past the hedge earns the Coast Scarf, as walking there does.
    expect(hasCosmetic(h.cosmetics.get('b')?.unlocked ?? 0, Cosmetic.CoastScarf)).toBe(true);
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

describe('notice cooldowns and single-use invite codes', () => {
  const to = (id: any) => h.notices.filter((n) => n.to.toHexString() === id.toHexString());

  it('addFriend notifies once per pair: re-adds and add/remove loops send nothing more', () => {
    for (let i = 0; i < 5; i++) {
      addFriend(h.as(A), { target: B });
      removeFriend(h.as(A), { target: B });
      h.setMicros(h.micros() + NOTICE_COOLDOWN_MICROS + 1n);
      h.advance();
    }
    addFriend(h.as(A), { target: B });
    expect(h.friends.size).toBe(1);
    expect(to(B).map((n) => n.text)).toEqual(['Ann added you as a friend']);
  });

  it('trade request/cancel loops send at most one notice per cooldown', () => {
    for (let i = 0; i < 6; i++) {
      requestTrade(h.as(A), { target: B });
      cancelTrade(h.as(A), { tradeId: current().id });
      h.advance();
    }
    expect(to(B)).toHaveLength(1);
    expect(to(B)[0].text).toBe('Ann wants to trade');
    // The requester still hears about their own cancellations.
    expect(to(A).length).toBe(6);
    h.setMicros(h.micros() + NOTICE_COOLDOWN_MICROS);
    requestTrade(h.as(A), { target: B });
    expect(to(B)).toHaveLength(2);
    // The trade row itself is never throttled.
    expect(h.trades.size).toBe(1);
  });

  it('cancelling an accepted trade always tells the partner', () => {
    const row = openTrade();
    cancelTrade(h.as(A), { tradeId: row.id });
    expect(to(B).map((n) => n.text)).toContain('Ann cancelled the trade');
  });

  it('a code is single-use per joiner: redeeming it again does not move them', () => {
    h.p(B).x = 12; h.p(B).z = 12;
    createInvite(h.as(A));
    const code = [...h.codes.keys()][0];
    redeemInvite(h.as(B), { code });
    expect(h.p(B).x).not.toBe(12);
    h.p(B).x = 12; h.p(B).z = 12;
    const before = h.notices.length;
    redeemInvite(h.as(B), { code });
    expect(h.p(B)).toMatchObject({ x: 12, z: 12 });
    const fresh = h.notices.slice(before);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].to.toHexString()).toBe('b');
    expect(fresh[0].text).toMatch(/already used/);
    // Another joiner can still use it.
    h.p(C).x = 12; h.p(C).z = 12;
    redeemInvite(h.as(C), { code });
    expect(h.p(C).x).not.toBe(12);
  });

  it('a full friends list is reported, never claimed as a friendship', () => {
    for (let i = 0; i < MAX_FRIENDS; i++) h.friends.set(BigInt(1000 + i), { id: BigInt(1000 + i), owner: B, friend: identity(`x${i}`) });
    createInvite(h.as(A));
    redeemInvite(h.as(B), { code: [...h.codes.keys()][0] });
    const text = to(B)[0].text;
    expect(text).not.toMatch(/is your friend now/);
    expect(text).toMatch(/friends list is full/);
    expect(to(A)[0].text).toMatch(/joined with your invite link and is on your friends list/);
  });
});

describe('play_stats sessions', () => {
  const D = identity('d');
  it('a stale open session (module restart) is closed out and a new one starts', () => {
    onConnect(h.as(D));
    const first = h.stats.get('d');
    expect(first.sessions).toBe(1);
    // Module restart: the disconnect never ran, so the stats row still looks open.
    h.p(D).online = false; h.p(D).connections = 0;
    h.setMicros(h.micros() + 5_000_000n);
    onConnect(h.as(D));
    const second = h.stats.get('d');
    expect(second.sessions).toBe(2);
    expect(second.totalPlayMicros).toBe(5_000_000n);
    expect(second.sessionStartedAt.microsSinceUnixEpoch).toBe(h.micros());
  });
  it('a second tab of an online player does not start a session', () => {
    onConnect(h.as(D));
    h.setMicros(h.micros() + 1_000_000n);
    onConnect(h.as(D));
    expect(h.stats.get('d')).toMatchObject({ sessions: 1, totalPlayMicros: 0n });
    onDisconnect(h.as(D)); onDisconnect(h.as(D));
    expect(h.stats.get('d').totalPlayMicros).toBe(1_000_000n);
    onConnect(h.as(D));
    expect(h.stats.get('d').sessions).toBe(2);
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
    const edge = joinSpot({ x: 48, z: 25 }, true, new Set());
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
    const r = executeTrade({ slots: a, offer: [{ itemId: 'berry_blueberry', quantity: 2 }], name: 'A' }, { slots: b, offer: [], name: 'B' });
    expect(r.ok).toBe(false);
    expect(a[3]).toEqual({ itemId: 'berry_blueberry', quantity: 1 });
  });
});

// ---- Mentor rewards ------------------------------------------------------------
import { mentorMilestone } from '../../../spacetimedb/src/lib/mentor';
import { MENTOR_MIN_AGE_MS, MENTOR_RANGE, MentorMilestone } from '../mentor';
import { SocialNotice } from '../friends';

describe('mentor rewards: keepsakes when a veteran helps a newcomer', () => {
  const DAY_US = BigInt(MENTOR_MIN_AGE_MS) * 1000n;
  const T0 = 10n * DAY_US;
  /** play_stats rows: `joinedDaysAgo` relative to T0, optional first craft (micros). */
  function joined(id: any, joinedAtMicros: bigint, firstCraftAt?: bigint) {
    h.stats.set(id.toHexString(), {
      identity: id, firstJoinAt: { microsSinceUnixEpoch: joinedAtMicros }, lastSeenAt: { microsSinceUnixEpoch: joinedAtMicros },
      firstCraftAt: firstCraftAt === undefined ? undefined : { microsSinceUnixEpoch: firstCraftAt },
      sessions: 1, totalPlayMicros: 0n, deaths: 0, lastStep: 'join',
    });
  }
  const has = (who: string, c: number) => hasCosmetic(h.cosmetics.get(who)?.unlocked ?? 0, c);
  const befriend = (a: any, b: any) => h.friends.set(BigInt(h.friends.size + 100), { id: BigInt(h.friends.size + 100), owner: a, friend: b, since: {} });
  const credited = (who: string) => h.mentees.get(who)?.mentor?.toHexString();

  beforeEach(() => {
    h.setMicros(T0);
    joined(A, T0 - 3n * DAY_US); // Ann: the veteran
    joined(B, T0 - 1000n);       // Bo: the newcomer
    joined(C, T0 - 2000n);       // Cy: another newcomer
  });

  it('the inviter who is a day older mentors the newcomer landing on the Coast: both get a keepsake and a notice', () => {
    h.p(A).x = 25; h.p(A).z = 3;
    h.give(B, 0, STICK_ITEM_ID, 1);
    createInvite(h.as(A));
    redeemInvite(h.as(B), { code: [...h.codes.keys()][0] });
    expect(credited('b')).toBe('a');
    expect(has('b', Cosmetic.WelcomedRibbon)).toBe(true);
    expect(has('a', Cosmetic.MentorPin)).toBe(true);
    expect(h.mentorStats.get('a').mentees).toBe(1);
    const mentorNotices = h.notices.filter((n) => n.kind === SocialNotice.Mentor);
    expect(mentorNotices.map((n) => n.to.toHexString()).sort()).toEqual(['a', 'b']);
    expect(mentorNotices.find((n) => n.to.toHexString() === 'a').text).toMatch(/Bo reached the Coast with your help/);
  });

  it('one credit per newcomer: the club milestone later credits nobody again', () => {
    createInvite(h.as(A));
    redeemInvite(h.as(B), { code: [...h.codes.keys()][0] });
    mentorMilestone(h.ctx, h.p(B), MentorMilestone.Coast);
    mentorMilestone(h.ctx, h.p(B), MentorMilestone.Club);
    expect(h.mentorStats.get('a').mentees).toBe(1);
    expect(h.notices.filter((n) => n.kind === SocialNotice.Mentor)).toHaveLength(2);
  });

  it('a milestone already passed without a mentor never counts again (no retroactive farming)', () => {
    mentorMilestone(h.ctx, h.p(B), MentorMilestone.Coast); // nobody helped
    befriend(A, B); befriend(B, A);
    mentorMilestone(h.ctx, h.p(B), MentorMilestone.Coast);
    expect(credited('b')).toBeUndefined();
    expect(h.mentees.get('b').milestones).toBe(MentorMilestone.Coast);
    // The next, different milestone can still be mentored.
    mentorMilestone(h.ctx, h.p(B), MentorMilestone.Club);
    expect(credited('b')).toBe('a');
  });

  it('an inviter who is not the veteran (a fresh alt) earns nothing', () => {
    joined(A, T0 - 5000n);
    createInvite(h.as(A));
    redeemInvite(h.as(B), { code: [...h.codes.keys()][0] });
    mentorMilestone(h.ctx, h.p(B), MentorMilestone.Club);
    expect(credited('b')).toBeUndefined();
    expect(h.mentorStats.get('a')).toBeUndefined();
    expect(has('b', Cosmetic.WelcomedRibbon)).toBe(false);
  });

  it('a same-day player who had already crafted before the newcomer joined counts as the veteran', () => {
    joined(A, T0 - 5000n, T0 - 4000n);
    befriend(A, B); befriend(B, A);
    mentorMilestone(h.ctx, h.p(B), MentorMilestone.Club);
    expect(credited('b')).toBe('a');
  });

  it('a friend must be mutual, online, alive and within range', () => {
    befriend(B, A); // one-way
    mentorMilestone(h.ctx, h.p(B), MentorMilestone.Coast);
    expect(credited('b')).toBeUndefined();
    befriend(A, B);
    h.p(A).x = h.p(B).x + MENTOR_RANGE + 1;
    mentorMilestone(h.ctx, h.p(B), MentorMilestone.Club);
    expect(credited('b')).toBeUndefined();
    // Cy: A is near but offline, then online.
    befriend(A, C); befriend(C, A);
    h.p(A).x = h.p(C).x + 2; h.p(A).online = false;
    mentorMilestone(h.ctx, h.p(C), MentorMilestone.Coast);
    expect(credited('c')).toBeUndefined();
    h.p(A).online = true;
    mentorMilestone(h.ctx, h.p(C), MentorMilestone.Club);
    expect(credited('c')).toBe('a');
  });

  it('pin tiers at 3 and 10 mentees (cosmetic only)', () => {
    h.mentorStats.set('a', { identity: A, mentees: 2 });
    befriend(A, B); befriend(B, A);
    mentorMilestone(h.ctx, h.p(B), MentorMilestone.Coast);
    expect(h.mentorStats.get('a').mentees).toBe(3);
    expect(has('a', Cosmetic.MentorPinSilver)).toBe(true);
    expect(has('a', Cosmetic.MentorPinGold)).toBe(false);
    h.mentorStats.set('a', { identity: A, mentees: 9 });
    befriend(A, C); befriend(C, A);
    mentorMilestone(h.ctx, h.p(C), MentorMilestone.Coast);
    expect(has('a', Cosmetic.MentorPinGold)).toBe(true);
    expect(h.p(A).maxHp).toBe(30);
  });

  it('nobody mentors themselves', () => {
    befriend(B, B);
    mentorMilestone(h.ctx, h.p(B), MentorMilestone.Coast);
    expect(credited('b')).toBeUndefined();
  });
});
