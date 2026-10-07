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
    /** true = attacking combatTarget, false = following or approaching to trade */
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
    region: t.string().default('bramblewild'),
    /** Unbanked carried value, 0 none / 1 glowing / 2 bright (shared/sim/banking.ts loadLevel). Public so everyone sees the glow. */
    load: t.u8().default(0),
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
    bodyType: t.u8().default(0),
    faceShape: t.u8().default(0),
    eyeColor: t.u8().default(0),
    facialHair: t.u8().default(0),
    outfitStyle: t.u8().default(0),
    trouserColor: t.u8().default(0),
    bootColor: t.u8().default(0),
    accessory: t.u8().default(0),
    accessoryColor: t.u8().default(0),
    setupComplete: t.bool().default(false),
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
    aCoins: t.u32().default(0), bCoins: t.u32().default(0),
    /**
     * Appended: 0 while not both confirmed. Otherwise the tick the swap runs on
     * (shared/sim/banking.ts TRADE_SWAP_TICKS) and each side's HP when it was
     * set: any damage to either side before then stops the swap.
     */
    swapTick: t.u32().default(0),
    aHp: t.u8().default(0),
    bHp: t.u8().default(0),
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
/**
 * F2 skills: total XP per skill (shared/sim/skills.ts). Written only when XP is
 * earned (a finished harvest or a craft), never per tick. Public: levels are
 * no secret and carry no power.
 */
export const playerSkill = table(
  { name: 'player_skill', public: true },
  {
    identity: t.identity().primaryKey(),
    foragingXp: t.u32(),
    beachcombingXp: t.u32(),
    craftingXp: t.u32(),
  }
);

/**
 * Milestone cosmetics (shared/sim/skills.ts COSMETICS): `unlocked` is a bit
 * mask of earned cosmetic ids; `head` / `neck` are the worn ones (id + 1,
 * 0 = none). Purely visual; public so everyone sees what you wear.
 */
export const playerCosmetic = table(
  { name: 'player_cosmetic', public: true },
  {
    identity: t.identity().primaryKey(),
    unlocked: t.u32(),
    head: t.u8(),
    neck: t.u8(),
  }
);

/**
 * Private per-(from -> to) social bookkeeping, keyed "fromHex>toHex": when
 * `from` last sent `to` a player-triggered notice (friend adds, trade
 * requests; a cooldown so nobody can flood someone with toasts), whether the
 * "added you as a friend" notice was already sent once (never re-sent on a
 * re-add), and the invite code `from` last redeemed from inviter `to` (codes
 * are single-use per joiner).
 */
export const socialPair = table(
  { name: 'social_pair' },
  {
    pair: t.string().primaryKey(),
    lastNoticeMicros: t.u64(),
    friendNoticed: t.bool(),
    redeemedCode: t.string(),
  }
);

/**
 * Scheduled Giant raids (shared/sim/raid.ts), one row (id = GIANT_ID). Asleep:
 * `nextWakeAtMicros` is the next wake (UTC grid) and `announced` the warnings
 * already sent for it. Awake: `raidEndsAtMicros` is when it goes back to sleep
 * undefeated. Written only on an announcement, a wake or a sleep.
 */
export const giantRaid = table(
  { name: 'giant_raid', public: true },
  {
    id: t.u32().primaryKey(),
    awake: t.bool(),
    nextWakeAtMicros: t.u64(),
    raidEndsAtMicros: t.u64(),
    announced: t.u8(),
    /** Players in the Boulders when it woke (raid HP scaling). */
    raidPlayers: t.u32(),
    /** shared/sim RaidOutcome of the last raid. */
    lastOutcome: t.u8(),
    raidCount: t.u32(),
  }
);

/**
 * Private: one row per newcomer who could be mentored (shared/sim/mentor.ts).
 * `inviter` is set by their first redeemed invite link; `mentor` once credited
 * (one credit per newcomer, ever); `milestones` the MentorMilestone bits seen.
 */
