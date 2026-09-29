import { table, t } from 'spacetimedb/server';

/** Public configuration, never credentials. The publisher is captured by init. */
export const accessPolicy = table({ name: 'access_policy', public: true }, {
  id: t.u8().primaryKey(),
  owner: t.identity(),
  gateway: t.option(t.identity()),
  requireAdmission: t.bool(),
});

/** Server-enforced permits. Clients cannot read or write these rows. */
export const playerGrant = table({ name: 'player_grant' }, {
  identity: t.identity().primaryKey(),
  issuer: t.identity(),
  agent: t.bool(),
  expiresAtMicros: t.u64(),
  combat: t.bool(),
  chat: t.bool(),
});

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
    /**
     * Retired rock-paper-scissors columns (stance, fightState, lastExchangeTick,
     * outOfRangeTicks). SpacetimeDB cannot drop or reorder columns without a
     * manual migration, so they stay, always 0 and never read.
     */
    stance: t.u8(),
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

    // Appended columns: new columns must go last and carry a default.
    /** Item id of the wielded weapon, e.g. 'stick'; '' = bare fists (punch). Public so everyone can draw it. */
    weapon: t.string().default(''),
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
    // Appended columns: new columns must go last and carry a default.
    /** shared/sim NodeKind: 0 berry tree, 1 driftwood pile, 2 tide rock. */
    kind: t.u8().default(0),
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
    // Appended columns: new columns must go last and carry a default.
    /** Where the sender stood when they said it, for the Nearby chat filter (-1 = unknown, an older row). */
    x: t.i32().default(-1),
    z: t.i32().default(-1),
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
    /** Hit: the attacker's weapon at swing time ('' = punch). HarvestDone / ItemFound: the item gained. */
    itemId: t.string(),
    defenderHp: t.u8(),
  }
);

/**
 * Static practice posts (one: shared/sim DUMMY_TILE). Written only when hit;
 * idle HP recovery is computed from `lastHitTick` (dummyHpAt), so an idle
 * dummy costs the tick nothing.
 */
export const trainingDummy = table(
  { name: 'training_dummy', public: true },
  {
    id: t.u32().primaryKey(),
    x: t.i32(),
    z: t.i32(),
    hp: t.u8(),
    maxHp: t.u8(),
    lastHitTick: t.u32(),
  }
);

/** Event table: one row per swing that lands on a dummy. Drives its damage numbers and wobble. */
export const dummyEvent = table(
  { name: 'dummy_event', public: true, event: true },
  {
    tick: t.u32(),
    dummyId: t.u32(),
    attacker: t.identity(),
    damage: t.u8(),
    /** The attacker's weapon at swing time ('' = punch). */
    itemId: t.string(),
    /** HP after the hit (maxHp again when the blow reset it). */
    hp: t.u8(),
    reset: t.bool(),
  }
);

/** Event table: cosmetic emotes (shared/sim Emote), broadcast and never stored. */
export const emoteEvent = table(
  { name: 'emote_event', public: true, event: true },
  {
    tick: t.u32(),
    player: t.identity(),
    emote: t.u8(),
  }
);

