import { describe, expect, it } from 'vitest';
import { countItem } from '../inventory';
import { perform, validateCommand } from '../frontier/engine';
import { PLOTS, PORTS } from '../frontier/catalog';
import { newProfile, type Actor, type Repository, type World } from '../frontier/model';
import { regionLand, regionalPath } from '../frontier/regions';
import { frontierSnapshot } from '../frontier/snapshot';
import { ISLAND_SHRINES, awardDisciplineXp, shrineRestored, shrineXpBonusPercent } from '../frontier/shrines';

function harness() {
  const data = new Map<string, any>();
  const repo: Repository = {
    get: (kind, id) => structuredClone(data.get(`${kind}:${id}`)),
    put: (kind, row) => { data.set(`${kind}:${row.id}`, structuredClone(row)); },
    all: kind => [...data].filter(([key]) => key.startsWith(`${kind}:`)).map(([, row]) => structuredClone(row)),
    remove: (kind, id) => { data.delete(`${kind}:${id}`); },
  };
  const actor: Actor = { id: 'a', region: 'reedwake', x: 8, z: 64, online: true, alive: true, hp: 30, bag: Array(28).fill(null), weapon: '', hostile: false, combat: true };
  const world: World = { repo, now: 1000, actors: [actor], save: () => {} };
  repo.put('config', { id: 'world', enabled: true, sequence: 0, pausedAt: 0 });
  repo.put('profile', newProfile('a'));
  const supply = (items: Record<string, number>) => { actor.bag = [...Object.entries(items).map(([itemId, quantity]) => ({ itemId, quantity })), ...Array(20).fill(null)]; };
  const restore = (id = 'reedwake') => perform(world, actor, { action: 'restore_shrine', id });
  return { repo, actor, world, supply, restore, profile: () => repo.get('profile', 'a')! };
}

describe('permanent island shrine rewards', () => {
  it('places each shrine on reachable dry land outside every parcel', () => {
    for (const shrine of ISLAND_SHRINES) {
      expect(regionLand(shrine.region, shrine)).toBe(true);
      expect(regionalPath(shrine.region, PORTS.find(port => port.region === shrine.region)!, shrine, () => false)).not.toBeNull();
      expect(PLOTS.some(plot => plot.region === shrine.region && shrine.x >= plot.x && shrine.x < plot.x + 16 && shrine.z >= plot.z && shrine.z < plot.z + 16)).toBe(false);
    }
    expect(validateCommand({ action: 'restore_shrine', id: 'reedwake' }).action).toBe('restore_shrine');
  });

  it('consumes the exact offering once and persists a character-specific blessing', () => {
    const h = harness(); h.supply({ reeds: 10, resin: 5 }); h.restore();
    expect(countItem(h.actor.bag, 'reeds')).toBe(2); expect(countItem(h.actor.bag, 'resin')).toBe(1);
    expect(shrineXpBonusPercent(h.profile())).toBe(5);
    const before = structuredClone(h.actor.bag);
    expect(() => h.restore()).toThrow('already restored'); expect(h.actor.bag).toEqual(before);
    expect(shrineXpBonusPercent(newProfile('other'))).toBe(0);
  });

  it.each(['missing materials', 'far away', 'other island', 'aboard', 'unknown shrine'])('rejects %s without awarding a blessing or taking supplies', kind => {
    const h = harness(); h.supply(kind === 'missing materials' ? { reeds: 8, resin: 3 } : { reeds: 8, resin: 4 });
    if (kind === 'far away') h.actor.x = 11;
    if (kind === 'other island') h.actor.region = 'cinder';
    if (kind === 'aboard') h.repo.put('boat', { id: 'boat', owner: 'a', region: 'reedwake', x: 8, z: 64, crew: ['a'], pilot: '', permissions: {}, lastPort: 'reedwake', emptySince: 0 });
    const before = structuredClone(h.actor.bag);
    expect(() => h.restore(kind === 'unknown shrine' ? 'made-up' : undefined)).toThrow();
    expect(h.actor.bag).toEqual(before); expect(shrineXpBonusPercent(h.profile())).toBe(0);
  });

  it('keeps both rewards through saved reloads, travel, death and land ownership changes', () => {
    const h = harness(); h.supply({ reeds: 8, resin: 4 }); h.restore();
    h.actor.region = 'cinder'; h.supply({ stone: 8, iron_ore: 4 }); h.restore('cinder');
    h.actor.region = 'settlement'; h.actor.alive = false;
    h.repo.put('claim', { id: 'cinder-1', owner: 'other', tier: 0, paidUntil: 0, cooldownUntil: 0, permissions: {} });
    const saved = JSON.parse(JSON.stringify(h.profile()));
    expect(shrineRestored(saved, 'reedwake')).toBe(true); expect(shrineRestored(saved, 'cinder')).toBe(true);
    expect(shrineXpBonusPercent(saved)).toBe(10);
    const snapshot = frontierSnapshot([], [{ kind: 'profile', data: JSON.stringify(saved) }], 'a', 1000);
    expect(snapshot.shrines.every(shrine => shrine.restored)).toBe(true);
    expect(snapshot.shrineXpBonusPercent).toBe(10);
  });

  it('carries fractional bonuses per discipline across saves and never exceeds ten percent', () => {
    let p = newProfile('a'); p.events['shrine:reedwake'] = 1;
    for (let i = 0; i < 19; i++) awardDisciplineXp(p, 0, 1);
    expect(p.xp[0]).toBe(19); expect(p.events['shrine:xpCarry:0']).toBe(95);
    awardDisciplineXp(p, 1, 1); expect(p.xp[1]).toBe(1);
    p = JSON.parse(JSON.stringify(p)); awardDisciplineXp(p, 0, 1); expect(p.xp[0]).toBe(21);
    p.events['shrine:cinder'] = 1; p.events['shrine:made-up'] = 1;
    expect(shrineXpBonusPercent(p)).toBe(10);
    for (let i = 0; i < 10; i++) awardDisciplineXp(p, 4, 1);
    expect(p.xp[4]).toBe(11);
  });

  it('applies the blessing to ordinary engine XP awards and preserves the XP cap', () => {
    const h = harness(); h.supply({ reeds: 8, resin: 4 }); h.restore(); h.supply({ timber: 20, stone: 20 });
    perform(h.world, h.actor, { action: 'craft', id: 'axe' });
    perform(h.world, h.actor, { action: 'craft', id: 'axe' });
    expect(h.profile().xp[2]).toBe(31); expect(h.profile().events['shrine:xpCarry:2']).toBe(50);
    const p = h.profile(); p.xp[2] = 21024; h.repo.put('profile', p);
    perform(h.world, h.actor, { action: 'craft', id: 'axe' });
    expect(h.profile().xp[2]).toBe(21025); expect(h.profile().events['shrine:xpCarry:2']).toBeUndefined();
  });
});
