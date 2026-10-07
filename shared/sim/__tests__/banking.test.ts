import { describe, expect, it } from 'vitest';
import {
  DROP_BOXES, LOAD_BRIGHT_VALUE, LOAD_GLOW_VALUE, atGroveVault, attackProofSpot, carriedValue, dropBoxInReach, emptyVaultSlots,
  itemValue, loadLevel, vaultId, vaultTransfer,
} from '../banking';
import { areaOf, bossNoPvpZone, inSafeRing } from '../areas';
import { chebyshev, isLandTile, tileKey } from '../grid';
import { NODE_SEEDS } from '../nodes';
import { TREE_SEEDS } from '../items';
import { SCENERY_BLOCKERS } from '../terrain';
import { worldBlockedSet } from '../social';
import { emptySlots } from '../inventory';
import { HOTBAR_SIZE } from '../constants';
import { REGIONS } from '../frontier/catalog';
import { describeEconomy } from '../agentState';
import { Pending } from '../types';

describe('drop boxes', () => {
  const blocked = worldBlockedSet([...NODE_SEEDS, ...TREE_SEEDS, ...SCENERY_BLOCKERS]);
  it('stand on open Coast tiles, one per quadrant, away from nodes and boss zones', () => {
    expect(DROP_BOXES).toHaveLength(4);
    for (const box of DROP_BOXES) {
      expect(isLandTile(box)).toBe(true);
      expect(areaOf(box)).toBe('coast');
      expect(blocked.has(tileKey(box))).toBe(false);
      expect(bossNoPvpZone(box)).toBeNull();
      for (const node of [...NODE_SEEDS, ...TREE_SEEDS]) expect(chebyshev(box, node)).toBeGreaterThan(3);
    }
    const quadrants = new Set(DROP_BOXES.map((b) => `${b.x < 25}${b.z < 25}`));
    expect(quadrants.size).toBe(4);
  });
  it('take deposits from one tile away', () => {
    const box = DROP_BOXES[2];
    expect(dropBoxInReach({ x: box.x + 1, z: box.z - 1 })?.id).toBe(box.id);
    expect(dropBoxInReach({ x: box.x + 2, z: box.z })).toBeUndefined();
  });
});

describe('where the vault opens and where a swap is instant', () => {
  it('opens the vault in the Grove safe ring only (the town bank keeps its own rule)', () => {
    expect(atGroveVault({ x: 25, z: 25 })).toBe(true);
    expect(atGroveVault({ x: 28, z: 22, region: 'bramblewild' })).toBe(true);
    expect(atGroveVault({ x: 29, z: 25 })).toBe(false);
    expect(atGroveVault({ x: 25, z: 25, region: 'settlement' })).toBe(false);
  });
  it('treats the safe ring, boss zones and Meadows town as places no attack lands', () => {
    expect(attackProofSpot({ x: 25, z: 25 })).toBe(true);
    expect(attackProofSpot({ x: 30, z: 25 })).toBe(false);
    expect(attackProofSpot({ x: 84, z: 106 })).toBe(true);
    expect(attackProofSpot({ ...REGIONS.settlement.spawn, region: 'settlement' })).toBe(true);
    expect(attackProofSpot({ x: REGIONS.settlement.spawn.x + 5, z: REGIONS.settlement.spawn.z, region: 'settlement' })).toBe(false);
    expect(inSafeRing({ x: 84, z: 106 })).toBe(false);
  });
});

describe('carried value and the glow', () => {
  it('values weapons by damage, food by half its healing, the rest at 1, with a few overrides', () => {
    expect(itemValue('stone_club')).toBe(8);
    expect(itemValue('berry_blueberry')).toBe(3);
    expect(itemValue('berry_goldberry')).toBe(5);
    expect(itemValue('driftwood')).toBe(1);
    expect(itemValue('prism_shard')).toBe(10);
    expect(itemValue('no_such_item')).toBe(0);
  });
  it('does not count the first copy of each weapon (your kit and key)', () => {
    const slots = emptySlots();
    slots[0] = { itemId: 'stick', quantity: 1 };
    slots[1] = { itemId: 'stone_club', quantity: 1 };
    expect(carriedValue(slots)).toBe(0);
    slots[5] = { itemId: 'stick', quantity: 1 };
    expect(carriedValue(slots)).toBe(6);
  });
  it('has three levels', () => {
    expect(loadLevel(LOAD_GLOW_VALUE - 1)).toBe(0);
    expect(loadLevel(LOAD_GLOW_VALUE)).toBe(1);
    expect(loadLevel(LOAD_BRIGHT_VALUE)).toBe(2);
  });
});

