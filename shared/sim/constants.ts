/**
 * Every tunable number of the BeriGame simulation lives here.
 * Both the SpacetimeDB module and the browser client import this file,
 * so changing a value here changes the game everywhere.
 */

// ---- World / grid -----------------------------------------------------------
/** The island is a GRID_SIZE x GRID_SIZE grid of 1-unit tiles. */
export const GRID_SIZE = 50;
/** world = tile - TILE_ORIGIN. Integer world coords are tile centres. */
export const TILE_ORIGIN = 25;
export const SPAWN_TILE = { x: 25, z: 25 } as const;

// ---- Time -------------------------------------------------------------------
/** Authoritative server tick length. RuneScape uses 600ms; so do we. */
export const TICK_MS = 600;
/** Grounded grid steps per tick; combat and harvesting keep the 600ms clock. */
export const MOVEMENT_STEPS_PER_TICK = 2;

// ---- Vitals -----------------------------------------------------------------
export const MAX_HP = 30;

// ---- Combat -----------------------------------------------------------------
/** Chebyshev distance at which a swing can land. */
export const MELEE_RANGE = 1;
/** Ticks between swings of one attacker (2.4s). */
export const SWING_INTERVAL_TICKS = 4;
/** A retaliating player swings this many ticks after their opponent, so a pair alternates. */
export const RETALIATE_OFFSET_TICKS = 2;
/** Damage of a bare-handed swing. Weapons set their own `weaponDamage` in items.ts. */
export const PUNCH_DAMAGE = 3;
/** Ticks spent dead before respawning. */
export const DEATH_TICKS = 5;

// ---- Harvest / eat ----------------------------------------------------------
export const HARVEST_TICKS = 5;
export const TREE_COOLDOWN_TICKS = 50;
export const EAT_COOLDOWN_TICKS = 3;
/** Eating pushes the eater's next swing back by this many ticks. */
export const EAT_SWING_DELAY_TICKS = 3;
/** Chance that a finished harvest also yields a stick, rolled with the server's ctx.random. */
export const STICK_DROP_CHANCE = 0.25;

// ---- Items ------------------------------------------------------------------
export const INVENTORY_SIZE = 28;
/** Inventory slots 0..HOTBAR_SIZE-1 double as the quick-access bar (keys 1-3). Weapons are wielded from here. */
export const HOTBAR_SIZE = 3;
export const MAX_STACK = 99;
export const GROUND_ITEM_TTL_TICKS = 500;

// ---- Chat / names / anti-spam ----------------------------------------------
export const CHAT_KEEP_ROWS = 100;
export const MAX_CHAT_LEN = 200;
export const NAME_MIN_LEN = 2;
export const NAME_MAX_LEN = 16;
/** Ticks a chat bubble stays above a head (8s). */
export const CHAT_BUBBLE_TICKS = 13;
export const MAX_INPUTS_PER_TICK = 5;