export const mentee = table(
  { name: 'mentee' },
  {
    identity: t.identity().primaryKey(),
    inviter: t.option(t.identity()),
    mentor: t.option(t.identity()),
    creditedAt: t.option(t.timestamp()),
    milestones: t.u8(),
  }
);

/** Public mentee counts (the Friends panel and the pin tiers). Cosmetic only. */
export const mentorStat = table(
  { name: 'mentor_stat', public: true },
  {
    identity: t.identity().primaryKey(),
    mentees: t.u32(),
  }
);

/**
 * The personal garden (shared/sim/garden.ts): one row per planted plot, deleted
 * on harvest (an empty plot has no row). Growth is computed from
 * `plantedAtMicros` against the clock, so nothing is written while it grows.
 * Private to its owner (views.ts): others see bare soil on the terrace.
 */
export const gardenPlot = table(
  { name: 'garden_plot', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    owner: t.identity().index('btree'),
    plot: t.u8(),
    itemId: t.string(),
    plantedAtMicros: t.u64(),
  }
);

/** Adventure progression is permanent; cargo and equipment are separate. */
export const adventureProfile = table({ name: 'adventure_profile', public: true }, {
  identity: t.identity().primaryKey(), growingXp: t.u32(), buildingXp: t.u32(), exploringXp: t.u32(), fightingXp: t.u32(), befriendingXp: t.u32(),
  feats: t.u32(), loadout: t.u32(), completions: t.u32(), giantTrust: t.u32(), stickClaimed: t.bool(),
});
export const expedition = table({ name: 'expedition', public: true }, {
  id: t.u64().primaryKey().autoInc(), leader: t.identity(), stage: t.string(), startedTick: t.u32(), untilTick: t.u32(), ripeTick: t.u32(),
  x: t.i32(), z: t.i32(), carrier: t.option(t.identity()), mossCarrying: t.bool(), mossPaid: t.bool(), porter: t.option(t.identity()), lastActiveTick: t.u32(), value: t.u8(), split: t.bool(),
  mossX: t.i32(), mossZ: t.i32(), pipX: t.i32(), pipZ: t.i32(), giantX: t.i32(), giantZ: t.i32(),
  hiddenUntil: t.u32(), pipUntil: t.u32(), giantUntil: t.u32(), baitX: t.i32(), baitZ: t.i32(), baitUntil: t.u32(), guardUntil: t.u32(),
  message: t.string(), destination: t.string(),
});
export const expeditionMember = table({ name: 'expedition_member', public: true }, {
  identity: t.identity().primaryKey(), expeditionId: t.u64().index('btree'), contributions: t.u32(), cooldown: t.u32(), tracked: t.bool(),
});
export const islandProject = table({ name: 'island_project', public: true }, {
  id: t.u8().primaryKey(), wood: t.u32(), obsidian: t.u32(), meals: t.u32(),
});
/** Per-owner published snapshots; sharing is explicit and reversible. */
export const gardenShowcase = table({ name: 'garden_showcase', public: true }, {
  identity: t.identity().primaryKey(), plants: t.string(),
});
/** A duel has separate practice health: ordinary HP and bags never change. */
export const friendlyDuel = table({ name: 'friendly_duel', public: true }, {
  id: t.u64().primaryKey().autoInc(), a: t.identity(), b: t.identity(), stage: t.string(), startsTick: t.u32(), expiresTick: t.u32(),
  aHp: t.u8(), bHp: t.u8(), nextSwingTick: t.u32(), turnA: t.bool(), result: t.string(),
});
/** Keeps contribution credit across leave/rejoin; retired with the expedition. */
export const expeditionCredit = table({ name: 'expedition_credit' }, {
  key: t.string().primaryKey(), expeditionId: t.u64().index('btree'), identity: t.identity(), contributions: t.u32(), rewarded: t.bool(), tracked: t.bool(),
});

