import { NodeKind, TICK_MS, getItemDef, isBerryNode } from '@sim';
import type { Player, Tree } from '../module_bindings/types';
import { identityHex } from '../spacetime/identity';

/** Shared by world labels and the live action dropdown. */
export function harvestStatus(node: Tree, tick: number, harvester: Player | null, myHex: string | null) {
  const berry = isBerryNode(node);
  const busy = node.harvester !== undefined;
  const regrowTicks = Math.max(0, node.cooldownUntilTick - tick);
  const item = getItemDef(node.itemId);
  const verb = berry ? 'Harvest' : node.kind === NodeKind.TideRock ? 'Knap' : node.kind === NodeKind.Obsidian ? 'Chip' : 'Gather';
  let label = `${verb} ${item?.name ?? (berry ? 'berries' : 'it')}`;
  if (busy) {
    const activity = berry ? 'harvesting' : 'gathering';
    label = harvester && myHex && identityHex(harvester.identity) === myHex
      ? `You are ${activity}`
      : `${harvester?.name ?? 'Someone'} is ${activity}`;
  } else if (regrowTicks > 0) {
    const seconds = Math.ceil(regrowTicks * TICK_MS / 1000);
    label = berry ? `Regrowing (${seconds}s)`
      : `${node.kind === NodeKind.TideRock ? 'More flint in' : node.kind === NodeKind.Obsidian ? 'Reforming in' : 'Washing up in'} ${seconds}s`;
  }
  return { label, berry, busy, regrowTicks, unavailable: busy || regrowTicks > 0 };
}
