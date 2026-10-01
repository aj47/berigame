import { adventureTables } from './adventureHarness';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EAT_SWING_DELAY_TICKS, HARVEST_TICKS, HOTBAR_SIZE, INVENTORY_SIZE, MAX_INPUTS_PER_TICK, MAX_STACK, MOVEMENT_STEPS_PER_TICK, PUNCH_DAMAGE, STICK_DROP_CHANCE, SWING_INTERVAL_TICKS, TICK_MS } from '../constants';
import { ITEM_DEFS, STICK_ITEM_ID } from '../items';
import { EventKind, Pending, PlayerState } from '../types';

// Run the actual input reducers and their helpers without a live database.
// Registration/runtime schemas and the storage boundary are replaced here;
// the SDK's server entrypoint normally requires the database's spacetime: host.
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
import { attack as registeredAttack, follow as registeredFollow, unwield as registeredUnwield, wieldItem as registeredWield } from '../../../spacetimedb/src/reducers/combat';
import { cancel as registeredCancel, setTarget as registeredTarget } from '../../../spacetimedb/src/reducers/movement';
vi.mock('../../../spacetimedb/src/tables', () => ({ tickSchedule: { rowType: {} } }));
import { tick as registeredTick } from '../../../spacetimedb/src/reducers/tick';
import { giveItem } from '../../../spacetimedb/src/lib/inventory';
import { dropItem as registeredDrop, eatBerry as registeredEat, moveItem as registeredMove, pickupItem as registeredPickup } from '../../../spacetimedb/src/reducers/inventory';

import { setAppearance as registeredAppearance, saveCharacter as registeredCharacter } from '../../../spacetimedb/src/reducers/appearance';
import { startHarvest as registeredHarvest } from '../../../spacetimedb/src/reducers/harvest';
import { onConnect as registeredConnect } from '../../../spacetimedb/src/reducers/lifecycle';
import { attackDummy as registeredAttackDummy, emote as registeredEmote } from '../../../spacetimedb/src/reducers/social';
import { DUMMY_ID, DUMMY_MAX_HP, DUMMY_TILE, DUMMY_IDLE_RESET_TICKS, Emote } from '../social';
import { DEFAULT_APPEARANCE } from '../appearance';
import { areaOf, BRAMBLE_MESSAGE, inGrace, isBramble } from '../areas';
import { FIRST_SPAWN_GRACE_TICKS, FIRST_SPAWN_HP, RESPAWN_GRACE_TICKS } from '../constants';
import { firstDayGoal, type GoalDoneId } from '../goals';
import { chebyshev, neighbors8 } from '../grid';
import { emptySlots } from '../inventory';
import { TREE_SEEDS } from '../items';
import type { Slot } from '../types';

type Reducer = (ctx: any, args?: any) => void;
const setAppearance = registeredAppearance as unknown as Reducer;
const saveCharacter = registeredCharacter as unknown as Reducer;
const attack = registeredAttack as unknown as Reducer;
const follow = registeredFollow as unknown as Reducer;
const wield = registeredWield as unknown as Reducer;
const unwield = registeredUnwield as unknown as Reducer;
const moveSlot = registeredMove as unknown as Reducer;
const drop = registeredDrop as unknown as Reducer;
const cancel = registeredCancel as unknown as Reducer;
const move = registeredTarget as unknown as Reducer;
const eat = registeredEat as unknown as Reducer;
const pickup = registeredPickup as unknown as Reducer;
const scheduledTick = registeredTick as unknown as Reducer;
const identity = (value: string) => ({ toHexString: () => value });
const A = identity('a');
const B = identity('b');
const C = identity('c');

function harness() {
  let now = 10;
  const players = new Map<string, any>();
  for (const id of [A, B, C]) players.set(id.toHexString(), {
    identity: id, name: 'Player-' + id.toHexString(), online: true, state: PlayerState.Alive,
    x: 25, z: 25, hp: 20, maxHp: 30, respawnTick: 0, hostile: false, combatTarget: undefined,
    nextSwingTick: 0, harvestTreeId: 0, harvestEndTick: 0, pending: 0, pendingId: 0n,
    lastInputTick: 0, inputsThisTick: 0, eatCooldownUntilTick: 0, weapon: '',
  });
  const inventory = new Map([[1n, { id: 1n, owner: A, slot: 0, itemId: 'berry_blueberry', quantity: 2 }]]);
  const appearances = new Map<string, any>();
  const ground = new Map<bigint, any>();
  const trees = new Map<number, any>();
  const grants = new Map<string, any>();
  const dummies = new Map<number, any>();
  const cooldowns = new Map<string, any>();
  const giants = new Map<number, any>();
  const contributions = new Map<string, any>();
  const skills = new Map<string, any>();
  const cosmetics = new Map<string, any>();
  const raids = new Map<number, any>();
  const byId = (map: Map<string, any>) => ({
    insert: (row: any) => { map.set(row.identity.toHexString(), row); return row; },
    identity: { find: (id: typeof A) => map.get(id.toHexString()), update: (row: any) => map.set(row.identity.toHexString(), row) },
  });
  const mentees = new Map<string, any>();
  const mentorStats = new Map<string, any>();
  // Ids are never reused, like the real autoInc column, so a delete then insert cannot overwrite a row.
  let nextInventoryId = 100n;
  const ctx = {
    // ctx.random stands in for the server's deterministic RNG; the default roll never finds a stick.
    random: vi.fn(() => 0.99),
    sender: A, identity: A, timestamp: { microsSinceUnixEpoch: 100_000_000n },
    db: {
      ...adventureTables(),
      accessPolicy: { id: { find: () => ({ id: 0, owner: A, gateway: B, requireAdmission: false }) } },
      playerGrant: { identity: { find: (id: typeof A) => grants.get(id.toHexString()) } },
      appearance: { insert: (row: any) => appearances.set(row.identity.toHexString(), row), identity: { find: (id: typeof A) => appearances.get(id.toHexString()), update: (row: any) => appearances.set(row.identity.toHexString(), row) } },
      world: { id: { find: () => ({ id: 0, tick: now }), update: (row: any) => { now = row.tick; } } },
      player: { iter: () => players.values(), count: () => BigInt(players.size), insert: (p: any) => players.set(p.identity.toHexString(), p), identity: {
        find: (id: typeof A) => players.get(id.toHexString()),
        update: (p: any) => players.set(p.identity.toHexString(), p),
      } },
      tree: { iter: () => trees.values(), insert: (row: any) => trees.set(row.id, row), id: { find: (id: number) => trees.get(id), update: (row: any) => trees.set(row.id, row) } },
      inventorySlot: {
        owner: { filter: (owner: typeof A) => [...inventory.values()].filter((row) => row.owner.toHexString() === owner.toHexString()) },
        insert: (row: any) => { const id = nextInventoryId++; inventory.set(id, { ...row, id }); },
        id: { update: (row: any) => inventory.set(row.id, row), delete: (id: bigint) => inventory.delete(id) },
      },
      groundItem: {
        iter: () => ground.values(),
        insert: (row: any) => { const id = BigInt(ground.size + 1); ground.set(id, { ...row, id }); },
        id: { find: (id: bigint) => ground.get(id), update: (row: any) => ground.set(row.id, row), delete: (id: bigint) => ground.delete(id) },
      },
      combatEvent: { insert: vi.fn() },
      trainingDummy: { iter: () => dummies.values(), insert: (row: any) => { dummies.set(row.id, row); return row; }, id: { find: (id: number) => dummies.get(id), update: (row: any) => dummies.set(row.id, row) } },
      dummyEvent: { insert: vi.fn() },
      emoteEvent: { insert: vi.fn() },
      giant: { iter: () => giants.values(), insert: (row: any) => { giants.set(row.id, row); return row; }, id: { find: (id: number) => giants.get(id), update: vi.fn((row: any) => giants.set(row.id, row)) } },
      giantContribution: {
        iter: () => contributions.values(),
        insert: (row: any) => contributions.set(row.identity.toHexString(), row),
        identity: { find: (id: typeof A) => contributions.get(id.toHexString()), update: (row: any) => contributions.set(row.identity.toHexString(), row), delete: (id: typeof A) => contributions.delete(id.toHexString()) },
      },
      giantEvent: { insert: vi.fn() },
      emoteCooldown: { insert: (row: any) => cooldowns.set(row.identity.toHexString(), row), identity: { find: (id: typeof A) => cooldowns.get(id.toHexString()), update: (row: any) => cooldowns.set(row.identity.toHexString(), row) } },
      playerSkill: { insert: (row: any) => skills.set(row.identity.toHexString(), row), identity: { find: (id: typeof A) => skills.get(id.toHexString()), update: (row: any) => skills.set(row.identity.toHexString(), row) } },
      playerCosmetic: { insert: (row: any) => cosmetics.set(row.identity.toHexString(), row), identity: { find: (id: typeof A) => cosmetics.get(id.toHexString()), update: (row: any) => cosmetics.set(row.identity.toHexString(), row) } },
      giantRaid: { insert: (row: any) => { raids.set(row.id, row); return row; }, id: { find: (id: number) => raids.get(id), update: vi.fn((row: any) => raids.set(row.id, row)) } },
      mentee: byId(mentees),
      mentorStat: byId(mentorStats),
    },
  };
  return { ctx, raids, skills, cosmetics, players, giants, contributions, dummies, inventory, ground, trees, appearances, grants, tick: (value: number) => { now = value; }, me: () => players.get('a'), other: () => players.get('b') };
}

let h: ReturnType<typeof harness>;
beforeEach(() => { h = harness(); });
// Fights cannot start or land in the safe ring around spawn, so combat tests stand outside it.
function outsideSafeRing() {
  for (const id of ['a', 'b', 'c']) Object.assign(h.ctx.db.player.identity.find(identity(id)), { x: 35, z: 25 });
}

describe('agent permits at the authoritative boundary', () => {
  it('rejects direct SDK combat when the actor or the target lacks combat access', () => {
    h.grants.set('a', { identity: A, issuer: B, agent: true, expiresAtMicros: 200_000_000n, combat: false, chat: false });
    expect(() => attack(h.ctx, { target: B })).toThrow('combat is not enabled');
    h.grants.get('a').combat = true;
    h.grants.set('b', { identity: B, issuer: B, agent: true, expiresAtMicros: 200_000_000n, combat: false, chat: false });
    expect(() => attack(h.ctx, { target: B })).toThrow('combat is not enabled');
    expect(h.me().hostile).toBe(false);
  });

  it('rejects expired permits and stops an already queued harvest on the next tick', () => {
    h.grants.set('a', { identity: A, issuer: B, agent: true, expiresAtMicros: 99_000_000n, combat: true, chat: false });
    Object.assign(h.me(), { targetX: 30, targetZ: 25, harvestTreeId: 1, harvestEndTick: 11 });
    h.trees.set(1, { id: 1, x: 26, z: 25, itemId: 'berry_goldberry', harvester: A, cooldownUntilTick: 0 });
    expect(() => move(h.ctx, { x: 26, z: 25 })).toThrow('access required or expired');
    scheduledTick(h.ctx);
    expect(h.me().online).toBe(false);
    expect(h.me().targetX).toBeUndefined();
    expect(h.me().harvestEndTick).toBe(0);
    expect(h.trees.get(1).harvester).toBeUndefined();
    expect(h.inventory.size).toBe(1);
  });
});