/** Public region objects never contain wallets, inventory or credentials. */
export const frontierObject = table({ name: 'frontier_object', public: true }, {
  key: t.string().primaryKey(), kind: t.string().index('btree'), region: t.string().index('btree'), data: t.string(),
});
export const frontierPrivate = table({ name: 'frontier_private' }, {
  key: t.string().primaryKey(), kind: t.string().index('btree'), data: t.string(),
});
/** Authorized read projections; revoked permissions delete projections transactionally. */
export const frontierView = table({ name: 'frontier_view', public: true }, {
  key: t.string().primaryKey(), owner: t.identity().index('btree'), kind: t.string(), data: t.string(), source: t.string().index('btree').default(''),
});

// ---- Bosses: Clatterhorn and the Sunken Spire (FINAL_SPEC section 4.1) ------------------
// Flat primitive columns only (no u16, arrays, objects or enums): the publish is a pure
// "Creating table" migration. Columns of features not in this release keep their zero values.

/** Owner switches and live HP knobs for both bosses (one row, id 0). An absent row means the defaults: both closed. */
export const bossConfig = table({ name: 'boss_config', public: true }, {
  id: t.u8().primaryKey(),
  clatterhornOpen: t.bool(),
  spireOpen: t.bool(),
  spirePracticeOpen: t.bool(),
  spireMaxRuns: t.u8(),                 // 1..32 concurrent Active runs (default 12)
  spireHpBase: t.u32(),                 // default 1000
  spireHpPerMember: t.u32(),            // default 700
  clatterHpBase: t.u32(),               // default 200
  clatterHpPerChallenger: t.u32(),      // default 150
});

/** Clatterhorn (shared/sim/clatterhorn.ts), one row (id = CLATTERHORN_ID = 1). At most one write per tick. */
export const clatterhorn = table({ name: 'clatterhorn', public: true }, {
  id: t.u32().primaryKey(),
  x: t.i32(), z: t.i32(),               // body centre (moves on a charge)
  hp: t.u32(), maxHp: t.u32(),
  state: t.u8(),                        // ClatterState
  phase: t.u8(),                        // 1..3 (stored at decisions; never decreases within a fight)
  stateUntilTick: t.u32(),              // windup: landing tick; Recover/Flipped/Drumming: end; lonely Idle: reset; Burrowed: return
  attack: t.u8(),                       // ClatterAttack of the current or last action
  dir: t.u8(),                          // charge direction 0..7 (Facing order)
  endX: t.i32(), endZ: t.i32(),         // charge end centre
  endKind: t.u8(),                      // ClatterEndKind, fixed at telegraph time
  chain: t.u8(),                        // chained charges left
  attackCount: t.u32(),
  bait: t.u32(),                        // identityKey32 of the current/last charge target (0 = none)
  swarmTick: t.u32(),                   // wave-A fire tick of the current/last swarm (0 = none)
  swarmSide: t.u8(),                    // 0 N, 1 E, 2 S, 3 W
  swarmFree: t.u8(),                    // 0..2: column class never used
  engagedTick: t.u32(),
  lastHitTick: t.u32(),
  challengers: t.u32(),
  fightCount: t.u32(),
  defeats: t.u32(),
  owedLeft: t.u32(),                    // defeat rewards still to pay (batches of 25 per tick)
});

/** Private: damage per player in the current fight; owed = 1 while a defeat reward waits to be paid. */
export const clatterhornCredit = table({ name: 'clatterhorn_credit' }, {
  identity: t.identity().primaryKey(),
  fight: t.u32(), damage: t.u32(), lastHitTick: t.u32(), owed: t.u8(),
});

