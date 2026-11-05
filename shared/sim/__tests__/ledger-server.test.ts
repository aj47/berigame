import { describe, expect, it, vi } from 'vitest';
import { A, R, spireHarness } from './spireHarness';
import { LEDGER_CLERK, LEDGER_CLERKS, LEDGER_RANGE, LEDGER_DAY_MS, LEDGER_SEAL_ITEM_ID, ledgerDay, ledgerFor } from '../ledger';
import { levelForXp } from '../skills';

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
import { tick } from '../../../spacetimedb/src/reducers/tick';
import { deliverCommission } from '../../../spacetimedb/src/reducers/ledger';

const XP = ['foragingXp', 'beachcombingXp', 'craftingXp'] as const;

function ledger() {
  const h = spireHarness(R(tick));
  const hex = A.toHexString();
  const nowMs = () => Number(h.ctx.timestamp.microsSinceUnixEpoch / 1000n);
  const xp = () => { const row = h.db.playerSkill.identity.find(A); return XP.map((f) => row?.[f] ?? 0); };
  const stored = () => { const row = h.db.frontierPrivate.key.find(`commissions:${hex}`); return row ? JSON.parse(row.data) : undefined; };
  const view = () => { const row = h.db.frontierView.key.find(`${hex}:ledger:${hex}`); return row && { ...row, data: JSON.parse(row.data) }; };
  /** Today's commission in `slot` as the server will compute it now. */
  const commission = (slot: number) => ledgerFor(hex, ledgerDay(nowMs()), xp().map(levelForXp), stored())[slot];
  const deliver = (slot: number) => R(deliverCommission)(h.as(A), { slot });
  const stock = (slot: number) => { const c = commission(slot); h.give(A, c.itemId, c.quantity); return c; };
  h.place(A, LEDGER_CLERK);
  return { ...h, hex, nowMs, xp, stored, view, commission, deliver, stock };
}

describe('Island Ledger (server)', () => {
  it('refuses hand-ins away from every clerk', () => {
    const h = ledger();
    h.stock(0);
    h.place(A, { x: LEDGER_CLERK.x + 10, z: LEDGER_CLERK.z });
    expect(() => h.deliver(0)).toThrow('Hand commissions in at a ledger clerk');
    expect(h.stored()).toBeUndefined();
  });

  it('takes hand-ins at the Crossroads clerk too, with the same draw', () => {
    const h = ledger();
    const crossroads = LEDGER_CLERKS.find((c) => c.id === 'crossroads')!;
    expect(crossroads).toMatchObject({ x: 172, z: 124 });
    const before = h.commission(0);
    h.place(A, { x: crossroads.x + LEDGER_RANGE, z: crossroads.z - LEDGER_RANGE });
    const c = h.stock(0);
    expect(c).toEqual(before);
    h.deliver(0);
    expect(h.count(A, c.itemId)).toBe(0);
    expect(h.count(A, LEDGER_SEAL_ITEM_ID)).toBe(1);
    expect(h.stored()).toMatchObject({ day: ledgerDay(h.nowMs()), done: 1 });
  });

  it('refuses a commission whose goods are not in the bag', () => {
    const h = ledger();
    const c = h.commission(0);
    h.give(A, c.itemId, c.quantity - 1);
    expect(() => h.deliver(0)).toThrow(`Bring ${c.quantity}`);
    expect(h.count(A, c.itemId)).toBe(c.quantity - 1);
    expect(h.stored()).toBeUndefined();
  });

  it('takes the goods, grants the XP and a seal, records and publishes the slot, and refuses it twice', () => {
    const h = ledger();
    const c = h.stock(0);
    h.give(A, c.itemId, 3); // a spare stack stays behind
    h.deliver(0);
    expect(h.count(A, c.itemId)).toBe(3);
    expect(h.xp()[c.skill]).toBe(c.xp);
    expect(h.count(A, LEDGER_SEAL_ITEM_ID)).toBe(1);
    const day = ledgerDay(h.nowMs());
    expect(h.stored()).toEqual({ id: h.hex, day, done: 1 });
    expect(h.view()).toMatchObject({ kind: 'ledger', source: `ledger:${h.hex}`, data: { id: h.hex, day, done: 1 } });
    expect(h.view().owner.toHexString()).toBe(h.hex);
    expect(h.commission(0).done).toBe(true);
    h.give(A, c.itemId, c.quantity);
    expect(() => h.deliver(0)).toThrow('already done');
    expect(h.count(A, LEDGER_SEAL_ITEM_ID)).toBe(1);
  });

  it('the third slot of the day pays the full-ledger bonus, and the next UTC day starts fresh', () => {
    const h = ledger();
    for (const slot of [1, 0]) { h.stock(slot); h.deliver(slot); }
    expect(h.count(A, LEDGER_SEAL_ITEM_ID)).toBe(2);
    h.stock(2); h.deliver(2);
    expect(h.count(A, LEDGER_SEAL_ITEM_ID)).toBe(5);
    expect(h.stored().done).toBe(7);
    expect(() => h.deliver(1)).toThrow('already done');

    h.ctx.timestamp = { microsSinceUnixEpoch: h.ctx.timestamp.microsSinceUnixEpoch + BigInt(LEDGER_DAY_MS) * 1000n };
    expect(h.commission(1).done).toBe(false);
    h.stock(1); h.deliver(1);
    expect(h.count(A, LEDGER_SEAL_ITEM_ID)).toBe(6);
    expect(h.stored()).toEqual({ id: h.hex, day: ledgerDay(h.nowMs()), done: 2 });
  });

  it('works with the expansion disabled and refuses a slot outside the three', () => {
    const h = ledger();
    expect(h.db.frontierObject.key.find('config:world')).toBeUndefined();
    expect(() => h.deliver(3)).toThrow('no such commission');
    h.stock(2); h.deliver(2);
    expect(h.stored().done).toBe(4);
  });

  it('refuses while fighting', () => {
    const h = ledger();
    h.stock(0);
    h.set(A, { hostile: true });
    expect(() => h.deliver(0)).toThrow('Not while fighting');
  });
});