describe('authoritative attack timing', () => {
  beforeEach(() => outsideSafeRing());
  it('starts a fresh attack next tick and a fresh retaliation halfway through the rally', () => {
    attack(h.ctx, { target: B });
    expect(h.me().nextSwingTick).toBe(11);
    h.ctx.sender = B;
    attack(h.ctx, { target: A });
    expect(h.other().nextSwingTick).toBe(13);
  });

  it('repeated Attack cannot shorten the four-tick recovery or postpone a ready attack', () => {
    attack(h.ctx, { target: B });
    // The scheduled tick has just resolved our swing at 11.
    h.me().nextSwingTick = 11 + SWING_INTERVAL_TICKS;
    for (let tick = 11; tick <= 15; tick++) {
      h.tick(tick);
      attack(h.ctx, { target: B });
      expect(h.me().nextSwingTick).toBe(15);
    }
  });

  it.each(['cancel', 'move', 'follow', 'switch target'])(
    '%s cannot reset the attacker cooldown', (action) => {
      attack(h.ctx, { target: B });
      h.me().nextSwingTick = 15;
      h.tick(12);
      if (action === 'cancel') cancel(h.ctx);
      if (action === 'move') move(h.ctx, { x: 26, z: 25 });
      if (action === 'follow') follow(h.ctx, { target: C });
      attack(h.ctx, { target: action === 'switch target' ? C : B });
      expect(h.me().nextSwingTick).toBe(15);
      expect(h.me().hostile).toBe(true);
    },
  );

  it('preserves the real eating delay through cancel and target changes, including a retaliating target', () => {
    attack(h.ctx, { target: B });
    h.me().nextSwingTick = 15;
    h.tick(12);
    eat(h.ctx, { slot: 0 });
    const readyAt = 15 + EAT_SWING_DELAY_TICKS;
    expect(h.me().hp).toBe(25);
    expect(h.me().nextSwingTick).toBe(readyAt);
    cancel(h.ctx);
    attack(h.ctx, { target: C });
    expect(h.me().nextSwingTick).toBe(readyAt);
    h.other().hostile = true;
    h.other().combatTarget = A;
    h.other().nextSwingTick = 13;
    attack(h.ctx, { target: B });
    expect(h.me().nextSwingTick).toBe(readyAt);
  });

  it('a finished old cooldown does not delay a new fight', () => {
    h.me().nextSwingTick = 5;
    attack(h.ctx, { target: B });
    expect(h.me().nextSwingTick).toBe(11);
  });

  it('cancel before eating cannot avoid the recovery penalty', () => {
    attack(h.ctx, { target: B });
    h.me().nextSwingTick = 15;
    h.tick(12);
    cancel(h.ctx);
    eat(h.ctx, { slot: 0 });
    attack(h.ctx, { target: B });
    expect(h.me().nextSwingTick).toBe(15 + EAT_SWING_DELAY_TICKS);
  });

  it('eating before entering combat delays the first attack', () => {
    eat(h.ctx, { slot: 0 });
    attack(h.ctx, { target: B });
    expect(h.me().nextSwingTick).toBe(10 + EAT_SWING_DELAY_TICKS);
  });
});

describe('wielding from the quick slots', () => {
  beforeEach(() => outsideSafeRing());
  const stickIn = (slot: number, owner = A) => {
    const id = BigInt(50 + slot);
    h.inventory.set(id, { id, owner, slot, itemId: STICK_ITEM_ID, quantity: 1 });
  };

  it('wields a stick from a quick slot and unwields back to fists', () => {
    stickIn(1);
    wield(h.ctx, { slot: 1 });
    expect(h.me().weapon).toBe(STICK_ITEM_ID);
    unwield(h.ctx);
    expect(h.me().weapon).toBe('');
  });

  it('rejects slots outside the quick bar, empty slots and items that are not weapons', () => {
    stickIn(HOTBAR_SIZE);
    expect(() => wield(h.ctx, { slot: HOTBAR_SIZE })).toThrow('quick slots');
    expect(() => wield(h.ctx, { slot: 2 })).toThrow('empty slot');
    expect(() => wield(h.ctx, { slot: 0 })).toThrow('not a weapon');
    expect(h.me().weapon).toBe('');
  });

  it('dead players cannot wield', () => {
    stickIn(1);
    h.me().state = PlayerState.Dead;
    expect(() => wield(h.ctx, { slot: 1 })).toThrow('you are dead');
  });

  it('shares the per-tick input budget with attack and allows the next tick', () => {
    stickIn(1);
    for (let i = 0; i < MAX_INPUTS_PER_TICK - 1; i++) attack(h.ctx, { target: B });
    wield(h.ctx, { slot: 1 });
    expect(h.me().inputsThisTick).toBe(MAX_INPUTS_PER_TICK);
    expect(() => unwield(h.ctx)).toThrow('slow down');
    expect(h.me().weapon).toBe(STICK_ITEM_ID);
    h.tick(11);
    unwield(h.ctx);
    expect(h.me().inputsThisTick).toBe(1);
  });

  it('switching weapons mid-fight keeps the target and the swing timing', () => {
    stickIn(1);
    attack(h.ctx, { target: B });
    h.me().nextSwingTick = 15;
    wield(h.ctx, { slot: 1 });
    unwield(h.ctx);
    expect(h.me()).toMatchObject({ hostile: true, combatTarget: B, nextSwingTick: 15 });
  });

  it('moving the stick out of the quick bar unwields it; moving it within the bar does not', () => {
    stickIn(1);
    wield(h.ctx, { slot: 1 });
    moveSlot(h.ctx, { from: 1, to: 2 });
    expect(h.me().weapon).toBe(STICK_ITEM_ID);
    h.tick(11);
    moveSlot(h.ctx, { from: 2, to: HOTBAR_SIZE + 4 });
    expect(h.me().weapon).toBe('');
  });

  it('dropping the wielded stick unwields it', () => {
    stickIn(2);
    wield(h.ctx, { slot: 2 });
    drop(h.ctx, { slot: 2, quantity: 1 });
    expect(h.me().weapon).toBe('');
    expect([...h.ground.values()][0]).toMatchObject({ itemId: STICK_ITEM_ID, quantity: 1 });
  });

  it('dropping a berry keeps the stick wielded', () => {
    stickIn(1);
    wield(h.ctx, { slot: 1 });
    drop(h.ctx, { slot: 0, quantity: 1 });
    expect(h.me().weapon).toBe(STICK_ITEM_ID);
  });
});

describe('authoritative swings: punch or stick, no stances', () => {
  const hits = () => h.ctx.db.combatEvent.insert.mock.calls.map(([e]: any[]) => e).filter((e: any) => e.kind === EventKind.Hit);
  beforeEach(() => { outsideSafeRing(); Object.assign(h.other(), { x: 36, z: 25, hp: 30 }); });

  it('a bare-handed swing punches for PUNCH_DAMAGE and records no weapon', () => {
    attack(h.ctx, { target: B });
    scheduledTick(h.ctx, { timer: {} });
    expect(h.other().hp).toBe(30 - PUNCH_DAMAGE);
    expect(h.me().hp).toBe(20);
    expect(hits()).toEqual([expect.objectContaining({ attacker: A, defender: B, damage: PUNCH_DAMAGE, itemId: '', defenderHp: 30 - PUNCH_DAMAGE })]);
    expect(h.me().nextSwingTick).toBe(11 + SWING_INTERVAL_TICKS);
  });

  it('a wielded stick hits for its weapon damage and the event carries the stick for the animation', () => {
    h.inventory.set(60n, { id: 60n, owner: A, slot: 1, itemId: STICK_ITEM_ID, quantity: 1 });
    wield(h.ctx, { slot: 1 });
    attack(h.ctx, { target: B });
    scheduledTick(h.ctx, { timer: {} });
    const damage = ITEM_DEFS[STICK_ITEM_ID].weaponDamage;
    expect(damage).toBeGreaterThan(PUNCH_DAMAGE);
    expect(h.other().hp).toBe(30 - damage);
    expect(hits()).toEqual([expect.objectContaining({ damage, itemId: STICK_ITEM_ID })]);
  });

  it('every swing lands: the defender never counters, whatever they do', () => {
    attack(h.ctx, { target: B });
    h.ctx.sender = B;
    attack(h.ctx, { target: A });
    h.ctx.sender = A;
    for (let i = 0; i < SWING_INTERVAL_TICKS; i++) scheduledTick(h.ctx, { timer: {} });
    expect(hits().map((e: any) => [e.attacker.toHexString(), e.damage])).toEqual([['a', PUNCH_DAMAGE], ['b', PUNCH_DAMAGE]]);
    expect(h.me().hp).toBe(20 - PUNCH_DAMAGE);
    expect(h.other().hp).toBe(30 - PUNCH_DAMAGE);
    expect(h.other()).toMatchObject({ x: 36, z: 25 });
  });

  it('a stale weapon with no stick in the quick bar falls back to a punch and is cleared', () => {
    h.me().weapon = STICK_ITEM_ID;
    attack(h.ctx, { target: B });
    scheduledTick(h.ctx, { timer: {} });
    expect(h.other().hp).toBe(30 - PUNCH_DAMAGE);
    expect(hits()[0].itemId).toBe('');
    expect(h.me().weapon).toBe('');
  });

  it('dying drops the stick and clears the wielded weapon', () => {
    h.inventory.set(61n, { id: 61n, owner: B, slot: 0, itemId: STICK_ITEM_ID, quantity: 1 });
    h.ctx.sender = B;
    wield(h.ctx, { slot: 0 });
    h.ctx.sender = A;
    h.other().hp = PUNCH_DAMAGE;
    attack(h.ctx, { target: B });
    scheduledTick(h.ctx, { timer: {} });
    expect(h.other()).toMatchObject({ state: PlayerState.Dead, weapon: '' });
    expect([...h.ground.values()].some((g) => g.itemId === STICK_ITEM_ID && g.droppedOnDeath)).toBe(true);
    expect([...h.inventory.values()].some((row) => row.owner === B)).toBe(false);
  });
});

