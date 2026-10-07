import type { Goal } from './goals';
import {
  DROP_BOXES, DROP_BOX_DEPOSIT_TICKS, DROP_BOX_REACH, GROVE_VAULT_TILE, LOAD_BRIGHT_VALUE, LOAD_GLOW_VALUE, atGroveVault, carriedValue, dropBoxInReach, loadLevel, vaultId,
} from './banking';
import { ENERGY_REGEN_MS, ENERGY_TIRED_EVERY, energyView, type EnergyState } from './energy';
import { SAFE_RADIUS } from './constants';
import { homeDestination, homeLocation, isHomeRegion, isHomeTarget } from './frontier/homeMap';
import type { FrontierSnapshot } from './frontier/snapshot';
import { Pending, type Slot, type Tile } from './types';
import { chebyshev } from './grid';
import { inSpireFloor } from './bossZones';

type ActivityPlayer = Tile & {
  region?: string;
  pending: number;
  harvestEndTick: number;
  targetX?: number;
  combatTarget?: unknown;
  hostile?: boolean;
};

/** Both agent entry points expose the same activity, including timed frontier work. */
export function describeAction(player: ActivityPlayer, gathering: ReturnType<typeof describeGathering>, harvestTree?: Tile | null) {
  if (gathering) return gathering.itemId === 'timber' ? 'chopping' : 'gathering';
  if ((player.region || 'bramblewild') === 'bramblewild' && inSpireFloor(player)) return player.targetX === undefined ? 'holding still in the spire' : 'dodging in the spire';
  if (player.pending === Pending.Clatterhorn) return player.targetX === undefined ? 'fighting clatterhorn' : 'walking to clatterhorn';
  if (player.pending === Pending.Trade) return 'walking to trade';
  if (player.pending === Pending.Deposit) return 'depositing';
  if (player.harvestEndTick) return 'harvesting';
  if (player.pending === Pending.Harvest) return chebyshev(player, harvestTree ?? player) <= 1 ? 'waiting at tree' : 'walking to tree';
  if (player.pending === Pending.Giant) return player.targetX === undefined ? 'fighting the giant' : 'walking to the giant';
  if (player.pending === Pending.Pickup) return 'walking to item';
  if (player.pending === Pending.Dummy) return player.targetX === undefined ? 'training at dummy' : 'walking to dummy';
  if (player.combatTarget) return player.hostile ? 'combat' : 'following';
  return player.targetX === undefined ? 'idle' : 'moving';
}

/** Public destinations always use the destination region's local grid. */
export function describeDestination(player: { region?: string; targetX?: number; targetZ?: number }) {
  if (player.targetX === undefined || player.targetZ === undefined) return null;
  const region = player.region || 'bramblewild';
  const target = { x: player.targetX, z: player.targetZ };
  return isHomeRegion(region) && isHomeTarget(target)
    ? homeLocation(homeDestination(target))
    : { region, ...target };
}

/** Keep the action busy until the server clears its reservation, even after the deadline. */
export function describeGathering(frontier: Pick<FrontierSnapshot, 'enabled' | 'resources'>, identity: string, now: number) {
  const resource = frontier.enabled ? frontier.resources.find(node => node.harvest?.by === identity) : undefined;
  if (!resource?.harvest) return null;
  return {
    resourceId: resource.id,
    itemId: resource.item,
    region: resource.region,
    tile: { x: resource.x, z: resource.z },
    tool: resource.harvest.tool ?? null,
    quantity: resource.harvest.quantity ?? null,
    startedAt: resource.harvest.startedAt,
    completesAt: resource.harvest.completesAt,
    remainingMs: Math.max(0, resource.harvest.completesAt - now),
  };
}

