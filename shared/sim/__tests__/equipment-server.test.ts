import { describe, expect, it, vi } from 'vitest';
import { adventureTables, testTable } from './adventureHarness';
import { newProfile } from '../frontier/model';
vi.mock('../../../spacetimedb/node_modules/spacetimedb/dist/server/index.mjs', () => ({
  t: new Proxy({}, { get: () => () => ({}) }), SenderError: class SenderError extends Error {},
}));
vi.mock('../../../spacetimedb/src/schema', () => ({ default: { reducer: (...args: unknown[]) => args.at(-1) } }));
import { frontierAction } from '../../../spacetimedb/src/reducers/frontier';
import { eatBerry, dropItem } from '../../../spacetimedb/src/reducers/inventory';
import { frontierRepository, projectFrontier } from '../../../spacetimedb/src/lib/frontier';

function fixture() {
  const identity = { toHexString: () => '1'.padStart(64, '0') }, id = identity.toHexString();
  const db = { ...adventureTables(), player: testTable('identity'), inventorySlot: testTable('id', true),
    accessPolicy: testTable(), playerGrant: testTable('identity'), world: testTable(), tree: testTable(),
    combatEvent: testTable('id', true), groundItem: testTable('id', true) };
  db.accessPolicy.insert({ id: 0, owner: identity, requireAdmission: false });
  db.world.insert({ id: 0, tick: 10 });
  db.player.insert({ identity, region: 'settlement', online: true, state: 0, x: 11, z: 65, hp: 30, maxHp: 30,
    weapon: '', hostile: false, lastInputTick: 0, inputsThisTick: 0, harvestTreeId: 0, pending: 0, eatCooldownUntilTick: 0, nextSwingTick: 0 });
  db.inventorySlot.insert({ id: 0n, owner: identity, slot: 4, itemId: 'padded_vest', quantity: 1 });
  db.inventorySlot.insert({ id: 0n, owner: identity, slot: 0, itemId: 'berry_blueberry', quantity: 3 });
  const ctx: any = { db, sender: identity, identity, timestamp: { microsSinceUnixEpoch: 1_000_000_000n } };
  const repo = frontierRepository(ctx);
  repo.put('config', { id: 'world', enabled: true, pausedAt: 0, sequence: 0 });
  repo.put('profile', newProfile(id)); projectFrontier(ctx, repo);
  const act = (command: unknown) => (frontierAction as any)(ctx, { command: JSON.stringify(command) });
  const me = () => db.player.identity.find(identity);
  const profile = () => JSON.parse(db.frontierView.key.find(`${id}:profile:${id}`).data);
  return { ctx, db, me, profile, act, identity };
}

describe('padded vest equipment and consistent eating', () => {
  it('equips once, projects its equipped state, and removes the health bonus on unequip', () => {
    const h = fixture();
    h.act({ action: 'equip', item: 'padded_vest' });
    expect(h.profile().events.vest).toBe(1);
    expect(h.me()).toMatchObject({ maxHp: 33, hp: 30 });
    h.act({ action: 'equip', item: 'padded_vest' });
    expect(h.profile().events.vest).toBe(1);
    expect(h.me().maxHp).toBe(33);
    h.db.player.identity.update({ ...h.me(), hp: 33 });
    h.act({ action: 'equip', item: 'padded_vest', target: 'unequip' });
    expect(h.profile().events.vest).toBe(0);
    expect(h.me()).toMatchObject({ maxHp: 30, hp: 30 });
  });

  it('removes the bonus immediately when the last equipped vest is dropped from the shared bag', () => {
    const h = fixture(); h.act({ action: 'equip', item: 'padded_vest' });
    h.db.player.identity.update({ ...h.me(), hp: 33 });
    (dropItem as any)(h.ctx, { slot: 4, quantity: 1 });
    expect(h.me()).toMatchObject({ maxHp: 30, hp: 30 });
    expect([...h.db.frontierObject.kind.filter('drop')]).toHaveLength(1);
  });

  it('cannot bypass food cooldown by alternating the quick bar and region API', () => {
    const h = fixture(); h.db.player.identity.update({ ...h.me(), hp: 10 });
    (eatBerry as any)(h.ctx, { slot: 0 });
    expect(h.me().hp).toBe(15);
    expect(() => h.act({ action: 'eat', item: 'berry_blueberry' })).toThrow('still chewing');
    h.db.world.id.update({ id: 0, tick: 13 });
    h.act({ action: 'eat', item: 'berry_blueberry' });
    expect(h.me().hp).toBe(20);
    expect(() => (eatBerry as any)(h.ctx, { slot: 0 })).toThrow('still chewing');
  });

  it.each(['quick bar', 'region API'])('eating from the %s also delays regional attacks', source => {
    const h = fixture(); h.db.player.identity.update({ ...h.me(), hp: 10 });
    const repo = frontierRepository(h.ctx);
    repo.put('creature', { id: 'hostile', species: 'bristleback', owner: '', active: false, trained: false,
      region: 'settlement', x: 12, z: 65, hp: 30, nextMove: 2_000_000, restUntil: 0 });
    if (source === 'quick bar') (eatBerry as any)(h.ctx, { slot: 0 });
    else h.act({ action: 'eat', item: 'berry_blueberry' });
    expect(h.profile().nextAttack).toBe(1_001_800);
    expect(() => h.act({ action: 'attack', id: 'hostile' })).toThrow('Wait for your next swing');
    h.ctx.timestamp.microsSinceUnixEpoch += 1_800_000n;
    h.db.world.id.update({ id: 0, tick: 13 });
    h.act({ action: 'attack', id: 'hostile' });
    expect(frontierRepository(h.ctx).get('creature', 'hostile')?.hp).toBe(27);
  });

  it('eating preserves longer regional attack and ability recovery', () => {
    const h = fixture(), repo = frontierRepository(h.ctx), id = h.identity.toHexString();
    const profile = repo.get('profile', id)!;
    profile.nextAttack = 1_005_000; profile.nextAbility = 1_030_000;
    repo.put('profile', profile); projectFrontier(h.ctx, repo);
    (eatBerry as any)(h.ctx, { slot: 0 });
    expect(h.profile()).toMatchObject({ nextAttack: 1_005_000, nextAbility: 1_030_000 });
  });
});