/** One row per Sunken Spire party: lobby, run, result. Transition-only writes. Whole-table subscription. */
export const spireRun = table({ name: 'spire_run', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  leader: t.identity(),
  stage: t.u8(),                        // SpireStage
  outcome: t.u8(),                      // SpireOutcome
  mode: t.u8(),                         // SpireMode: Normal 0 (Practice 1 reserved)
  isPublic: t.bool(),                   // listed for quick join (always true in this release)
  rules: t.u32(),                       // SPIRE_RULES_VERSION at open
  partySize: t.u8(),
  createdTick: t.u32(), queuedTick: t.u32(),
  startTick: t.u32(),                   // first fight tick (start + 5); 0 before the start
  endTick: t.u32(),                     // Lobby: expiry; Active: time limit; Cleared/Failed: cleanup tick
  phase: t.u8(),                        // mirror of spire_fight.phase for onlookers (written on a phase change)
  clearTicks: t.u32(),
});

/** One row per party member (one party at a time). Transition-only writes. Whole-table subscription. */
export const spireMember = table({ name: 'spire_member', public: true }, {
  identity: t.identity().primaryKey(),
  runId: t.u64().index('btree'),
  slot: t.u8(),                         // 0..3: spawn tile, swing cadence, fan rotation, per-slot columns of spire_fight
  state: t.u8(),                        // SpireMemberState
  joinedTick: t.u32(),
  awaySinceTick: t.u32(),               // 0 = present
  awayCount: t.u8(),
  downUntilTick: t.u32(),
  reviveSinceTick: t.u32(),             // 0 = no revive in progress
  meals: t.u8(),
});

/** Fight state of one Active run (PK = run id). High churn: clients and the gateway subscribe per run. */
export const spireFight = table({ name: 'spire_fight', public: true }, {
  runId: t.u64().primaryKey(),
  hp: t.u32(), maxHp: t.u32(), phase: t.u8(), seed: t.u32(),
  patternCount: t.u32(),
  curKind: t.u8(), curStart: t.u32(), curSeed: t.u8(), curAimX: t.i32(), curAimZ: t.i32(),
  prevKind: t.u8(), prevStart: t.u32(), prevSeed: t.u8(), prevAimX: t.i32(), prevAimZ: t.i32(),   // prevKind 255 = none
  starWave: t.u32(), starMask: t.u8(),
  hitTick0: t.u32(), hitTick1: t.u32(), hitTick2: t.u32(), hitTick3: t.u32(),   // last bullet hit per slot (i-frames)
  hits0: t.u8(), hits1: t.u8(), hits2: t.u8(), hits3: t.u8(),                   // saturating at 255
  stars0: t.u8(), stars1: t.u8(), stars2: t.u8(), stars3: t.u8(),
  dmg0: t.u32(), dmg1: t.u32(), dmg2: t.u32(), dmg3: t.u32(),                   // stars + swings dealt
  downs0: t.u8(), downs1: t.u8(), downs2: t.u8(), downs3: t.u8(),
});

/** Event table: world-visible boss moments (a few per minute at most). */
export const bossEvent = table({ name: 'boss_event', public: true, event: true }, {
  tick: t.u32(), boss: t.u8(), kind: t.u8(), runId: t.u64(),
  player: t.identity(),                 // the module identity when not about one player
  x: t.i32(), z: t.i32(), quantity: t.u32(), value: t.u32(), text: t.string(),
});

/** Event table with RLS (player = :sender): personal combat feedback, one row per recipient. */
export const bossNotice = table({ name: 'boss_notice', public: true, event: true }, {
  tick: t.u32(), boss: t.u8(), kind: t.u8(), player: t.identity(), runId: t.u64(),
  amount: t.u32(), total: t.u32(), hp: t.u8(), half: t.u8(), quantity: t.u8(),
  itemId: t.string(), x: t.i32(), z: t.i32(),
});

/**
 * Private: a drop-box deposit in progress (shared/sim/banking.ts). The player
 * row carries Pending.Deposit while it runs; the tick completes it at
 * `doneTick` or deletes it once the player stops, moves away or is hit.
 */
export const pendingDeposit = table({ name: 'pending_deposit' }, {
  identity: t.identity().primaryKey(),
  boxId: t.u32(),
  itemId: t.string(),
  quantity: t.u8(),
  doneTick: t.u32(),
});
