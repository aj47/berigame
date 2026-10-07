/**
 * Banking and carried-value rules (docs/design/ECONOMY.md). They apply to every
 * character the same way; none of them needs to know who is a bot.
 *
 * - The personal vault (the frontier's `vault-<id>` container) opens in the
 *   Grove's safe ring as well as in Meadows town. Items in it are safe.
 * - Drop boxes on the Coast take deposits into that vault, but a deposit there
 *   takes DROP_BOX_DEPOSIT_TICKS and damage stops it.
 * - Items in the bag are at risk. A large unbanked load glows (the load level on
 *   the player row) so other players can see who is carrying value.
 * - A confirmed trade swaps after TRADE_SWAP_TICKS where an attack could land,
 *   and damage to either side stops it. Where no attack can land it is instant.
 * - Stepping out of the safe ring gives EXIT_PROTECT_TICKS of protection, which
 *   ends at once if you attack.
 */
import { SPAWN_TILE } from './constants';
import { chebyshev } from './grid';
import { getItemDef } from './items';
import { bossNoPvpZone, inSafeRing } from './areas';
import { FRONTIER, REGIONS } from './frontier/catalog';
import { addItem, countItem } from './inventory';
import { removeItemCount } from './trade';
import type { Slot, Tile } from './types';

/** The personal vault's container id. */
export function vaultId(identityHex: string): string {
  return `vault-${identityHex}`;
}

export interface DropBox extends Tile {
  id: number;
  name: string;
}

/**
 * Coast drop boxes, one per quadrant, each on an open tile at least four tiles
 * from any node so a box never blocks a harvest spot. They do not block their tile.
 */
export const DROP_BOXES: readonly DropBox[] = [
  { id: 1, name: 'North-west drop box', x: 9, z: 16 },
  { id: 2, name: 'North-east drop box', x: 40, z: 13 },
  { id: 3, name: 'South-west drop box', x: 8, z: 36 },
  { id: 4, name: 'South-east drop box', x: 41, z: 39 },
];
/** Chebyshev distance from a box at which a deposit can start and continue. */
export const DROP_BOX_REACH = 1;
/** Ticks a drop-box deposit takes (2.4 s). Damage, moving or another action stops it. */
export const DROP_BOX_DEPOSIT_TICKS = 4;

export function dropBox(id: number): DropBox | undefined {
  return DROP_BOXES.find((b) => b.id === id);
}

export function dropBoxInReach(t: Tile): DropBox | undefined {
  return DROP_BOXES.find((b) => chebyshev(t, b) <= DROP_BOX_REACH);
}

/** Where Bramblewild players can open their vault fully: the Grove's safe ring. */
export function atGroveVault(p: Tile & { region?: string }): boolean {
  return (p.region || 'bramblewild') === 'bramblewild' && inSafeRing(p);
}

/** The vault spot shown on maps and given to agents: the spawn tile. */
export const GROVE_VAULT_TILE: Tile = { ...SPAWN_TILE };

/** An empty personal vault, the same size as the town bank. */
export function emptyVaultSlots(): Slot[] {
  return Array(FRONTIER.bankSlots).fill(null);
}

export type VaultTransfer = { ok: true; bag: Slot[]; vault: Slot[] } | { ok: false; reason: string };

/**
 * Move `quantity` of `itemId` between the bag and the vault, all or nothing.
 * The bag gives from its back first so the quick bar is kept; weapons may sit
 * anywhere in the vault, as in the town bank.
 */
export function vaultTransfer(bag: readonly Slot[], vault: readonly Slot[], itemId: string, quantity: number, direction: 'deposit' | 'withdraw'): VaultTransfer {
  const def = getItemDef(itemId);
  if (!def) return { ok: false, reason: 'Unknown item' };
  if (!Number.isInteger(quantity) || quantity < 1) return { ok: false, reason: 'Choose how many to move' };
  const name = def.name;
  const from = direction === 'deposit' ? bag : vault;
  if (countItem(from, itemId) < quantity) return { ok: false, reason: direction === 'deposit' ? `You do not have ${quantity} ${name}` : `Your vault does not hold ${quantity} ${name}` };
  if (direction === 'deposit') {
    const added = addItem(vault, itemId, quantity, { allowWeaponQuickSlots: true });
    if (added.remaining > 0) return { ok: false, reason: 'Your vault is full' };
    return { ok: true, bag: removeItemCount(bag, itemId, quantity), vault: added.slots };
  }
  const added = addItem(bag, itemId, quantity);
  if (added.remaining > 0) return { ok: false, reason: 'Make room in your bag first' };
  return { ok: true, bag: added.slots, vault: removeItemCount(vault, itemId, quantity) };
}

// ---- Carried value ----------------------------------------------------------

/** Values that differ from the default rule below. */
const ITEM_VALUE_OVERRIDES: Record<string, number> = {
  berry_goldberry: 5,
  obsidian: 6,
  gleamshell: 6,
  prism_shard: 10,
  spire_key: 12,
};

/**
 * A rough value per item, for the load glow only (nothing is bought or sold at
 * these numbers): a weapon is worth its damage, food half its healing, rounded
 * up, and anything else 1.
 */
export function itemValue(itemId: string): number {
  const override = ITEM_VALUE_OVERRIDES[itemId];
  if (override !== undefined) return override;
  const def = getItemDef(itemId);
  if (!def) return 0;
  if (def.weaponDamage > 0) return def.weaponDamage;
  if (def.healthRestore > 0) return Math.ceil(def.healthRestore / 2);
  return 1;
}

/**
 * The unbanked value in a bag. The first copy of each weapon is your kit (a
 * stick or club is also the key to the brambles or the boulders), so only
 * spare weapons count.
 */
export function carriedValue(slots: readonly Slot[]): number {
  const seenWeapons = new Set<string>();
  let total = 0;
  for (const s of slots) {
    if (!s) continue;
    let quantity = s.quantity;
    if ((getItemDef(s.itemId)?.weaponDamage ?? 0) > 0 && !seenWeapons.has(s.itemId)) {
      seenWeapons.add(s.itemId);
      quantity -= 1;
    }
    total += Math.max(0, quantity) * itemValue(s.itemId);
  }
  return total;
}

/** A carried value at or above this glows faintly (load level 1). */
export const LOAD_GLOW_VALUE = 30;
/** At or above this the glow is bright (load level 2). */
export const LOAD_BRIGHT_VALUE = 90;
/** The server refreshes load levels on ticks divisible by this. */
export const LOAD_REFRESH_TICKS = 5;

export function loadLevel(value: number): 0 | 1 | 2 {
  return value >= LOAD_BRIGHT_VALUE ? 2 : value >= LOAD_GLOW_VALUE ? 1 : 0;
}

// ---- Trades and the safe ring -------------------------------------------------

/** Ticks between both confirmations and the swap, where an attack could land (1.8 s). */
export const TRADE_SWAP_TICKS = 3;

/**
 * Whether no player attack can land on someone standing here: the Grove's safe
 * ring, the boss zones and Meadows town. Paid plots depend on claim state, so
 * they answer false and the swap simply waits its few ticks there.
 */
export function attackProofSpot(p: Tile & { region?: string }): boolean {
  const region = p.region || 'bramblewild';
  if (region === 'settlement') return chebyshev(p, REGIONS.settlement.spawn) <= 4;
  if (region !== 'bramblewild') return false;
  return inSafeRing(p) || bossNoPvpZone(p) !== null;
}

/** Ticks of protection after stepping out of the safe ring. Attacking ends it. */
export const EXIT_PROTECT_TICKS = 3;
