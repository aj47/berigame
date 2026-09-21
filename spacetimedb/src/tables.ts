import { table, t } from 'spacetimedb/server';

/** Singleton (id = 0). Written every tick; clients use its updates as the tick heartbeat. */
export const world = table(
  { name: 'world', public: true },
  {
    id: t.u8().primaryKey(),
    tick: t.u32(),
    tickStartedAt: t.timestamp(),
  }
);

/** One row, inserted by `init`, drives the 600ms `tick` reducer. */
export const tickSchedule = table(
  { name: 'tick_schedule' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

export const player = table(
  {
    name: 'player',
    public: true,
    indexes: [{ accessor: 'by_pos', algorithm: 'btree', columns: ['x', 'z'] }],
  },
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    online: t.bool(),
    /** Open connections for this identity (multiple tabs). Offline only when it hits 0. */
    connections: t.u8(),
    lastSeenAt: t.timestamp(),

    // position (tile coords, 0..49)
    x: t.i32(),
    z: t.i32(),
    /** 0..7, see shared/sim Facing */
    facing: t.u8(),
    targetX: t.option(t.i32()),
    targetZ: t.option(t.i32()),

    // vitals
    hp: t.u8(),
    maxHp: t.u8(),
    /** shared/sim PlayerState */
    state: t.u8(),
    respawnTick: t.u32(),

    // combat
    /** shared/sim Stance */
    stance: t.u8(),
    /** shared/sim FightState */
    fightState: t.u8(),
    combatTarget: t.option(t.identity()),
    /** true = attacking combatTarget, false = just following them */
    hostile: t.bool(),
    nextSwingTick: t.u32(),
    lastExchangeTick: t.u32(),
    outOfRangeTicks: t.u8(),

    // queued "walk there, then..." interaction
    /** shared/sim Pending */
    pending: t.u8(),
    pendingId: t.u64(),
    /** 0 = not harvesting */
    harvestTreeId: t.u32(),
    harvestEndTick: t.u32(),
    eatCooldownUntilTick: t.u32(),

    // anti-spam
    lastInputTick: t.u32(),
    inputsThisTick: t.u8(),
  }
);

/** Public so clients can subscribe, but a visibility filter restricts rows to their owner. */
export const inventorySlot = table(
  { name: 'inventory_slot', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    owner: t.identity().index('btree'),
    slot: t.u8(),
    itemId: t.string(),
    quantity: t.u8(),
  }
);

export const groundItem = table(
  { name: 'ground_item', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    itemId: t.string(),
    quantity: t.u8(),
    x: t.i32(),
    z: t.i32(),
    droppedBy: t.identity(),
    droppedTick: t.u32(),
    expiresTick: t.u32(),
    droppedOnDeath: t.bool(),
  }
);

export const tree = table(
  { name: 'tree', public: true },
  {
    id: t.u32().primaryKey(),
    x: t.i32(),
    z: t.i32(),
    itemId: t.string(),
    cooldownUntilTick: t.u32(),
    harvester: t.option(t.identity()),
  }
);

export const chatMessage = table(
  { name: 'chat_message', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    sender: t.identity(),
    text: t.string(),
    tick: t.u32(),
    sentAt: t.timestamp(),
  }
);

/**
 * Event table: rows are broadcast to subscribers' onInsert callbacks and never
 * stored, so nothing needs expiring. Drives damage numbers and animations.
 */
export const combatEvent = table(
  { name: 'combat_event', public: true, event: true },
  {
    tick: t.u32(),
    /** shared/sim EventKind */
    kind: t.u8(),
    attacker: t.identity(),
    defender: t.identity(),
    damage: t.u8(),
    attackerStance: t.u8(),
    defenderStance: t.u8(),
    attackerState: t.u8(),
    defenderState: t.u8(),
    defenderHp: t.u8(),
  }
);

/** Cosmetic-only data. Absent rows render the default starter appearance. */
export const appearance = table(
  { name: 'appearance', public: true },
  {
    identity: t.identity().primaryKey(),
    hairStyle: t.u8(),
    skinTone: t.u8(),
    hairColor: t.u8(),
    robeColor: t.u8(),
    wrapColor: t.u8(),
  }
);