describe('stick drops from harvesting after level 2', () => {
  beforeEach(() => { h.skills.set('a', { identity: A, foragingXp: 25, beachcombingXp: 0, craftingXp: 0 }); h.ctx.db.adventureProfile.insert({ identity: A, growingXp: 25, buildingXp: 0, exploringXp: 0, fightingXp: 0, befriendingXp: 0, feats: 1, loadout: 0, completions: 0, giantTrust: 0, stickClaimed: true }); });
  const events = () => h.ctx.db.combatEvent.insert.mock.calls.map(([e]: any[]) => e);
  function finishHarvest(roll: number) {
    h.ctx.random.mockReturnValue(roll);
    h.trees.set(1, { id: 1, x: 26, z: 25, itemId: 'berry_goldberry', harvester: A, cooldownUntilTick: 0 });
    Object.assign(h.me(), { harvestTreeId: 1, harvestEndTick: 11 });
    scheduledTick(h.ctx, { timer: {} });
  }
  const sticks = () => [...h.inventory.values()].filter((row) => row.itemId === STICK_ITEM_ID);

  it('a roll below the drop chance adds a stick after the berry and announces it', () => {
    finishHarvest(STICK_DROP_CHANCE / 2);
    expect(h.ctx.random).toHaveBeenCalledTimes(1);
    expect(sticks()).toEqual([expect.objectContaining({ owner: A, slot: 2, quantity: 1 })]);
    expect(events().map((e: any) => [e.kind, e.itemId])).toEqual([
      [EventKind.HarvestDone, 'berry_goldberry'],
      [EventKind.ItemFound, STICK_ITEM_ID],
    ]);
  });

  it('a roll at or above the drop chance gives only the berry', () => {
    finishHarvest(STICK_DROP_CHANCE);
    expect(sticks()).toEqual([]);
    expect(events().map((e: any) => e.kind)).toEqual([EventKind.HarvestDone]);
  });

  it('an interrupted harvest never rolls', () => {
    h.trees.set(1, { id: 1, x: 40, z: 40, itemId: 'berry_goldberry', harvester: A, cooldownUntilTick: 0 });
    Object.assign(h.me(), { harvestTreeId: 1, harvestEndTick: 11 });
    scheduledTick(h.ctx, { timer: {} });
    expect(h.ctx.random).not.toHaveBeenCalled();
  });

  it('a stick that does not fit lands on the ground', () => {
    h.inventory.clear();
    for (let slot = 0; slot < INVENTORY_SIZE; slot++) h.inventory.set(BigInt(slot + 1), { id: BigInt(slot + 1), owner: A, slot, itemId: 'berry_goldberry', quantity: slot === 0 ? MAX_STACK - 1 : MAX_STACK });
    finishHarvest(0);
    expect(sticks()).toEqual([]);
    expect([...h.ground.values()]).toEqual([expect.objectContaining({ itemId: STICK_ITEM_ID, quantity: 1, droppedOnDeath: false })]);
  });
});


describe('ground-pile inventory conservation', () => {
  const quantity = (rows: Iterable<{ quantity: number }>) => [...rows].reduce((sum, row) => sum + row.quantity, 0);
  function fillInventory(space: number) {
    h.inventory.clear();
    for (let slot = 0; slot < INVENTORY_SIZE; slot++) {
      const id = BigInt(slot + 1);
      h.inventory.set(id, { id, owner: A, slot, itemId: 'berry_blueberry', quantity: MAX_STACK - (slot === 0 ? space : 0) });
    }
  }

  it.each(['nearby', 'walk to pickup'])('%s keeps full-inventory overflow in one existing pile', (mode) => {
    fillInventory(0);
    h.ground.set(1n, { id: 1n, x: mode === 'nearby' ? 25 : 27, z: 25, itemId: 'berry_blueberry', quantity: 10, expiresTick: 500, droppedOnDeath: true });
    const before = quantity(h.inventory.values()) + quantity(h.ground.values());
    for (let attempt = 0; attempt < 3; attempt++) {
      pickup(h.ctx, { id: 1n });
      scheduledTick(h.ctx, { timer: {} });
      expect(h.ground.size).toBe(1);
      expect(h.ground.get(1n)?.quantity).toBe(10);
      expect(quantity(h.inventory.values()) + quantity(h.ground.values())).toBe(before);
    }
  });

  it.each(['nearby', 'walk to pickup'])('%s takes only available capacity and preserves pile metadata', (mode) => {
    fillInventory(4);
    h.ground.set(1n, { id: 1n, x: mode === 'nearby' ? 25 : 27, z: 25, itemId: 'berry_blueberry', quantity: 10, expiresTick: 500, droppedOnDeath: true });
    const before = quantity(h.inventory.values()) + quantity(h.ground.values());
    pickup(h.ctx, { id: 1n });
    scheduledTick(h.ctx, { timer: {} });
    expect(h.ground.size).toBe(1);
    expect(h.ground.get(1n)).toMatchObject({ quantity: 6, expiresTick: 500, droppedOnDeath: true });
    expect(h.inventory.get(1n)?.quantity).toBe(MAX_STACK);
    expect(quantity(h.inventory.values()) + quantity(h.ground.values())).toBe(before);
  });

  it('removes a fully collected pile', () => {
    h.inventory.clear();
    h.ground.set(1n, { id: 1n, x: 25, z: 25, itemId: 'berry_blueberry', quantity: 10 });
    pickup(h.ctx, { id: 1n });
    expect(h.ground.size).toBe(0);
    expect(quantity(h.inventory.values())).toBe(10);
  });

  it('still drops newly harvested rewards when inventory is full', () => {
    fillInventory(0);
    expect(giveItem(h.ctx as any, A as any, 'berry_blueberry', 1, { x: 25, z: 25 }, 10)).toBe(0);
    expect(quantity(h.ground.values())).toBe(1);
    expect(quantity(h.inventory.values())).toBe(INVENTORY_SIZE * MAX_STACK);
  });
});


describe('cosmetic appearance isolation', () => {
  it('creates or replaces only the sender appearance without changing gameplay state', () => {
    const before = { ...h.me() };
    h.appearances.set('b', { identity: B, ...DEFAULT_APPEARANCE, robeColor: 1 });
    setAppearance(h.ctx, { hairStyle: 2, skinTone: 5, hairColor: 3, robeColor: 4, wrapColor: 2 });
    expect(h.appearances.get('a').hairStyle).toBe(2);
    expect(h.appearances.get('b').robeColor).toBe(1);
    const { lastInputTick, inputsThisTick, ...afterGameplay } = h.me();
    const { lastInputTick: _, inputsThisTick: __, ...beforeGameplay } = before;
    expect(afterGameplay).toEqual(beforeGameplay);
    setAppearance(h.ctx, DEFAULT_APPEARANCE);
    expect(h.appearances.size).toBe(2);
    expect(h.appearances.get('a').hairStyle).toBe(0);
  });
  it.each(['hairStyle', 'skinTone', 'hairColor', 'robeColor', 'wrapColor'])('rejects invalid %s without saving an appearance', (key) => {
    expect(() => setAppearance(h.ctx, { ...DEFAULT_APPEARANCE, [key]: 255 })).toThrow('available styles');
    expect(h.appearances.size).toBe(0);
    expect(h.me().inputsThisTick).toBe(0);
  });
  it('shares the server input rate limit', () => {
    h.me().lastInputTick = 10; h.me().inputsThisTick = MAX_INPUTS_PER_TICK;
    expect(() => setAppearance(h.ctx, DEFAULT_APPEARANCE)).toThrow('slow down');
    expect(h.appearances.size).toBe(0);
  });
});


