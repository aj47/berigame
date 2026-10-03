import { describe, expect, it } from 'vitest';
import { perform } from '../frontier/engine';
import { newProfile, type Actor, type Repository, type World } from '../frontier/model';
import { FRONTIER, REGIONS } from '../frontier/catalog';

function setup() {
  const data = new Map<string, any>();
  const repo: Repository = {
    get: (kind, id) => structuredClone(data.get(`${kind}:${id}`)),
    all: kind => [...data.entries()].filter(([key]) => key.startsWith(`${kind}:`)).map(([, value]) => structuredClone(value)),
    put: (kind, value) => { data.set(`${kind}:${value.id}`, structuredClone(value)); },
    remove: (kind, id) => { data.delete(`${kind}:${id}`); },
  };
  repo.put('config', { id: 'world', enabled: true, pausedAt: 0, sequence: 0 });
  repo.put('profile', newProfile('me'));
  const a: Actor = { id: 'me', region: 'settlement', ...REGIONS.settlement.spawn, online: true, alive: true, hp: 30, weapon: '', combat: false, hostile: false, bag: Array(28).fill(null) };
  const w: World = { repo, actors: [a], now: 100000, save: () => {} };
  const act = (target: string, item = 'timber', quantity = 1, id = 'vault-me') => perform(w, a, { action: 'container', id, target, item, quantity });
  return { repo, a, act };
}

describe('personal bank storage', () => {
  it('creates a 48-slot personal vault and transfers items in both directions', () => {
    const h = setup(); h.a.bag[0] = { itemId: 'timber', quantity: 5 };
    h.act('deposit', 'timber', 3);
    expect(h.repo.get('container', 'vault-me')?.slots).toHaveLength(FRONTIER.bankSlots);
    expect(h.a.bag[0]?.quantity).toBe(2);
    h.act('withdraw', 'timber', 2);
    expect(h.a.bag[0]?.quantity).toBe(4);
    expect(h.repo.get('container', 'vault-me')?.slots[0]?.quantity).toBe(1);
  });
  it('expands a full old six-slot vault without changing any saved items', () => {
    const h = setup();
    const slots = Array.from({ length: 6 }, () => ({ itemId: 'stone_club', quantity: 1 }));
    h.repo.put('container', { id: 'vault-me', owner: 'me', slots });
    h.a.bag[0] = { itemId: 'timber', quantity: 3 }; h.act('deposit', 'timber', 3);
    const stored = h.repo.get('container', 'vault-me')!.slots;
    expect(stored.slice(0, 6)).toEqual(slots);
    expect(stored[6]).toEqual({ itemId: 'timber', quantity: 3 });
    expect(stored).toHaveLength(48);
  });
  it('uses all 48 bank slots for weapons without reserving a quick bar', () => {
    const h = setup();
    h.repo.put('container', { id: 'vault-me', owner: 'me', slots: [null, null, null, ...Array.from({ length: 45 }, () => ({ itemId: 'stone_club', quantity: 1 }))] });
    h.a.bag[3] = { itemId: 'stone_club', quantity: 1 };
    h.act('deposit', 'stone_club');
    expect(h.repo.get('container', 'vault-me')?.slots[0]?.itemId).toBe('stone_club');
    h.act('withdraw', 'stone_club');
    expect(h.a.bag.slice(0, 3)).toEqual([null, null, null]);
    expect(h.a.bag[3]?.itemId).toBe('stone_club');
  });
  it('does not allow banking away from town or through someone else’s vault', () => {
    const h = setup(); h.a.bag[0] = { itemId: 'timber', quantity: 3 };
    h.repo.put('container', { id: 'vault-other', owner: 'other', slots: Array(6).fill(null) });
    expect(() => h.act('deposit', 'timber', 1, 'vault-other')).toThrow('town');
    h.a.region = 'bramblewild';
    expect(() => h.act('deposit')).toThrow('town');
    expect(h.repo.get('container', 'vault-me')).toBeUndefined();
    expect(h.a.bag[0]?.quantity).toBe(3);
  });
});