/** Private: each player's last accepted emote tick, for the emote cooldown. */
export const emoteCooldown = table(
  { name: 'emote_cooldown' },
  {
    identity: t.identity().primaryKey(),
    lastTick: t.u32(),
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

/**
 * Private, anonymous gameplay funnel (docs/ANALYTICS.md). One row per player
 * identity holding the first time each milestone was reached. No names, no
 * IPs, no chat. Only the database owner can read it (e.g. `spacetime sql`).
 */
export const playStats = table(
  { name: 'play_stats' },
  {
    identity: t.identity().primaryKey(),
    firstJoinAt: t.timestamp(),
    lastSeenAt: t.timestamp(),
    sessionStartedAt: t.option(t.timestamp()),
    sessions: t.u32(),
    /** Sum of finished session lengths, microseconds. */
    totalPlayMicros: t.u64(),
    firstBerryAt: t.option(t.timestamp()),
    firstStickAt: t.option(t.timestamp()),
    reachedHedgeAt: t.option(t.timestamp()),
    reachedCoastAt: t.option(t.timestamp()),
    firstCraftAt: t.option(t.timestamp()),
    deaths: t.u32(),
    /** Furthest funnel step reached: join, berry, stick, hedge, coast, craft. */
    lastStep: t.string(),
  }
);

// ---- Social: invite links, friends, trades --------------------------------

/**
 * "Join me" links: one short-lived code per inviter (shared/sim friends.ts).
 * A visibility filter shows each client only its own code, so codes cannot be
 * listed; the link carries the code, never an identity or token.
 */
export const inviteCode = table(
  { name: 'invite_code', public: true },
  {
    code: t.string().primaryKey(),
    inviter: t.identity().unique(),
    expiresAtMicros: t.u64(),
  }
);

/** One row per (owner -> friend). Filtered to the owner; online status and area come from the player table. */
export const friend = table(
  { name: 'friend', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    owner: t.identity().index('btree'),
    friend: t.identity(),
    since: t.timestamp(),
  }
);

/**
 * A two-player trade (shared/sim trade.ts). `a` asked `b`; `accepted` once b
 * agreed. Offers are "itemId:qty,..." strings; items stay in the bags until
 * both confirm and the swap runs. Filtered to its two players.
 */
export const trade = table(
  { name: 'trade', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    a: t.identity().index('btree'),
    b: t.identity().index('btree'),
    accepted: t.bool(),
    aOffer: t.string(),
    bOffer: t.string(),
    aConfirmed: t.bool(),
    bConfirmed: t.bool(),
    createdTick: t.u32(),
  }
);

/** Event table: a short notice for one player (`to`), e.g. a trade request or an invite result. Clients show only their own. */
export const socialEvent = table(
  { name: 'social_event', public: true, event: true },
  {
    tick: t.u32(),
    /** shared/sim SocialNotice */
    kind: t.u8(),
    from: t.identity(),
    to: t.identity(),
    text: t.string(),
  }
);

/**
 * F3: the Boulders' world boss (one row, shared/sim GIANT_ID). Written only on
 * AI transitions and landed swings; idle regeneration is computed lazily from
 * `lastHitTick` (shared/sim giantHpAt).
 */
export const giant = table(
  { name: 'giant', public: true },
  {
    id: t.u32().primaryKey(),
    x: t.i32(),
    z: t.i32(),
    hp: t.u32(),
    maxHp: t.u32(),
    /** shared/sim GiantState */
    state: t.u8(),
    /** shared/sim GiantAttack of the current (or last) attack */
    attack: t.u8(),
    /** Windup: the tick the blow lands. Recover: the tick it may act again. */
    stateUntilTick: t.u32(),
    /** Centre of the telegraphed area (radius from shared/sim attackRadius). */
    slamX: t.i32(),
    slamZ: t.i32(),
    attackCount: t.u32(),
    /** Defeated: the tick it rises again. */
    respawnTick: t.u32(),
    lastHitTick: t.u32(),
  }
);

/** Private: damage each player dealt to the Giant this life, for the reward. Cleared on defeat and regeneration. */
export const giantContribution = table(
  { name: 'giant_contribution' },
  {
    identity: t.identity().primaryKey(),
    giantId: t.u32(),
    damage: t.u32(),
    lastHitTick: t.u32(),
  }
);

/** Event table: Giant hits, telegraphs, blows, defeats, rewards and respawns (shared/sim GiantEventKind). */
export const giantEvent = table(
  { name: 'giant_event', public: true, event: true },
  {
    tick: t.u32(),
    giantId: t.u32(),
    kind: t.u8(),
    /** Hit: the attacker. PlayerHit / Reward: the player. Otherwise the module identity. */
    player: t.identity(),
    damage: t.u8(),
    /** Hit: the attacker's weapon. Reward: the item given. */
    itemId: t.string(),
    quantity: t.u8(),
    /** Hit: the Giant's HP after it. PlayerHit: the player's HP after it. */
    hp: t.u32(),
    x: t.i32(),
    z: t.i32(),
  }
);
