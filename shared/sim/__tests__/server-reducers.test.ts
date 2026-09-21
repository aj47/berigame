import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EAT_SWING_DELAY_TICKS, HARVEST_TICKS, INVENTORY_SIZE, MAX_INPUTS_PER_TICK, MAX_STACK, MOVEMENT_STEPS_PER_TICK, SWING_INTERVAL_TICKS, TICK_MS } from '../constants';
import { FightState, Pending, PlayerState, Stance } from '../types';

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
import { attack as registeredAttack, follow as registeredFollow, setStance as registeredStance } from '../../../spacetimedb/src/reducers/combat';
import { cancel as registeredCancel, setTarget as registeredTarget } from '../../../spacetimedb/src/reducers/movement';
vi.mock('../../../spacetimedb/src/tables', () => ({ tickSchedule: { rowType: {} } }));
import { tick as registeredTick } from '../../../spacetimedb/src/reducers/tick';
import { giveItem } from '../../../spacetimedb/src/lib/inventory';
import { eatBerry as registeredEat, pickupItem as registeredPickup } from '../../../spacetimedb/src/reducers/inventory';

import { setAppearance as registeredAppearance } from '../../../spacetimedb/src/reducers/appearance';
import { DEFAULT_APPEARANCE } from '../appearance';

type Reducer = (ctx: any, args?: any) => void;
const setAppearance = registeredAppearance as unknown as Reducer;
const attack = registeredAttack as unknown as Reducer;
const follow = registeredFollow as unknown as Reducer;
const stance = registeredStance as unknown as Reducer;
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
    identity: id, online: true, state: PlayerState.Alive, stance: Stance.Strike,
    x: 25, z: 25, hp: 20, maxHp: 30, hostile: false, combatTarget: undefined,
    nextSwingTick: 0, outOfRangeTicks: 0, harvestTreeId: 0, harvestEndTick: 0, fightState: FightState.Neutral, pending: 0, pendingId: 0n,
    lastInputTick: 0, inputsThisTick: 0, eatCooldownUntilTick: 0,
  });
  const inventory = new Map([[1n, { id: 1n, owner: A, slot: 0, itemId: 'berry_blueberry', quantity: 2 }]]);
  const appearances = new Map<string, any>();
  const ground = new Map<bigint, any>();
  const trees = new Map<number, any>();
  const ctx = {
    sender: A, identity: A, timestamp: {},
    db: {
      appearance: { insert: (row: any) => appearances.set(row.identity.toHexString(), row), identity: { find: (id: typeof A) => appearances.get(id.toHexString()), update: (row: any) => appearances.set(row.identity.toHexString(), row) } },
      world: { id: { find: () => ({ id: 0, tick: now }), update: (row: any) => { now = row.tick; } } },
      player: { iter: () => players.values(), identity: {
        find: (id: typeof A) => players.get(id.toHexString()),
        update: (p: any) => players.set(p.identity.toHexString(), p),
      } },
      tree: { iter: () => trees.values(), id: { find: (id: number) => trees.get(id), update: (row: any) => trees.set(row.id, row) } },
      inventorySlot: {
        owner: { filter: () => inventory.values() },
        insert: (row: any) => { const id = BigInt(inventory.size + 1); inventory.set(id, { ...row, id }); },
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
  return { ctx, inventory, ground, trees, appearances, tick: (value: number) => { now = value; }, me: () => players.get('a'), other: () => players.get('b') };
}

let h: ReturnType<typeof harness>;
beforeEach(() => { h = harness(); });

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

describe('authoritative stance input rate limit', () => {
  it('rejects changed-stance spam after the shared per-tick input budget and allows the next tick', () => {
    for (let i = 0; i < MAX_INPUTS_PER_TICK; i++) {
      stance(h.ctx, { stance: (i + 1) % 3 });
    }
    const before = h.me().stance;
    expect(() => stance(h.ctx, { stance: (before + 1) % 3 })).toThrow('slow down');
    expect(h.me().stance).toBe(before);
    h.tick(11);
    stance(h.ctx, { stance: (before + 1) % 3 });
    expect(h.me().inputsThisTick).toBe(1);
  });

  it('stance and attack commands share a budget; duplicate stance is a harmless no-op', () => {
    for (let i = 0; i < MAX_INPUTS_PER_TICK - 1; i++) attack(h.ctx, { target: B });
    stance(h.ctx, { stance: Stance.Guard });
    expect(h.me().inputsThisTick).toBe(MAX_INPUTS_PER_TICK);
    stance(h.ctx, { stance: Stance.Guard });
    expect(h.me().inputsThisTick).toBe(MAX_INPUTS_PER_TICK);
    expect(() => attack(h.ctx, { target: B })).toThrow('slow down');
    expect(() => stance(h.ctx, { stance: Stance.Grab })).toThrow('slow down');
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