// Sol's report (2026-11-07 17:34): banking one of two iron clubs removed the quick-slot copy, but the
// row kept the club wielded until a Bramblewild swing (dummy training) re-checked the quick bar.
import { vaultDeposit } from '../../../spacetimedb/src/reducers/vault';
import { inHotbar } from '../items';
import { readSlots } from '../../../spacetimedb/src/lib/inventory';

describe('banking one of two wielded weapons', () => {
  function twoClubs() {
    const h = fixture();
    h.db.player.identity.update({ ...h.me(), region: 'bramblewild', x: 25, z: 25, weapon: 'iron_club' });
    for (const row of [...h.db.inventorySlot.iter()]) h.db.inventorySlot.id.delete(row.id);
    h.db.inventorySlot.insert({ id: 0n, owner: h.identity, slot: 0, itemId: 'iron_club', quantity: 1 }); // quick slot 1, wielded
    h.db.inventorySlot.insert({ id: 0n, owner: h.identity, slot: 5, itemId: 'iron_club', quantity: 1 }); // spare in the bag
    const bag = () => readSlots(h.ctx, h.identity as any).slots;
    return { ...h, bag };
  }

  it('the Grove vault takes the spare from the back and keeps the wielded quick-slot copy', () => {
    const h = twoClubs();
    (vaultDeposit as any)(h.ctx, { itemId: 'iron_club', quantity: 1 });
    expect(h.bag()[0]?.itemId).toBe('iron_club');
    expect(h.bag()[5]).toBeNull();
    expect(h.me().weapon).toBe('iron_club');
  });

  it('the region container deposit (vault-<id>) also keeps the quick-slot copy, or puts the weapon away', () => {
    const h = twoClubs();
    h.act({ action: 'container', id: `vault-${h.identity.toHexString()}`, target: 'deposit', item: 'iron_club', quantity: 1 });
    const bag = h.bag(), weapon = h.me().weapon;
    // A wielded weapon must sit in the quick bar (combat.ts wieldItem; tick.ts re-checks before each swing).
    expect(weapon === '' || inHotbar(bag, weapon)).toBe(true);
    // Like vaultTransfer, banking gives from the back of the bag so the quick bar is kept.
    expect(bag[0]?.itemId).toBe('iron_club');
  });

  it('is not a duplication: banking the last copy through either path puts the weapon away', () => {
    const h = twoClubs();
    h.act({ action: 'container', id: `vault-${h.identity.toHexString()}`, target: 'deposit', item: 'iron_club', quantity: 2 });
    expect(h.bag().some((s) => s?.itemId === 'iron_club')).toBe(false);
    expect(h.me().weapon).toBe('');
  });
});
