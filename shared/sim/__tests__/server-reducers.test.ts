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
  default: { reducer: (...args: unknown[]) => args[args.length - 1] },
}));
import { attack as registeredAttack, follow as registeredFollow, unwield as registeredUnwield, wieldItem as registeredWield } from '../../../spacetimedb/src/reducers/combat';
import { cancel as registeredCancel, setTarget as registeredTarget } from '../../../spacetimedb/src/reducers/movement';
vi.mock('../../../spacetimedb/src/tables', () => ({ tickSchedule: { rowType: {} } }));
import { tick as registeredTick } from '../../../spacetimedb/src/reducers/tick';
import { giveItem } from '../../../spacetimedb/src/lib/inventory';
import { dropItem as registeredDrop, eatBerry as registeredEat, moveItem as registeredMove, pickupItem as registeredPickup } from '../../../spacetimedb/src/reducers/inventory';

import { setAppearance as registeredAppearance } from '../../../spacetimedb/src/reducers/appearance';
import { DEFAULT_APPEARANCE } from '../appearance';

type Reducer = (ctx: any, args?: any) => void;
const setAppearance = registeredAppearance as unknown as Reducer;
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
    identity: id, online: true, state: PlayerState.Alive,
    x: 25, z: 25, hp: 20, maxHp: 30, hostile: false, combatTarget: undefined,
    nextSwingTick: 0, harvestTreeId: 0, harvestEndTick: 0, pending: 0, pendingId: 0n,
    lastInputTick: 0, inputsThisTick: 0, eatCooldownUntilTick: 0, weapon: '',
  });
  const inventory = new Map([[1n, { id: 1n, owner: A, slot: 0, itemId: 'berry_blueberry', quantity: 2 }]]);
  const appearances = new Map<string, any>();
  const ground = new Map<bigint, any>();
  const trees = new Map<number, any>();
  const grants = new Map<string, any>();
  // Ids are never reused, like the real autoInc column, so a delete then insert cannot overwrite a row.
  let nextInventoryId = 100n;
  const ctx = {
    // ctx.random stands in for the server's deterministic RNG; the default roll never finds a stick.
    random: vi.fn(() => 0.99),
    sender: A, identity: A, timestamp: { microsSinceUnixEpoch: 100_000_000n },
    db: {
      accessPolicy: { id: { find: () => ({ id: 0, owner: A, gateway: B, requireAdmission: false }) } },
      playerGrant: { identity: { find: (id: typeof A) => grants.get(id.toHexString()) } },
      appearance: { insert: (row: any) => appearances.set(row.identity.toHexString(), row), identity: { find: (id: typeof A) => appearances.get(id.toHexString()), update: (row: any) => appearances.set(row.identity.toHexString(), row) } },
      world: { id: { find: () => ({ id: 0, tick: now }), update: (row: any) => { now = row.tick; } } },
      player: { iter: () => players.values(), identity: {
        find: (id: typeof A) => players.get(id.toHexString()),
        update: (p: any) => players.set(p.identity.toHexString(), p),
      } },
      tree: { iter: () => trees.values(), id: { find: (id: number) => trees.get(id), update: (row: any) => trees.set(row.id, row) } },
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
    },
  };
  return { ctx, inventory, ground, trees, appearances, grants, tick: (value: number) => { now = value; }, me: () => players.get('a'), other: () => players.get('b') };
}

let h: ReturnType<typeof harness>;
beforeEach(() => { h = harness(); });

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
  beforeEach(() => { Object.assign(h.other(), { x: 26, z: 25, hp: 30 }); });

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
    expect(h.other()).toMatchObject({ x: 26, z: 25 });
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

describe('stick drops from harvesting', () => {
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
  it('cannot cut diagonally out of a corner enclosed by two blocked neighbors', () => {
    Object.assign(h.me(), { x: 0, z: 0, targetX: 2, targetZ: 2 });
    h.trees.set(1, { id: 1, x: 1, z: 0 }); h.trees.set(2, { id: 2, x: 0, z: 1 });
    scheduledTick(h.ctx, { timer: {} }); expect(h.me()).toMatchObject({ x: 0, z: 0 });
  });
  it.each(['follow', 'attack'])('%s stops at first melee-range tile without changing swing recovery', (mode) => {
    Object.assign(h.other(), { x: 27, z: 25 });
    h.me().nextSwingTick = 40;
    (mode === 'follow' ? follow : attack)(h.ctx, { target: B });
    scheduledTick(h.ctx, { timer: {} });
    expect(h.me()).toMatchObject({ x: 26, z: 25, nextSwingTick: 40 });
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
