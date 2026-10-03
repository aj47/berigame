import { describe, expect, it } from 'vitest';
import { perform, validateCommand } from '../frontier/engine';
import { DAY, REGIONS } from '../frontier/catalog';
import { newProfile, type Actor, type Repository, type World } from '../frontier/model';

function fixture() {
  let data = new Map<string, any>();
  const repo: Repository = {
    get: (kind, id) => structuredClone(data.get(`${kind}:${id}`)),
    all: kind => [...data.entries()].filter(([key]) => key.startsWith(`${kind}:`)).map(([, value]) => structuredClone(value)),
    put: (kind, value) => { data.set(`${kind}:${value.id}`, structuredClone(value)); },
    remove: (kind, id) => { data.delete(`${kind}:${id}`); },
  };
  const actor: Actor = { id: 'me', region: 'settlement', ...REGIONS.settlement.spawn, online: true, alive: true,
    hp: 30, bag: Array(28).fill(null), weapon: '', hostile: false, combat: true };
  const world: World = { repo, actors: [actor], now: 10 * DAY, save() {} };
  repo.put('config', { id: 'world', enabled: true, pausedAt: 0, sequence: 0 });
  repo.put('profile', { ...newProfile(actor.id), coins: 100, xp: [10, 20, 30, 40, 50] });
  const profile = () => repo.get('profile', actor.id)!;
  const act = (command: unknown) => {
    const original = structuredClone(data);
    try { perform(world, actor, command); } catch (e) { data = original; throw e; }
  };
  const first = () => act({ action: 'specialize', disciplines: [0, 2] });
  const next = (earlySwitch = false) => act({ action: 'specialize', disciplines: [1, 3], earlySwitch });
  return { repo, actor, world, profile, act, first, next };
}

describe('specialization switch pricing and authorization', () => {
  it.each([false, true])('keeps the first pair free even with earlySwitch=%s', earlySwitch => {
    const h = fixture(); h.repo.put('profile', { ...h.profile(), coins: 0 });
    h.act({ action: 'specialize', disciplines: [0, 2], earlySwitch });
    expect(h.profile()).toMatchObject({ active: [0, 2], coins: 0, switchedAt: h.world.now });
    expect(h.repo.all('ledger')).toHaveLength(0);
  });

  it('requires explicit early payment during the wait, then charges 20 exactly at the deadline', () => {
    const h = fixture(); h.first(); h.world.now += DAY - 1;
    expect(h.next).toThrow('50 coins total');
    expect(h.profile()).toMatchObject({ active: [0, 2], coins: 100 });
    h.world.now++; h.next();
    expect(h.profile()).toMatchObject({ active: [1, 3], coins: 80, switchedAt: h.world.now, xp: [10, 20, 30, 40, 50] });
    expect(h.repo.all('ledger')).toEqual([expect.objectContaining({ amount: -20, reason: 'specialization' })]);
  });

  it('charges 50 total for an explicit early switch and restarts the normal cooldown', () => {
    const h = fixture(); h.first(); h.world.now += 60_000; h.next(true);
    expect(h.profile()).toMatchObject({ active: [1, 3], coins: 50, switchedAt: h.world.now, xp: [10, 20, 30, 40, 50] });
    expect(h.repo.all('ledger')).toEqual([expect.objectContaining({ amount: -50, reason: 'early specialization change' })]);
    h.world.now += DAY - 1; expect(h.first).toThrow('24 hours');
    h.world.now++; h.first(); expect(h.profile().coins).toBe(30);
  });

  it('charges only the normal price if the cooldown expires after an early-switch button was shown', () => {
    const h = fixture(); h.first(); h.world.now += DAY; h.next(true);
    expect(h.profile().coins).toBe(80);
  });

  it.each([{ early: true, coins: 49, elapsed: 1000 }, { early: false, coins: 19, elapsed: DAY }])('rejects insufficient funds without changing the pair or deadline: %j', ({ early, coins, elapsed }) => {
    const h = fixture(); h.first(); h.repo.put('profile', { ...h.profile(), coins }); const before = h.profile();
    h.world.now += elapsed; expect(() => h.next(early)).toThrow('Not enough coins');
    expect(h.profile()).toEqual(before); expect(h.repo.all('ledger')).toHaveLength(0);
  });

  it('makes duplicate submissions and reversed active pairs free no-ops without resetting the wait', () => {
    const h = fixture(); h.first(); const before = h.profile(); h.world.now += 1000;
    h.first(); h.act({ action: 'specialize', disciplines: [2, 0], earlySwitch: true });
    expect(h.profile()).toEqual(before); expect(h.repo.all('ledger')).toHaveLength(0);
    h.next(true); const paid = h.profile(); h.world.now += 1000; h.next(true);
    expect(h.profile()).toEqual(paid); expect(h.repo.all('ledger')).toHaveLength(1);
  });

  it('still requires exactly two distinct valid disciplines and a boolean opt-in', () => {
    const h = fixture(); h.first(); const before = h.profile();
    for (const disciplines of [[1, 1], [1], [1, 2, 3], [1, 5]]) {
      expect(() => h.act({ action: 'specialize', disciplines, earlySwitch: true })).toThrow('different disciplines');
    }
    expect(() => h.act({ action: 'specialize', disciplines: [1, 3], earlySwitch: 'true' })).toThrow('true or false');
    expect(() => validateCommand({ action: 'talk', id: 'steward', earlySwitch: true })).toThrow('specialization action');
    expect(h.profile()).toEqual(before); expect(h.repo.all('ledger')).toHaveLength(0);
  });

  it.each(['outside town', 'hostile', 'recent conflict', 'boat', 'contest'] as const)('cannot pay to bypass the existing %s restriction', restriction => {
    const h = fixture(); h.first(); const before = h.profile();
    if (restriction === 'outside town') h.actor.x += 10;
    if (restriction === 'hostile') h.actor.hostile = true;
    if (restriction === 'recent conflict') h.repo.put('profile', { ...before, events: { hostileUntil: h.world.now + 1000 } });
    if (restriction === 'boat') h.repo.put('boat', { ...h.actor, id: 'boat', region: 'settlement', owner: 'me', permissions: {}, crew: ['me'], pilot: 'me', lastPort: 'bramblewild', emptySince: 0 });
    if (restriction === 'contest') h.repo.put('claim', { id: 'settlement-1', owner: 'other', tier: 0, paidUntil: 0, cooldownUntil: 0, permissions: {},
      challenge: { by: 'me', opens: h.world.now, closes: h.world.now + 1000, heldSince: 0, deposit: 0, attackers: ['me'], defenders: [] } });
    expect(() => h.next(true)).toThrow('outside conflict and voyages');
    expect(h.profile().coins).toBe(before.coins); expect(h.profile().switchedAt).toBe(before.switchedAt);
    expect(h.repo.all('ledger')).toHaveLength(0);
  });
});