describe('faster authoritative traversal with unchanged world cadence', () => {
  it('travels six open tiles in three ticks instead of six, then stops exactly', () => {
    move(h.ctx, { x: 31, z: 25 });
    for (const x of [27, 29, 31]) { scheduledTick(h.ctx, { timer: {} }); expect(h.me().x).toBe(x); }
    expect(h.me().targetX).toBeUndefined();
    scheduledTick(h.ctx, { timer: {} }); expect(h.me().x).toBe(31);
    expect(MOVEMENT_STEPS_PER_TICK).toBe(2); expect(TICK_MS).toBe(600);
    expect(h.ctx.db.world.id.find().tick).toBe(14);
  });
  it('does not overshoot a one-tile destination or move dead/offline players', () => {
    move(h.ctx, { x: 26, z: 25 }); scheduledTick(h.ctx, { timer: {} }); expect(h.me().x).toBe(26);
    Object.assign(h.me(), { targetX: 30, targetZ: 25, online: false });
    scheduledTick(h.ctx, { timer: {} }); expect(h.me().x).toBe(26);
    Object.assign(h.me(), { online: true, state: PlayerState.Dead, respawnTick: 100 });
    scheduledTick(h.ctx, { timer: {} }); expect(h.me().x).toBe(26);
  });
  it('validates intermediate tiles rather than jumping through a wall to an open endpoint', () => {
    for (let z = 0; z < 50; z++) h.trees.set(z+1, { id: z+1, x: 26, z });
    Object.assign(h.me(), { targetX: 27, targetZ: 25 });
    scheduledTick(h.ctx, { timer: {} });
    expect(h.me()).toMatchObject({ x: 25, z: 25, targetX: undefined });
  });
  it('cannot cut diagonally out of a tile enclosed by blocked neighbors', () => {
    Object.assign(h.me(), { x: 25, z: 25, targetX: 27, targetZ: 27 });
    [{x:24,z:25},{x:26,z:25},{x:25,z:24},{x:25,z:26}].forEach((t,i)=>h.trees.set(i+1,{id:i+1,...t}));
    scheduledTick(h.ctx, { timer: {} }); expect(h.me()).toMatchObject({ x: 25, z: 25 });
  });
  it.each(['follow', 'attack'])('%s stops at first melee-range tile without changing swing recovery', (mode) => {
    outsideSafeRing();
    Object.assign(h.other(), { x: 37, z: 25 });
    h.me().nextSwingTick = 40;
    (mode === 'follow' ? follow : attack)(h.ctx, { target: B });
    scheduledTick(h.ctx, { timer: {} });
    expect(h.me()).toMatchObject({ x: 36, z: 25, nextSwingTick: 40 });
    expect(h.ctx.db.combatEvent.insert).not.toHaveBeenCalled();
  });
  it('begins harvesting on the first substep and still waits the full five-tick harvest', () => {
    h.trees.set(1, { id: 1, x: 27, z: 25, itemId: 'berry_blueberry', cooldownUntilTick: 0 });
    Object.assign(h.me(), { pending: Pending.Harvest, pendingId: 1n, targetX: 27, targetZ: 26 });
    scheduledTick(h.ctx, { timer: {} });
    expect(h.me()).toMatchObject({ x: 26, z: 26, harvestTreeId: 1, harvestEndTick: 11+HARVEST_TICKS, targetX: undefined });
    for (let i=0;i<HARVEST_TICKS-1;i++) scheduledTick(h.ctx, { timer: {} });
    expect(h.inventory.get(1n)?.quantity).toBe(2);
    scheduledTick(h.ctx, { timer: {} }); expect(h.inventory.get(1n)?.quantity).toBe(3);
    expect(h.me().harvestTreeId).toBe(0);
  });
  it('collects at first pickup-range substep rather than running past the interaction', () => {
    h.ground.set(1n, { id: 1n, x: 27, z: 25, itemId: 'berry_blueberry', quantity: 1, expiresTick: 500 });
    pickup(h.ctx, { id: 1n }); scheduledTick(h.ctx, { timer: {} });
    expect(h.me()).toMatchObject({ x: 26, z: 25, pending: Pending.None, targetX: undefined });
    expect(h.ground.size).toBe(0); expect(h.inventory.get(1n)?.quantity).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// M1 "The Grove": one-way brambles, grace, safe ring, wait-and-claim.
// ---------------------------------------------------------------------------
const startHarvest = registeredHarvest as unknown as Reducer;
const connect = registeredConnect as unknown as Reducer;
const run = (n = 1) => { for (let i = 0; i < n; i++) scheduledTick(h.ctx, { timer: {} }); };
const worldTick = () => h.ctx.db.world.id.find().tick as number;
function as<T>(id: ReturnType<typeof identity>, fn: () => T): T {
  const prev = h.ctx.sender;
  h.ctx.sender = id;
  try { return fn(); } finally { h.ctx.sender = prev; }
}
function addPlayer(hexId: string, fields: Record<string, unknown> = {}) {
  const id = identity(hexId);
  h.players.set(hexId, {
    identity: id, name: 'Player-' + id.toHexString(), online: true, state: PlayerState.Alive, x: 25, z: 25, hp: 30, maxHp: 30, respawnTick: 0,
    hostile: false, combatTarget: undefined, nextSwingTick: 0, harvestTreeId: 0, harvestEndTick: 0,
    pending: 0, pendingId: 0n, lastInputTick: 0, inputsThisTick: 0, eatCooldownUntilTick: 0, weapon: '', ...fields,
  });
  return id;
}
let nextRow = 1000n;
function giveStick(owner = A, slot = 1) {
  const id = nextRow++;
  h.inventory.set(id, { id, owner, slot, itemId: STICK_ITEM_ID, quantity: 1 });
}
function slotsOf(owner: ReturnType<typeof identity>): Slot[] {
  const slots = emptySlots();
  for (const row of h.inventory.values()) {
    if (row.owner.toHexString() === owner.toHexString()) slots[row.slot] = { itemId: row.itemId, quantity: row.quantity };
  }
  return slots;
}

describe('the bramble hedge on the server', () => {
  it('a click beyond the hedge without a stick clamps to ring 16 and the walk stops there', () => {
    move(h.ctx, { x: 2, z: 25 });
    expect(h.me()).toMatchObject({ targetX: 9, targetZ: 24 });
    run(12);
    expect(h.me()).toMatchObject({ x: 9, z: 24 });
  });

  it('a stick holder (bag only) walks (25,25) to (2,25) through (8,25) in 12 ticks', () => {
    giveStick();
    move(h.ctx, { x: 2, z: 25 });
    run(11);
    expect(h.me().x).toBe(3);
    run(1);
    expect(h.me()).toMatchObject({ x: 2, z: 25, targetX: undefined });
  });

  it('dropping the stick mid-route stops the player where they are', () => {
    giveStick();
    move(h.ctx, { x: 2, z: 25 });
    run(3);
    expect(h.me().x).toBe(19);
    h.tick(worldTick());
    drop(h.ctx, { slot: 1, quantity: 1 });
    run(2);
    expect(h.me()).toMatchObject({ x: 19, z: 25, targetX: undefined });
  });

  it.each([[9, 25, 9], [7, 25, 7]])('stickless on a hedge tile: steps straight off to (%i, 25) first, never along or diagonally', (x, z, firstX) => {
    Object.assign(h.me(), { x: 8, z: 25 });
    move(h.ctx, { x, z });
    run();
    // Two steps a tick: the first is straight across, the second leaves (x, 25).
    expect(h.me().x).toBe(firstX);
    expect(isBramble(h.me())).toBe(false);
  });

  it('a stickless player on the Coast walks home through the hedge', () => {
    Object.assign(h.me(), { x: 2, z: 25 });
    move(h.ctx, { x: 25, z: 25 });
    run(12);
    expect(h.me()).toMatchObject({ x: 25, z: 25 });
  });

  it('pickup and startHarvest of a Coast target without a stick throw the brambles message and queue nothing', () => {
    h.ground.set(1n, { id: 1n, x: 4, z: 25, itemId: 'berry_blueberry', quantity: 1, expiresTick: 500 });
    h.trees.set(9, { id: 9, x: 4, z: 30, itemId: 'berry_blueberry', cooldownUntilTick: 0 });
    expect(() => pickup(h.ctx, { id: 1n })).toThrow(BRAMBLE_MESSAGE);
    expect(() => startHarvest(h.ctx, { treeId: 9 })).toThrow(BRAMBLE_MESSAGE);
    expect(h.me().pending).toBe(Pending.None);
    expect(h.me().targetX).toBeUndefined();
    giveStick();
    pickup(h.ctx, { id: 1n });
    expect(h.me()).toMatchObject({ pending: Pending.Pickup, targetX: 5, targetZ: 26 });
  });

  it('an item dropped on a bramble tile can be picked up from the Grove side', () => {
    h.ground.set(1n, { id: 1n, x: 8, z: 25, itemId: 'berry_blueberry', quantity: 1, expiresTick: 500 });
    pickup(h.ctx, { id: 1n });
    run(9);
    expect(h.me()).toMatchObject({ x: 9, z: 24, pending: Pending.None });
    expect(h.ground.size).toBe(0);
  });

  it('a stickless follower never steps onto brambles and stands still while the target is out of reach', () => {
    Object.assign(h.me(), { x: 12, z: 25 });
    Object.assign(h.other(), { x: 4, z: 25 });
    follow(h.ctx, { target: B });
    for (let i = 0; i < 6; i++) { run(); expect(isBramble(h.me())).toBe(false); }
    // bfsPath is null: no fallback in M1, the follow target is kept.
    expect(h.me()).toMatchObject({ x: 12, z: 25, combatTarget: B });
    // Once the target comes back into the Grove the follower moves again.
    Object.assign(h.other(), {x:15,z:22});
    run(12);
    expect(chebyshev(h.me(),h.other())).toBeLessThanOrEqual(1);
  });

  it('a stickless player on the Coast can still harvest a Grove tree (the way home is open)', () => {
    Object.assign(h.me(), { x: 4, z: 25 });
    h.trees.set(4, { id: 4, x: 30, z: 25, itemId: 'berry_blueberry', cooldownUntilTick: 0 });
    startHarvest(h.ctx, { treeId: 4 });
    run(14);
    expect(h.me().harvestTreeId).toBe(4);
  });
});

describe('sticks: gifted early keys and grace', () => {
  const events = () => h.ctx.db.combatEvent.insert.mock.calls.map(([e]: any[]) => e);
  function finishHarvest(roll: number) {
    h.ctx.random.mockReturnValue(roll);
    h.trees.set(1, { id: 1, x: 26, z: 25, itemId: 'berry_goldberry', harvester: A, cooldownUntilTick: 0 });
    Object.assign(h.me(), { harvestTreeId: 1, harvestEndTick: 11 });
    run();
  }
  const sticks = () => [...h.inventory.values()].filter((row) => row.itemId === STICK_ITEM_ID);

  it('a level-1 holder keeps their gifted key, but cannot find spares yet', () => {
    giveStick();
    finishHarvest(0);
    expect(h.ctx.random).toHaveBeenCalledTimes(1);
    expect(sticks()).toHaveLength(1);
    expect(events().map((e: any) => e.kind)).toEqual([EventKind.HarvestDone]);
  });

  it('a wielded stick counts as held', () => {
    giveStick(A, 1);
    h.me().weapon = STICK_ITEM_ID;
    finishHarvest(0);
    expect(sticks()).toHaveLength(1);
  });

  it('a new character washes ashore at 20 HP with first-spawn grace until +300; a reconnect keeps both', () => {
    const D = identity('d');
    h.tick(40);
    as(D, () => connect(h.ctx));
    const d = h.ctx.db.player.identity.find(D);
    expect(d).toMatchObject({ hp: FIRST_SPAWN_HP, maxHp: 30, respawnTick: 40 + FIRST_SPAWN_GRACE_TICKS - RESPAWN_GRACE_TICKS });
    expect(inGrace(d, 40 + FIRST_SPAWN_GRACE_TICKS - 1)).toBe(true);
    expect(inGrace(d, 40 + FIRST_SPAWN_GRACE_TICKS)).toBe(false);
    h.players.set('d', { ...d, online: false, connections: 0, hp: 27 });
    h.tick(100);
    as(D, () => connect(h.ctx));
    expect(h.ctx.db.player.identity.find(D)).toMatchObject({ hp: 27, respawnTick: 330, online: true });
  });

  it('respawns heal to full (20 HP is for the first insert only) and give 10 ticks of grace', () => {
    Object.assign(h.me(), { state: PlayerState.Dead, respawnTick: 11, hp: 0 });
    run();
    expect(h.me()).toMatchObject({ state: PlayerState.Alive, hp: 30 });
    expect(inGrace(h.me(), 11 + RESPAWN_GRACE_TICKS - 1)).toBe(true);
    expect(inGrace(h.me(), 11 + RESPAWN_GRACE_TICKS)).toBe(false);
  });

  it('a find during first-spawn grace leaves 10 more ticks', () => {
    h.me().respawnTick = 300;
    h.skills.set('a', { identity: A, foragingXp: 24, beachcombingXp: 0, craftingXp: 0 });
    finishHarvest(0);
    expect(sticks()).toHaveLength(1);
    expect(h.me().respawnTick).toBe(11);
  });

  it('picking up a stick during first-spawn grace leaves 10 more ticks, nearby or after a walk', () => {
    h.me().respawnTick = 300;
    h.ground.set(1n, { id: 1n, x: 25, z: 26, itemId: STICK_ITEM_ID, quantity: 1, expiresTick: 500 });
    pickup(h.ctx, { id: 1n });
    expect(h.me().respawnTick).toBe(10);
    h.inventory.clear();
    h.me().respawnTick = 300;
    h.ground.set(2n, { id: 2n, x: 29, z: 25, itemId: STICK_ITEM_ID, quantity: 1, expiresTick: 500 });
    pickup(h.ctx, { id: 2n });
    run(2);
    expect(h.ground.size).toBe(0);
    expect(h.me().respawnTick).toBe(12);
  });

  it('an accepted attack ends your own grace', () => {
    outsideSafeRing();
    h.me().respawnTick = 300;
    attack(h.ctx, { target: B });
    expect(h.me().respawnTick).toBe(0);
  });
});

describe('the safe ring and grace stop fights', () => {
  const hits = () => h.ctx.db.combatEvent.insert.mock.calls.map(([e]: any[]) => e).filter((e: any) => e.kind === EventKind.Hit);

  it('attack is rejected when either side is inside the safe ring', () => {
    Object.assign(h.me(), { x: 28, z: 25 });
    Object.assign(h.other(), { x: 27, z: 25 });
    expect(() => attack(h.ctx, { target: B })).toThrow('safe ring');
    Object.assign(h.me(), { x: 27, z: 25 });
    Object.assign(h.other(), { x: 28, z: 25 });
    expect(() => attack(h.ctx, { target: B })).toThrow('safe ring');
    expect(h.me().hostile).toBe(false);
  });

  it('attack is rejected against a player in grace', () => {
    outsideSafeRing();
    h.other().respawnTick = 5;
    expect(() => attack(h.ctx, { target: B })).toThrow('protected');
    h.other().respawnTick = 300;
    expect(() => attack(h.ctx, { target: B })).toThrow('protected');
  });

  it('no swing lands once the defender steps into the ring or while they are in grace', () => {
    Object.assign(h.me(), { x: 28, z: 25 });
    Object.assign(h.other(), { x: 29, z: 25, hp: 30 });
    attack(h.ctx, { target: B });
    h.other().x = 27;
    Object.assign(h.me(), { x: 28, z: 25 });
    run(1);
    expect(hits()).toEqual([]);
    h.other().x = 29;
    h.other().respawnTick = worldTick();
    run(3);
    expect(hits()).toEqual([]);
    run(RESPAWN_GRACE_TICKS);
    expect(hits().length).toBeGreaterThan(0);
  });
});

describe('wait-and-claim at a busy tree', () => {
  beforeEach(() => {
    h.trees.set(1, { id: 1, x: 30, z: 30, itemId: 'berry_blueberry', cooldownUntilTick: 15 });
    Object.assign(h.me(), { x: 29, z: 30 });
    Object.assign(h.other(), { x: 31, z: 30 });
    Object.assign(h.ctx.db.player.identity.find(C), { x: 30, z: 29 });
  });
  const claimant = () => [...h.players.values()].find((p) => p.harvestTreeId === 1)?.identity.toHexString();

  it('startHarvest on a regrowing tree waits beside it and claims on the ripening tick', () => {
    expect(() => startHarvest(h.ctx, { treeId: 1 })).not.toThrow();
    expect(h.me()).toMatchObject({ pending: Pending.Harvest, pendingId: 1n, harvestTreeId: 0 });
    run(4);
    expect(h.me().harvestTreeId).toBe(0);
    run(1);
    expect(worldTick()).toBe(15);
    expect(h.me()).toMatchObject({ harvestTreeId: 1, pending: Pending.None, harvestEndTick: 15 + HARVEST_TICKS });
  });

  it('a claimed tree queues too, and a distant player walks up and waits', () => {
    h.trees.get(1).cooldownUntilTick = 0;
    h.trees.get(1).harvester = C;
    Object.assign(h.ctx.db.player.identity.find(C), { harvestTreeId: 1, harvestEndTick: 40 });
    Object.assign(h.me(), { x: 20, z: 30 });
    startHarvest(h.ctx, { treeId: 1 });
    run(5);
    expect(h.me()).toMatchObject({ x: 29, pending: Pending.Harvest, harvestTreeId: 0 });
  });

  it('a newcomer beats a veteran who queued first', () => {
    h.tick(11); startHarvest(h.ctx, { treeId: 1 });
    h.tick(12); as(C, () => startHarvest(h.ctx, { treeId: 1 }));
    h.ctx.db.player.identity.find(C).respawnTick = 300;
    run(3);
    expect(claimant()).toBe('c');
    expect(h.me().pending).toBe(Pending.Harvest);
  });

  it('picking the tree you are harvesting keeps the harvest instead of restarting it', () => {
    h.trees.get(1).cooldownUntilTick = 0;
    startHarvest(h.ctx, { treeId: 1 });
    expect(h.me()).toMatchObject({ harvestTreeId: 1, harvestEndTick: 10 + HARVEST_TICKS });
    run(2);
    startHarvest(h.ctx, { treeId: 1 });
    expect(h.me()).toMatchObject({ harvestTreeId: 1, harvestEndTick: 10 + HARVEST_TICKS, pending: Pending.None });
    expect(h.trees.get(1).harvester).toBe(A);
    run(HARVEST_TICKS - 2);
    expect(h.me().harvestTreeId).toBe(0);
    expect([...h.inventory.values()].find((row) => row.itemId === 'berry_blueberry')?.quantity).toBe(3);
  });

  it('among veterans the earliest last input wins', () => {
    h.tick(11); as(B, () => startHarvest(h.ctx, { treeId: 1 }));
    h.tick(12); startHarvest(h.ctx, { treeId: 1 });
    run(3);
    expect(claimant()).toBe('b');
  });

  it('then tick order breaks the tie', () => {
    h.tick(11);
    as(C, () => startHarvest(h.ctx, { treeId: 1 }));
    as(B, () => startHarvest(h.ctx, { treeId: 1 }));
    run(4);
    expect(claimant()).toBe('b');
  });
});

describe('First Day acceptance: newcomers following state.goal get harvests', () => {
  function simulate({ bots = 10, armed = 0, newcomers = 1 }) {
    h.players.clear();
    h.inventory.clear();
    h.trees.clear();
    for (const t of TREE_SEEDS) h.trees.set(t.id, { ...t, cooldownUntilTick: 0, harvester: undefined });
    const spawn = 10;
    h.tick(spawn);
    const botIds: Array<{ id: ReturnType<typeof identity>; tree: number }> = [];
    for (let i = 0; i < bots; i++) {
      const tree = TREE_SEEDS[i % TREE_SEEDS.length];
      const at = neighbors8(tree)[Math.floor(i / TREE_SEEDS.length)];
      const id = addPlayer(`bot${String(i).padStart(2, '0')}`, { x: at.x, z: at.z });
      if (i < armed) { giveStick(id, 0); h.players.get(id.toHexString()).weapon = STICK_ITEM_ID; }
      botIds.push({ id, tree: tree.id });
    }
    const newIds = Array.from({ length: newcomers }, (_, i) => addPlayer(`new${i}`, {
      hp: FIRST_SPAWN_HP, respawnTick: spawn + FIRST_SPAWN_GRACE_TICKS - RESPAWN_GRACE_TICKS,
    }));
    const done = new Map<string, GoalDoneId[]>(newIds.map((id) => [id.toHexString(), []]));
    const rejected: string[] = [];
    const ate = new Set<string>();
    const botsAct = () => {
      for (const { id, tree } of botIds) {
        const p = h.players.get(id.toHexString());
        if (p.harvestTreeId === 0 && p.pending === Pending.None) as(id, () => startHarvest(h.ctx, { treeId: tree }));
      }
    };
    botsAct(); // every tree is claimed on the tick the newcomers spawn
    while (worldTick() < spawn + FIRST_SPAWN_GRACE_TICKS) {
      run();
      const T = worldTick();
      botsAct();
      for (const { id } of botIds.slice(0, armed)) {
        for (const target of newIds) {
          try { as(id, () => attack(h.ctx, { target })); } catch (e) { rejected.push((e as Error).message); }
        }
      }
      for (const id of newIds) {
        const me = h.players.get(id.toHexString());
        const others = [...h.players.values()].filter((p) => p !== me);
        const { goal, done: next } = firstDayGoal({
          me, slots: slotsOf(id), trees: [...h.trees.values()], others, tick: T, canFight: true, done: done.get(id.toHexString())!, seen: { ate: ate.has(id.toHexString()) },
        });
        done.set(id.toHexString(), next);
        const action = goal?.action;
        if (!action) continue;
        if (action.kind === 'harvest') as(id, () => startHarvest(h.ctx, { treeId: action.treeId }));
        if (action.kind === 'eat') { as(id, () => eat(h.ctx, { slot: action.slot })); ate.add(id.toHexString()); }
      }
    }
    const harvests = (id: ReturnType<typeof identity>) => h.ctx.db.combatEvent.insert.mock.calls
      .map(([e]: any[]) => e)
      .filter((e: any) => e.kind === EventKind.HarvestDone && e.attacker === id && e.tick < spawn + FIRST_SPAWN_GRACE_TICKS).length;
    const events = h.ctx.db.combatEvent.insert.mock.calls.map(([e]: any[]) => e);
    const firstStick = events.find((e: any) => e.kind === EventKind.ItemFound && e.attacker === newIds[0]);
    const firstHit = events.find((e: any) => e.kind === EventKind.Hit && e.defender === newIds[0]);
    return { counts: newIds.map(harvests), rejected, done, firstStick, firstHit };
  }

  it('(a) lock-step: 10 bots saturate all trees; one newcomer finishes the four harvests needed for a stick before 3:00', () => {
    const { counts, done } = simulate({});
    expect(counts[0]).toBeGreaterThanOrEqual(4);
    expect(done.get('new0')).toEqual(expect.arrayContaining(['pick-berry', 'eat-berry']));
  });

  it('(b) armed bots cannot hit a newcomer before the guaranteed stick and its grace window', () => {
    const { counts, rejected, firstStick, firstHit } = simulate({ armed: 3 });
    expect(counts[0]).toBeGreaterThanOrEqual(4);
    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected.every((m) => /protected|safe ring|target unavailable/.test(m))).toBe(true);
    expect(firstStick).toBeDefined();
    if (firstHit) expect(firstHit.tick).toBeGreaterThanOrEqual(firstStick.tick + RESPAWN_GRACE_TICKS);
  });

  it('(c) 6 newcomers together each reach the fourth harvest', () => {
    const { counts } = simulate({ newcomers: 6 });
    expect(counts).toHaveLength(6);
    for (const c of counts) expect(c).toBeGreaterThanOrEqual(4);
  });
});

// ---- M2 "The Coast" --------------------------------------------------------
import { craft as registeredCraft } from '../../../spacetimedb/src/reducers/craft';
import { init as registeredInit } from '../../../spacetimedb/src/reducers/lifecycle';
import { NODE_SEEDS, NodeKind } from '../nodes';
const craftReducer = registeredCraft as unknown as Reducer;

describe('M2: Coast nodes on the server', () => {
  const events = () => h.ctx.db.combatEvent.insert.mock.calls.map(([e]: any[]) => e);
  const nodes = () => [...h.trees.values()].filter((t) => t.id > 100);

  it('the tick seeds the 8 missing nodes once; seeding twice is a no-op and keeps node state', () => {
    for (const t of TREE_SEEDS) h.trees.set(t.id, { ...t, cooldownUntilTick: 0, harvester: undefined, kind: 0 });
    run();
    expect(nodes()).toHaveLength(NODE_SEEDS.length);
    expect(nodes().map((n) => [n.id, n.x, n.z, n.kind, n.itemId])).toEqual(NODE_SEEDS.map((n) => [n.id, n.x, n.z, n.kind, n.itemId]));
    h.trees.get(105).cooldownUntilTick = 999;
    run(2);
    expect(nodes()).toHaveLength(NODE_SEEDS.length);
    expect(h.trees.get(105).cooldownUntilTick).toBe(999);
    expect(h.trees.size).toBe(6 + NODE_SEEDS.length);
  });

  it('init seeds berry trees (kind 0) and nodes, and is idempotent', () => {
    const init = registeredInit as unknown as Reducer;
    const ctx = { ...h.ctx, db: { ...h.ctx.db, accessPolicy: { id: { find: () => ({}) } }, tickSchedule: { count: () => 1n } } };
    init(ctx);
    init(ctx);
    expect(h.trees.size).toBe(6 + NODE_SEEDS.length);
    expect(h.trees.get(1).kind).toBe(NodeKind.Berry);
    expect(h.trees.get(101).kind).toBe(NodeKind.Driftwood);
  });

  it.each([
    [101, 'driftwood', 4, 25],
    [105, 'flint', 6, 40],
  ])('node %i gives %s after %i ticks and regrows in %i; it never rolls for a stick', (id, itemId, harvestTicks, regrow) => {
    run(); // seed
    const node = h.trees.get(id);
    Object.assign(h.me(), { x: node.x + 1, z: node.z });
    giveStick();
    h.tick(worldTick());
    h.ctx.random.mockReturnValue(0);
    startHarvest(h.ctx, { treeId: id });
    const start = worldTick();
    expect(h.me().harvestEndTick).toBe(start + harvestTicks);
    run(harvestTicks - 1);
    expect(slotsOf(A).some((s) => s?.itemId === itemId)).toBe(false);
    run();
    expect(slotsOf(A).filter((s) => s?.itemId === itemId)).toEqual([{ itemId, quantity: 1 }]);
    expect(h.trees.get(id).cooldownUntilTick).toBe(start + harvestTicks + regrow);
    expect(h.ctx.random).not.toHaveBeenCalled();
    expect(events().map((e: any) => [e.kind, e.itemId])).toEqual([[EventKind.HarvestDone, itemId]]);
  });

  it('nodes never find sticks, even for a stickless player', () => {
    run();
    Object.assign(h.me(), { x: 26, z: 3 });
    h.ctx.random.mockReturnValue(0);
    h.tick(worldTick());
    startHarvest(h.ctx, { treeId: 101 });
    run(4);
    expect(slotsOf(A).some((s) => s?.itemId === STICK_ITEM_ID)).toBe(false);
    expect(h.ctx.random).not.toHaveBeenCalled();
  });

  it('a stickless player in the Grove cannot queue a node harvest: brambles message, nothing queued', () => {
    run();
    h.tick(worldTick());
    expect(() => startHarvest(h.ctx, { treeId: 101 })).toThrow(BRAMBLE_MESSAGE);
    expect(h.me().pending).toBe(Pending.None);
    expect(h.me().targetX).toBeUndefined();
  });

  it('a stick holder walks from spawn to a tide rock and gathers flint', () => {
    run();
    giveStick();
    h.tick(worldTick());
    startHarvest(h.ctx, { treeId: 105 });
    run(40);
    expect(slotsOf(A).find((s) => s?.itemId === 'flint')).toEqual({ itemId: 'flint', quantity: 1 });
  });
});

describe('M2: craft (the verb "make")', () => {
  function stock(items: [string, number, number][]) {
    h.inventory.clear();
    for (const [itemId, quantity, slot] of items) h.inventory.set(nextRow, { id: nextRow++, owner: A, slot, itemId, quantity });
  }

  it('1 driftwood + 2 flint makes a stone club; it wields and hits for 8', () => {
    stock([['stick', 1, 0], ['driftwood', 1, 1], ['flint', 3, 2]]);
    craftReducer(h.ctx, { recipe: 'stone_club' });
    const s = slotsOf(A);
    expect(s.slice(0, 3)).toEqual([{ itemId: 'stick', quantity: 1 }, { itemId: 'stone_club', quantity: 1 }, { itemId: 'flint', quantity: 1 }]);
    wield(h.ctx, { slot: 1 });
    expect(h.me().weapon).toBe('stone_club');
    outsideSafeRing();
    Object.assign(h.other(), { x: 36 });
    attack(h.ctx, { target: B });
    run();
    const hit = h.ctx.db.combatEvent.insert.mock.calls.map(([e]: any[]) => e).find((e: any) => e.kind === EventKind.Hit);
    expect(hit).toMatchObject({ damage: 8, itemId: 'stone_club' });
  });

  it('rejects unknown recipes, missing inputs, the dead, and anyone attacking', () => {
    stock([['driftwood', 1, 0], ['flint', 1, 1]]);
    expect(() => craftReducer(h.ctx, { recipe: 'boat' })).toThrow('no such recipe');
    expect(() => craftReducer(h.ctx, { recipe: 'stone_club' })).toThrow('You need 1 driftwood and 2 flint shard');
    stock([['driftwood', 1, 0], ['flint', 2, 1]]);
    h.me().hostile = true;
    expect(() => craftReducer(h.ctx, { recipe: 'stone_club' })).toThrow('Not while fighting');
    h.me().hostile = false;
    h.me().state = PlayerState.Dead;
    expect(() => craftReducer(h.ctx, { recipe: 'stone_club' })).toThrow('you are dead');
    expect(slotsOf(A).filter(Boolean)).toHaveLength(2);
  });

  it('a club that does not fit lands on the ground under you', () => {
    h.inventory.clear();
    for (let slot = 0; slot < INVENTORY_SIZE; slot++) {
      const itemId = slot === 0 ? 'driftwood' : slot === 1 ? 'flint' : 'berry_goldberry';
      h.inventory.set(nextRow, { id: nextRow++, owner: A, slot, itemId, quantity: 5 });
    }
    craftReducer(h.ctx, { recipe: 'stone_club' });
    expect([...h.ground.values()]).toEqual([expect.objectContaining({ itemId: 'stone_club', quantity: 1, x: 25, z: 25 })]);
    expect(slotsOf(A)[0]).toEqual({ itemId: 'driftwood', quantity: 4 });
    expect(slotsOf(A)[1]).toEqual({ itemId: 'flint', quantity: 3 });
  });
});

describe('the training dummy', () => {
  const attackDummy = registeredAttackDummy as unknown as Reducer;
  const hits = () => (h.ctx.db.dummyEvent.insert as any).mock.calls.map((c: any[]) => c[0]);
  const besideDummy = () => Object.assign(h.me(), { x: DUMMY_TILE.x - 1, z: DUMMY_TILE.z });

  it('is seeded by the tick, blocks its tile, and is written only when hit', () => {
    run();
    expect(h.dummies.get(DUMMY_ID)).toMatchObject({ x: DUMMY_TILE.x, z: DUMMY_TILE.z, hp: DUMMY_MAX_HP });
    const before = { ...h.dummies.get(DUMMY_ID) };
    const update = vi.spyOn(h.ctx.db.trainingDummy.id, 'update');
    run(5);
    expect(update).not.toHaveBeenCalled();
    expect(h.dummies.get(DUMMY_ID)).toEqual(before);
    move(h.ctx, { x: DUMMY_TILE.x, z: DUMMY_TILE.z });
    expect([h.me().targetX, h.me().targetZ]).not.toEqual([DUMMY_TILE.x, DUMMY_TILE.z]);
  });

  it('anyone can train on it, without a combat grant, even from the safe ring; it never hurts anyone', () => {
    h.grants.set('a', { identity: A, issuer: A, agent: false, expiresAtMicros: 200_000_000n, combat: false, chat: false });
    Object.assign(h.me(), { x: 27, z: 27 }); // a safe-ring corner, diagonal to the dummy
    attackDummy(h.ctx, { dummyId: DUMMY_ID });
    expect(h.me().pending).toBe(Pending.Dummy);
    run(1);
    expect(hits()).toHaveLength(1);
    expect(hits()[0]).toMatchObject({ dummyId: DUMMY_ID, damage: PUNCH_DAMAGE, hp: DUMMY_MAX_HP - PUNCH_DAMAGE, reset: false });
    expect(h.me().hp).toBe(20);
    expect((h.ctx.db.combatEvent.insert as any).mock.calls.filter((c: any[]) => c[0].kind === EventKind.Hit)).toHaveLength(0);
    run(SWING_INTERVAL_TICKS);
    expect(hits()).toHaveLength(2);
    expect(h.dummies.get(DUMMY_ID).hp).toBe(DUMMY_MAX_HP - 2 * PUNCH_DAMAGE);
  });

  it('walks over first, swings with the wielded stick, and re-selecting keeps the rhythm', () => {
    Object.assign(h.me(), { x: 20, z: 20, weapon: STICK_ITEM_ID });
    h.inventory.set(2n, { id: 2n, owner: A, slot: 1, itemId: STICK_ITEM_ID, quantity: 1 });
    attackDummy(h.ctx, { dummyId: DUMMY_ID });
    expect(h.me().targetX).toBeDefined();
    run(6);
    expect(Math.max(Math.abs(h.me().x - DUMMY_TILE.x), Math.abs(h.me().z - DUMMY_TILE.z))).toBe(1);
    expect(h.me().targetX).toBeUndefined();
    expect(hits().length).toBeGreaterThan(0);
    expect(hits()[0]).toMatchObject({ itemId: STICK_ITEM_ID, damage: ITEM_DEFS[STICK_ITEM_ID].weaponDamage });
    const next = h.me().nextSwingTick;
    attackDummy(h.ctx, { dummyId: DUMMY_ID });
    expect(h.me().nextSwingTick).toBe(next);
  });

  it('springs back to full instead of dying, and recovers lazily when left alone', () => {
    besideDummy();
    run();
    h.dummies.get(DUMMY_ID).hp = 2;
    h.dummies.get(DUMMY_ID).lastHitTick = 10;
    attackDummy(h.ctx, { dummyId: DUMMY_ID });
    run();
    expect(hits().at(-1)).toMatchObject({ reset: true, hp: DUMMY_MAX_HP });
    expect(h.dummies.get(DUMMY_ID).hp).toBe(DUMMY_MAX_HP);
    h.dummies.get(DUMMY_ID).hp = 10;
    cancel(h.ctx);
    run(DUMMY_IDLE_RESET_TICKS);
    attackDummy(h.ctx, { dummyId: DUMMY_ID });
    run();
    expect(hits().at(-1).hp).toBe(DUMMY_MAX_HP - PUNCH_DAMAGE);
  });

  it('moving stops training', () => {
    besideDummy();
    attackDummy(h.ctx, { dummyId: DUMMY_ID });
    move(h.ctx, { x: 35, z: 25 });
    expect(h.me().pending).toBe(Pending.None);
    run(3);
    expect(hits()).toHaveLength(0);
  });

  it('rejects unknown dummies and the dead', () => {
    expect(() => attackDummy(h.ctx, { dummyId: 9 })).toThrow('no such dummy');
    h.me().state = PlayerState.Dead;
    expect(() => attackDummy(h.ctx, { dummyId: DUMMY_ID })).toThrow('you are dead');
  });
});

describe('emotes', () => {
  const emote = registeredEmote as unknown as Reducer;
  const sent = () => (h.ctx.db.emoteEvent.insert as any).mock.calls.map((c: any[]) => c[0]);

  it('broadcasts a cosmetic event and changes nothing else', () => {
    Object.assign(h.me(), { targetX: 30, targetZ: 25 });
    emote(h.ctx, { emote: Emote.Wave });
    expect(sent()).toEqual([{ tick: 10, player: A, emote: Emote.Wave }]);
    expect(h.me().targetX).toBe(30);
  });

  it('is rate limited per player and validated', () => {
    emote(h.ctx, { emote: Emote.Cheer });
    expect(() => emote(h.ctx, { emote: Emote.Sit })).toThrow('slow down');
    h.tick(12);
    emote(h.ctx, { emote: Emote.Sit });
    expect(sent()).toHaveLength(2);
    h.ctx.sender = B;
    emote(h.ctx, { emote: Emote.Point });
    expect(() => emote(h.ctx, { emote: 42 })).toThrow('unknown emote');
    h.other().state = PlayerState.Dead;
    h.tick(20);
    expect(() => emote(h.ctx, { emote: Emote.Wave })).toThrow('you are dead');
  });
});

// ---------------------------------------------------------------------------
// M3 "The Boulders" and F3 "The Giant" on the server.
// ---------------------------------------------------------------------------
import { attackGiant as registeredAttackGiant } from '../../../spacetimedb/src/reducers/giant';
import {
  GIANT_ID, GIANT_MAX_HP, GIANT_MIN_CONTRIBUTION, GIANT_REACH, GIANT_RECOVER_TICKS,
  GIANT_SLAM_DAMAGE, GIANT_SLAM_WINDUP_TICKS, GIANT_TILE, GiantEventKind, GiantState,
} from '../giant';
import { triggerGiantRaid as registeredTrigger } from '../../../spacetimedb/src/reducers/giant';
import {
  RAID_ANNOUNCE_LEADS_MS, RAID_HP_BASE, RAID_INTERVAL_MS, RAID_MIN_CONTRIBUTION, RAID_REWARD, RAID_WINDOW_MS, RaidOutcome, raidMaxHp,
} from '../raid';
import { BOULDER_MESSAGE } from '../areas';
import { OBSIDIAN_ITEM_ID, STONE_CLUB_ITEM_ID } from '../items';

describe('M3/F3: the Boulders gate and the Giant', () => {
  const attackGiant = registeredAttackGiant as unknown as Reducer;
  const giantEvents = (kind?: number) => (h.ctx.db.giantEvent.insert as any).mock.calls.map((c: any[]) => c[0]).filter((e: any) => kind === undefined || e.kind === kind);
  function giveClub(owner = A, slot = 0) {
    const id = nextRow++;
    h.inventory.set(id, { id, owner, slot, itemId: STONE_CLUB_ITEM_ID, quantity: 1 });
  }
  /** A tile in reach, west of the footprint, and one outside the slam from it. */
  const WEST = { x: GIANT_TILE.x - GIANT_REACH, z: GIANT_TILE.z };
  const trigger = registeredTrigger as unknown as Reducer;
  const setMs = (ms: number) => { h.ctx.timestamp = { microsSinceUnixEpoch: BigInt(ms) * 1000n }; };
  const nowMsOf = () => Number(h.ctx.timestamp.microsSinceUnixEpoch / 1000n);
  /** Seed (asleep), then the world owner (A in this harness) wakes it. */
  function wake() { run(); trigger(h.ctx, { delaySeconds: 0 }); }

  it('the boulder line needs a stone club: a stick holder on the Coast is stopped with the boulders message', () => {
    h.inventory.clear();
    giveStick(A, 0);
    Object.assign(h.me(), { x: 46, z: 44 });
    move(h.ctx, { x: 55, z: 44 });
    expect(h.me()).toMatchObject({ targetX: 49, targetZ: 44 });
    expect(() => attackGiant(h.ctx, { giantId: GIANT_ID })).toThrow(BOULDER_MESSAGE);
    expect(h.me().pending).toBe(Pending.None);
    // Without a stick either, from the Grove, the brambles are named first.
    h.inventory.clear();
    Object.assign(h.me(), { x: 25, z: 25 });
    expect(() => attackGiant(h.ctx, { giantId: GIANT_ID })).toThrow(BRAMBLE_MESSAGE);
  });

  it('a club holder walks through; without the club the walk back home still works', () => {
    h.inventory.clear();
    giveClub();
    Object.assign(h.me(), { x: 46, z: 44 });
    move(h.ctx, { x: 55, z: 44 });
    expect(h.me()).toMatchObject({ targetX: 55, targetZ: 44 });
    run(6);
    expect([h.me().x, h.me().z]).toEqual([55, 44]);
    h.inventory.clear();
    move(h.ctx, { x: 46, z: 44 });
    run(6);
    expect([h.me().x, h.me().z]).toEqual([46, 44]);
  });

  it('is seeded asleep by the tick with the next UTC wake; asleep ticks write nothing', () => {
    run();
    expect(h.giants.get(GIANT_ID)).toMatchObject({ x: GIANT_TILE.x, z: GIANT_TILE.z, hp: GIANT_MAX_HP, state: GiantState.Asleep });
    expect(h.raids.get(GIANT_ID)).toMatchObject({ awake: false, nextWakeAtMicros: BigInt(RAID_INTERVAL_MS) * 1000n, announced: 0 });
    const update = h.ctx.db.giant.id.update as any;
    const raidUpdate = h.ctx.db.giantRaid.id.update as any;
    update.mockClear(); raidUpdate.mockClear();
    run(10);
    expect(update).not.toHaveBeenCalled();
    expect(raidUpdate).not.toHaveBeenCalled();
    expect(() => attackGiant(h.ctx, { giantId: GIANT_ID })).toThrow('The Giant is asleep. It wakes in 2:58:20');
  });

  it('awake and idle without anyone near: still no writes', () => {
    wake();
    const update = h.ctx.db.giant.id.update as any;
    update.mockClear();
    run(10);
    expect(update).not.toHaveBeenCalled();
  });

  it('announces at T-10 and T-1 minutes once each, then wakes on the hour with HP scaled by the Boulders crowd', () => {
    run();
    const wakeMs = RAID_INTERVAL_MS;
    setMs(wakeMs - RAID_ANNOUNCE_LEADS_MS[0] - 1000); run(3);
    expect(giantEvents(GiantEventKind.Announce)).toHaveLength(0);
    setMs(wakeMs - RAID_ANNOUNCE_LEADS_MS[0]); run(3);
    setMs(wakeMs - RAID_ANNOUNCE_LEADS_MS[1] + 500); run(3);
    expect(giantEvents(GiantEventKind.Announce).map((e: any) => e.quantity)).toEqual([10, 1]);
    // Two players stand in the Boulders at the wake, one in the Grove.
    Object.assign(h.me(), { x: 55, z: 55 });
    Object.assign(h.other(), { x: 53, z: 60 });
    setMs(wakeMs); run();
    expect(giantEvents(GiantEventKind.Wake)).toHaveLength(1);
    expect(giantEvents(GiantEventKind.Wake)[0]).toMatchObject({ hp: raidMaxHp(2), quantity: 2 });
    expect(h.giants.get(GIANT_ID)).toMatchObject({ state: GiantState.Idle, hp: raidMaxHp(2), maxHp: raidMaxHp(2) });
    expect(h.raids.get(GIANT_ID)).toMatchObject({ awake: true, raidPlayers: 2, raidCount: 1, raidEndsAtMicros: BigInt(wakeMs + RAID_WINDOW_MS) * 1000n });
  });

  it('goes back to sleep undefeated when the window ends; swings queued at it stop', () => {
    h.inventory.clear();
    giveClub();
    wake();
    Object.assign(h.me(), { x: GIANT_TILE.x - 5, z: GIANT_TILE.z, weapon: STONE_CLUB_ITEM_ID });
    attackGiant(h.ctx, { giantId: GIANT_ID });
    setMs(nowMsOf() + RAID_WINDOW_MS); run();
    expect(h.giants.get(GIANT_ID)).toMatchObject({ state: GiantState.Asleep, hp: GIANT_MAX_HP });
    expect(h.raids.get(GIANT_ID)).toMatchObject({ awake: false, lastOutcome: RaidOutcome.Slept, nextWakeAtMicros: BigInt(RAID_INTERVAL_MS) * 1000n });
    expect(giantEvents(GiantEventKind.Sleep)[0]).toMatchObject({ quantity: RaidOutcome.Slept });
    expect(h.me().pending).toBe(Pending.None);
    expect(h.contributions.size).toBe(0);
  });

  it('no idle regeneration or contribution reset during a raid: the window is the limit', () => {
    h.inventory.clear();
    giveClub();
    wake();
    Object.assign(h.me(), { ...WEST, weapon: STONE_CLUB_ITEM_ID, respawnTick: 100_000 }); // grace: its blows skip A
    attackGiant(h.ctx, { giantId: GIANT_ID });
    run(1);
    const hpAfterHit = h.giants.get(GIANT_ID).hp;
    expect(hpAfterHit).toBe(RAID_HP_BASE - 8);
    expect(h.contributions.get('a').damage).toBe(8);
    cancel(h.ctx);
    run(3 * 100); // far past the old 100-tick regeneration
    expect(h.giants.get(GIANT_ID).hp).toBe(hpAfterHit);
    attackGiant(h.ctx, { giantId: GIANT_ID });
    run(1);
    expect(h.giants.get(GIANT_ID).hp).toBe(hpAfterHit - 8);
    expect(h.contributions.get('a').damage).toBe(16);
  });

  it('a raid missed entirely (the module was down) just reschedules', () => {
    run();
    setMs(RAID_INTERVAL_MS + RAID_WINDOW_MS + 5000); run();
    expect(giantEvents(GiantEventKind.Wake)).toHaveLength(0);
    expect(h.raids.get(GIANT_ID)).toMatchObject({ awake: false, nextWakeAtMicros: BigInt(2 * RAID_INTERVAL_MS) * 1000n });
  });

  it('only the world owner can trigger a raid, and never twice at once; a delay moves the next wake', () => {
    run();
    as(B, () => expect(() => trigger(h.ctx, { delaySeconds: 0 })).toThrow('world owner required'));
    trigger(h.ctx, { delaySeconds: 90 });
    expect(h.raids.get(GIANT_ID).nextWakeAtMicros).toBe(h.ctx.timestamp.microsSinceUnixEpoch + 90_000_000n);
    trigger(h.ctx, { delaySeconds: 0 });
    expect(h.raids.get(GIANT_ID).awake).toBe(true);
    expect(h.giants.get(GIANT_ID).hp).toBe(RAID_HP_BASE);
    expect(() => trigger(h.ctx, { delaySeconds: 0 })).toThrow('A raid is already on');
  });

  it('open to players without the combat grant; hitting it never ends grace or makes anyone hostile', () => {
    h.grants.set('a', { identity: A, issuer: A, agent: false, expiresAtMicros: 200_000_000n, combat: false, chat: false });
    h.inventory.clear();
    giveClub();
    wake();
    Object.assign(h.me(), { x: GIANT_TILE.x - 5, z: GIANT_TILE.z, weapon: STONE_CLUB_ITEM_ID, respawnTick: 5000 });
    attackGiant(h.ctx, { giantId: GIANT_ID });
    expect(h.me()).toMatchObject({ pending: Pending.Giant, targetX: WEST.x, targetZ: WEST.z });
    run(3);
    const hits = giantEvents(GiantEventKind.Hit);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]).toMatchObject({ damage: 8, itemId: STONE_CLUB_ITEM_ID, hp: RAID_HP_BASE - 8 });
    expect(h.me()).toMatchObject({ respawnTick: 5000, hostile: false, combatTarget: undefined });
    expect(h.contributions.get('a').damage).toBe(8 * hits.length);
  });

  it('telegraphs a slam on a player tile; staying hurts, stepping out in time does not', () => {
    h.inventory.clear();
    giveClub(A); giveClub(B);
    wake();
    Object.assign(h.me(), { ...WEST, hp: 30 });
    Object.assign(h.other(), { x: GIANT_TILE.x + 5, z: GIANT_TILE.z, hp: 30 });
    run(); // A is nearest: the wind-up starts on A's tile
    const g = h.giants.get(GIANT_ID);
    expect(g).toMatchObject({ state: GiantState.Windup, slamX: WEST.x, slamZ: WEST.z });
    expect(giantEvents(GiantEventKind.Windup)).toHaveLength(1);
    run(GIANT_SLAM_WINDUP_TICKS);
    expect(h.me().hp).toBe(30 - GIANT_SLAM_DAMAGE);
    expect(giantEvents(GiantEventKind.PlayerHit)[0]).toMatchObject({ damage: GIANT_SLAM_DAMAGE, hp: 30 - GIANT_SLAM_DAMAGE });
    expect(h.giants.get(GIANT_ID).state).toBe(GiantState.Recover);
    // Next wind-up after recovering, on A again; A walks two tiles west this time.
    run(GIANT_RECOVER_TICKS);
    expect(h.giants.get(GIANT_ID).state).toBe(GiantState.Windup);
    move(h.ctx, { x: WEST.x - 2, z: WEST.z });
    run(GIANT_SLAM_WINDUP_TICKS);
    expect(h.me().hp).toBe(30 - GIANT_SLAM_DAMAGE);
    expect(h.other().hp).toBe(30);
  });

  it('a raid defeat rewards every contributor who dealt enough, equally (obsidian + the Giant\'s Tooth), then it sleeps', () => {
    h.inventory.clear();
    giveClub(A); giveClub(B);
    wake();
    Object.assign(h.giants.get(GIANT_ID), { hp: 11, lastHitTick: worldTick() });
    Object.assign(h.me(), { ...WEST, weapon: STONE_CLUB_ITEM_ID });
    Object.assign(h.other(), { x: GIANT_TILE.x + GIANT_REACH, z: GIANT_TILE.z, weapon: '' });
    attackGiant(h.ctx, { giantId: GIANT_ID });
    as(B, () => attackGiant(h.ctx, { giantId: GIANT_ID }));
    h.contributions.set('a', { identity: A, giantId: GIANT_ID, damage: RAID_MIN_CONTRIBUTION, lastHitTick: worldTick() });
    run(1); // one round: A 8 + B 3 floors 11
    expect(h.giants.get(GIANT_ID).state).toBe(GiantState.Asleep);
    expect(h.raids.get(GIANT_ID)).toMatchObject({ awake: false, lastOutcome: RaidOutcome.Defeated });
    expect(giantEvents(GiantEventKind.Defeat)).toHaveLength(1);
    const rewards = giantEvents(GiantEventKind.Reward);
    expect(rewards.map((r: any) => r.player.toHexString())).toEqual(['a']);
    expect(slotsOf(A).filter((s) => s?.itemId === OBSIDIAN_ITEM_ID)).toEqual([{ itemId: OBSIDIAN_ITEM_ID, quantity: RAID_REWARD.quantity }]);
    expect(slotsOf(B).some((s) => s?.itemId === OBSIDIAN_ITEM_ID)).toBe(false);
    expect(h.cosmetics.get('a').unlocked & (1 << Cosmetic.GiantsTooth)).toBeTruthy();
    expect(h.cosmetics.get('b')).toBeUndefined();
    expect(h.contributions.size).toBe(0);
    expect(h.me().pending).toBe(Pending.None);
    expect(() => attackGiant(h.ctx, { giantId: GIANT_ID })).toThrow('The Giant is asleep');
    // The reward carries no power: same max HP, same club.
    expect(h.me().maxHp).toBe(30);
    expect(GIANT_MIN_CONTRIBUTION).toBeLessThan(RAID_MIN_CONTRIBUTION);
  });
});

// ---- F2 skills, recipes and milestone cosmetics ------------------------------
import { wearCosmetic as registeredWear } from '../../../spacetimedb/src/reducers/appearance';
import { Cosmetic, CosmeticSlot, xpForLevel } from '../skills';

describe('F2: skills, level-gated recipes and cosmetics on the server', () => {
  const wear = registeredWear as unknown as Reducer;
  function stock(items: [string, number, number][]) {
    h.inventory.clear();
    for (const [itemId, quantity, slot] of items) h.inventory.set(nextRow, { id: nextRow++, owner: A, slot, itemId, quantity });
  }
  const skill = () => h.skills.get('a');
  const cosmetic = () => h.cosmetics.get('a');
  function harvestOnce(tree: Record<string, unknown>) {
    h.trees.set(1, { id: 1, x: 26, z: 25, harvester: A, cooldownUntilTick: 0, kind: 0, ...tree });
    for (const t of NODE_SEEDS) h.trees.set(t.id, { ...t, cooldownUntilTick: 0, harvester: undefined });
    Object.assign(h.me(), { harvestTreeId: 1, harvestEndTick: worldTick() + 1 });
    run();
  }

  it('a finished berry harvest earns Foraging XP; a Coast node earns Beachcombing', () => {
    harvestOnce({ itemId: 'berry_blueberry' });
    expect(skill()).toMatchObject({ foragingXp: 8, beachcombingXp: 0, craftingXp: 0 });
    harvestOnce({ itemId: 'flint', kind: NodeKind.TideRock });
    expect(skill()).toMatchObject({ foragingXp: 8, beachcombingXp: 10 });
  });

  it('levels shave harvest ticks (max -2, never below 3) but never at the gold tree', () => {
    h.skills.set('a', { identity: A, foragingXp: xpForLevel(20), beachcombingXp: xpForLevel(30), craftingXp: 0 });
    Object.assign(h.me(), { x: 29, z: 25 });
    h.trees.set(4, { id: 4, x: 30, z: 25, itemId: 'berry_blueberry', cooldownUntilTick: 0, kind: 0 });
    startHarvest(h.ctx, { treeId: 4 });
    expect(h.me().harvestEndTick - worldTick()).toBe(HARVEST_TICKS - 2);
    cancel(h.ctx);
    h.trees.set(3, { id: 3, x: 28, z: 25, itemId: 'berry_goldberry', cooldownUntilTick: 0, kind: 0 });
    h.tick(11);
    startHarvest(h.ctx, { treeId: 3 });
    expect(h.me().harvestEndTick - worldTick()).toBe(HARVEST_TICKS);
    cancel(h.ctx);
    h.trees.set(101, { id: 101, x: 30, z: 26, itemId: 'driftwood', cooldownUntilTick: 0, kind: NodeKind.Driftwood });
    h.tick(12);
    startHarvest(h.ctx, { treeId: 101 });
    expect(h.me().harvestEndTick - worldTick()).toBe(3); // 4 - 2 would be 2: clamped to 3
  });

  it('crafting earns Crafting XP; a level-gated recipe is rejected below its level', () => {
    stock([['driftwood', 5, 0], ['flint', 5, 1]]);
    expect(() => craftReducer(h.ctx, { recipe: 'flint_knife' })).toThrow('Needs Crafting level 2');
    craftReducer(h.ctx, { recipe: 'stone_club' });
    expect(skill().craftingXp).toBe(40);
    craftReducer(h.ctx, { recipe: 'flint_knife' }); // 40 XP is level 2
    expect(slotsOf(A).some((s) => s?.itemId === 'flint_knife')).toBe(true);
    expect(skill().craftingXp).toBe(65);
  });

  it('the Driftwood Crown recipe unlocks and wears a cosmetic instead of making an item, once', () => {
    h.skills.set('a', { identity: A, foragingXp: 0, beachcombingXp: 0, craftingXp: xpForLevel(5) });
    stock([['driftwood', 6, 0], ['flint', 2, 1]]);
    craftReducer(h.ctx, { recipe: 'driftwood_crown' });
    expect(cosmetic()).toMatchObject({ unlocked: 1 << Cosmetic.DriftwoodCrown, head: Cosmetic.DriftwoodCrown + 1 });
    expect(slotsOf(A).slice(0, 2)).toEqual([{ itemId: 'driftwood', quantity: 3 }, { itemId: 'flint', quantity: 1 }]);
    expect(() => craftReducer(h.ctx, { recipe: 'driftwood_crown' })).toThrow('You already have the Driftwood Crown');
  });

  it('berry mash is food: 2 greenberry + 1 strawberry, eaten for 7', () => {
    stock([['berry_greenberry', 2, 0], ['berry_strawberry', 1, 1]]);
    craftReducer(h.ctx, { recipe: 'berry_mash' });
    const slot = slotsOf(A).findIndex((s) => s?.itemId === 'berry_mash');
    h.me().hp = 10;
    eat(h.ctx, { slot });
    expect(h.me().hp).toBe(17);
  });

  it('a Foraging level-up past 10 unlocks the Flower Crown; XP never changes damage or HP', () => {
    h.skills.set('a', { identity: A, foragingXp: xpForLevel(10) - 1, beachcombingXp: 0, craftingXp: 0 });
    const before = { maxHp: h.me().maxHp };
    harvestOnce({ itemId: 'berry_blueberry' });
    expect(cosmetic().unlocked & (1 << Cosmetic.FlowerCrown)).toBeTruthy();
    expect(h.me().maxHp).toBe(before.maxHp);
  });

  it('the first stick unlocks the Straw Hat; stepping onto the Coast unlocks the Coast Scarf', () => {
    h.ctx.random.mockReturnValue(0);
    h.skills.set('a', { identity: A, foragingXp: 24, beachcombingXp: 0, craftingXp: 0 });
    harvestOnce({ itemId: 'berry_blueberry' });
    expect(cosmetic()).toMatchObject({ head: Cosmetic.StrawHat + 1 });
    Object.assign(h.me(), { x: 25, z: 9, harvestTreeId: 0, harvestEndTick: 0 });
    move(h.ctx, { x: 25, z: 6 });
    run(2);
    expect(h.me().z).toBe(6);
    expect(cosmetic().unlocked & (1 << Cosmetic.CoastScarf)).toBeTruthy();
    expect(cosmetic().neck).toBe(Cosmetic.CoastScarf + 1);
  });

  it('wearCosmetic only wears earned cosmetics in their own slot; 0 takes it off', () => {
    expect(() => wear(h.ctx, { slot: CosmeticSlot.Head, cosmetic: Cosmetic.StrawHat + 1 })).toThrow('You have not earned that yet');
    h.cosmetics.set('a', { identity: A, unlocked: (1 << Cosmetic.StrawHat) | (1 << Cosmetic.CoastScarf), head: 0, neck: 0 });
    expect(() => wear(h.ctx, { slot: CosmeticSlot.Neck, cosmetic: Cosmetic.StrawHat + 1 })).toThrow('You have not earned that yet');
    h.tick(20);
    wear(h.ctx, { slot: CosmeticSlot.Head, cosmetic: Cosmetic.StrawHat + 1 });
    h.tick(21);
    wear(h.ctx, { slot: CosmeticSlot.Neck, cosmetic: Cosmetic.CoastScarf + 1 });
    expect(cosmetic()).toMatchObject({ head: 1, neck: 2 });
    h.tick(22);
    wear(h.ctx, { slot: CosmeticSlot.Head, cosmetic: 0 });
    expect(cosmetic().head).toBe(0);
  });
});


describe('character creation and rename', () => {
  it('saves all details and the trimmed name only for the sender', () => {
    const h=harness(), before={...h.me()}, other={...h.other()};
    const choices={...DEFAULT_APPEARANCE,hairStyle:8,bodyType:2,faceShape:3,eyeColor:7,facialHair:3,outfitStyle:3,trouserColor:7,bootColor:5,accessory:5,accessoryColor:9};
    saveCharacter(h.ctx,{name:'  Fern  ',...choices});
    expect(h.me().name).toBe('Fern');expect(h.appearances.get('a')).toEqual({identity:A,...choices,setupComplete:true});
    expect(h.other()).toEqual(other);expect(h.me().hp).toBe(before.hp);expect(h.me().x).toBe(before.x);
    setAppearance(h.ctx,{hairStyle:1,skinTone:0,hairColor:0,robeColor:0,wrapColor:0});
    expect(h.appearances.get('a')).toMatchObject({bodyType:2,accessory:5,setupComplete:true,hairStyle:1});
  });
  it.each(['', 'x', 'A name far too long', 'hello!'])('rejects invalid name %s without completing setup', name=>{
    const h=harness();expect(()=>saveCharacter(h.ctx,{name,...DEFAULT_APPEARANCE})).toThrow();expect(h.appearances.size).toBe(0);expect(h.me().name).toBe('Player-a');
  });
  it('rejects a case-insensitive duplicate without changing an existing look',()=>{
    const h=harness();h.other().name='Fern';h.appearances.set('a',{identity:A,...DEFAULT_APPEARANCE,setupComplete:false});
    expect(()=>saveCharacter(h.ctx,{name:'fERN',...DEFAULT_APPEARANCE,robeColor:3})).toThrow('already taken');
    expect(h.me().name).toBe('Player-a');expect(h.appearances.get('a').robeColor).toBe(0);expect(h.appearances.get('a').setupComplete).toBe(false);
  });
  it.each(['bodyType','faceShape','eyeColor','facialHair','outfitStyle','trouserColor','bootColor','accessory','accessoryColor'])('rejects invalid %s before writing',key=>{
    const h=harness();expect(()=>saveCharacter(h.ctx,{name:'Fern',...DEFAULT_APPEARANCE,[key]:255})).toThrow('available styles');expect(h.appearances.size).toBe(0);expect(h.me().name).toBe('Player-a');
  });
});