describe('vault transfers', () => {
  it('deposits from the back of the bag, keeping the quick bar', () => {
    const bag = emptySlots();
    bag[0] = { itemId: 'driftwood', quantity: 5 };
    bag[10] = { itemId: 'driftwood', quantity: 5 };
    const r = vaultTransfer(bag, emptyVaultSlots(), 'driftwood', 6, 'deposit');
    if (!r.ok) throw new Error(r.reason);
    expect(r.bag[0]).toEqual({ itemId: 'driftwood', quantity: 4 });
    expect(r.bag[10]).toBeNull();
    expect(r.vault[0]).toEqual({ itemId: 'driftwood', quantity: 6 });
  });
  it('lets weapons sit anywhere in the vault but come back outside the quick bar', () => {
    const bag = emptySlots();
    bag[0] = { itemId: 'stick', quantity: 1 };
    const stored = vaultTransfer(bag, emptyVaultSlots(), 'stick', 1, 'deposit');
    if (!stored.ok) throw new Error(stored.reason);
    expect(stored.vault[0]).toEqual({ itemId: 'stick', quantity: 1 });
    const back = vaultTransfer(stored.bag, stored.vault, 'stick', 1, 'withdraw');
    if (!back.ok) throw new Error(back.reason);
    expect(back.bag.findIndex((s) => s?.itemId === 'stick')).toBe(HOTBAR_SIZE);
  });
  it('is all or nothing', () => {
    const full = emptyVaultSlots().map(() => ({ itemId: 'flint', quantity: 99 }));
    const bag = emptySlots();
    bag[3] = { itemId: 'driftwood', quantity: 1 };
    expect(vaultTransfer(bag, full, 'driftwood', 1, 'deposit')).toEqual({ ok: false, reason: 'Your vault is full' });
    expect(vaultTransfer(bag, emptyVaultSlots(), 'driftwood', 2, 'deposit')).toMatchObject({ ok: false });
    expect(vaultTransfer(bag, emptyVaultSlots(), 'driftwood', 1, 'withdraw')).toMatchObject({ ok: false });
    expect(vaultTransfer(bag, emptyVaultSlots(), 'nope', 1, 'deposit')).toEqual({ ok: false, reason: 'Unknown item' });
  });
});

describe('the economy block agents read', () => {
  it('reads your energy and vault from your own views and describes where you can bank', () => {
    const views = [
      { kind: 'energy', source: 'energy:me', data: JSON.stringify({ id: 'me', points: 10, at: 0, born: -1e12, tired: 0 }) },
      { kind: 'container', source: `container:${vaultId('me')}`, data: JSON.stringify({ id: vaultId('me'), owner: 'me', slots: [{ itemId: 'flint', quantity: 2 }, null, { itemId: 'flint', quantity: 1 }] }) },
      { kind: 'energy', source: 'energy:someone', data: '{}' },
    ];
    const bag = emptySlots();
    bag[4] = { itemId: 'driftwood', quantity: 40 };
    const box = DROP_BOXES[0];
    const e = describeEconomy({ self: { x: box.x, z: box.z, pending: Pending.Deposit }, slots: bag, views, identity: 'me', now: 0 });
    expect(e.energy).toMatchObject({ points: 10, band: 'normal' });
    expect(e.energy).not.toHaveProperty('estimate');
    expect(e.carried).toMatchObject({ unbankedValue: 40, loadLevel: 1 });
    expect(e.vault).toMatchObject({ items: [{ itemId: 'flint', quantity: 3 }], opensHere: false, dropBoxHere: box.id, depositing: true });
    const home = describeEconomy({ self: { x: 25, z: 25 }, slots: emptySlots(), views: [], identity: 'me', now: 0 });
    expect(home.vault).toMatchObject({ opensHere: true, dropBoxHere: null, depositing: false, items: [] });
    expect(home.energy).toMatchObject({ estimate: true, band: 'normal' });
  });
});