/** Preserve the original goal contract while giving clients one region-aware next step. */
export function describeObjective(region: string, goal: Goal | null, frontier: Pick<FrontierSnapshot, 'enabled' | 'quests'>) {
  if (region === 'bramblewild') return goal ? { source: 'first_day' as const, region, ...goal } : null;
  if (!frontier.enabled) return null;
  const quest = frontier.quests.find(row => row.available && !row.complete);
  if (!quest) return null;
  return {
    source: 'frontier_quest' as const,
    region,
    id: quest.id,
    title: quest.title,
    text: quest.text,
    progress: quest.progress,
    required: quest.amount,
    coins: quest.coins,
    handIn: quest.handIn ?? null,
    hint: 'Complete the task, then claim its reward near the steward or shipwright with frontier quest. See frontier.quests for requirements.',
    action: null,
  };
}

/**
 * The economy block of /state and WebMCP's inspect_game_state: energy, what
 * you carry unbanked, your vault and where it opens (shared/sim/energy.ts and
 * banking.ts). `views` are your own frontier_view rows; `self.load` comes from
 * the public player row.
 */
export function describeEconomy(input: {
  self: Tile & { region?: string; pending?: number; pendingId?: bigint | number };
  slots: readonly Slot[];
  views: Iterable<{ kind: string; source: string; data: string }>;
  identity: string;
  now: number;
}) {
  const { self, slots, identity, now } = input;
  let energyState: EnergyState | undefined, vaultSlots: Slot[] = [];
  for (const row of input.views) {
    if (row.kind === 'energy' && row.source === `energy:${identity}`) energyState = JSON.parse(row.data);
    if (row.kind === 'container' && row.source === `container:${vaultId(identity)}`) vaultSlots = JSON.parse(row.data).slots ?? [];
  }
  const energy = energyView(energyState, now);
  const home = (self.region || 'bramblewild') === 'bramblewild';
  const box = home ? dropBoxInReach(self) : undefined;
  const value = carriedValue(slots);
  const stored = new Map<string, number>();
  for (const s of vaultSlots) if (s) stored.set(s.itemId, (stored.get(s.itemId) ?? 0) + s.quantity);
  return {
    energy: {
      ...energy,
      ...(energyState ? {} : { estimate: true }),
      rule: `Measured in seconds of gathering: each finished harvest or gather spends its own length. Above restedLine you are rested and it pays double; with fewer points left than an action costs, only one in ${ENERGY_TIRED_EVERY} pays. One point returns every ${ENERGY_REGEN_MS / 1000} s: while online only up to restedLine, while logged out up to max, so rested time is earned only by time away. New characters start with a smaller meter that grows over three days. Gardens and planter crops are not affected.`,
    },
    carried: {
      unbankedValue: value, loadLevel: loadLevel(value), glowAt: LOAD_GLOW_VALUE, brightAt: LOAD_BRIGHT_VALUE,
      rule: 'Everything in your bag drops where you are defeated. A load worth glowAt or more glows (player.load), so others can see it. Your first copy of each weapon does not count.',
    },
    vault: {
      items: [...stored.entries()].map(([itemId, quantity]) => ({ itemId, quantity })),
      opensHere: home && atGroveVault(self),
      dropBoxHere: box ? box.id : null,
      depositing: self.pending === Pending.Deposit,
      grove: { center: { ...GROVE_VAULT_TILE }, radius: SAFE_RADIUS },
      dropBoxes: DROP_BOXES.map((b) => ({ id: b.id, name: b.name, tile: { x: b.x, z: b.z } })),
      depositTicks: DROP_BOX_DEPOSIT_TICKS,
      rule: `Your vault is the same store as the Meadows town bank, and items in it never drop. In the Grove safe ring (Chebyshev ${SAFE_RADIUS} of spawn) vault_deposit and vault_withdraw are instant. Beside a Coast drop box (Chebyshev ${DROP_BOX_REACH}) vault_deposit takes ${DROP_BOX_DEPOSIT_TICKS} ticks and a hit, a step or another action stops it; you cannot withdraw there.`,
    },
  };
}