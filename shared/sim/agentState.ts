import type { Goal } from './goals';
import { homeDestination, homeLocation, isHomeRegion, isHomeTarget } from './frontier/homeMap';
import type { FrontierSnapshot } from './frontier/snapshot';
import { Pending, type Tile } from './types';
import { chebyshev } from './grid';

type ActivityPlayer = Tile & {
  pending: number;
  harvestEndTick: number;
  targetX?: number;
  combatTarget?: unknown;
  hostile?: boolean;
};

/** Both agent entry points expose the same activity, including timed frontier work. */
export function describeAction(player: ActivityPlayer, gathering: ReturnType<typeof describeGathering>, harvestTree?: Tile | null) {
  if (gathering) return gathering.itemId === 'timber' ? 'chopping' : 'gathering';
  if (player.pending === Pending.Trade) return 'walking to trade';
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
