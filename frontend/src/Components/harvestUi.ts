import { NodeKind, Skill, TICK_MS, getItemDef, isBerryNode, levelForXp, nodeLevelRejection, skillForNode, tierNode } from '@sim';
import type { Player, PlayerSkill, Tree } from '../module_bindings/types';
import { identityHex } from '../spacetime/identity';

/** Your level in the skill that works `kind` (1 before your first XP). */
export function mySkillLevel(skills: Pick<PlayerSkill, 'foragingXp' | 'beachcombingXp'> | null | undefined, kind: number | undefined): number {
  const skill = skillForNode(kind);
  return levelForXp(skill === Skill.Foraging ? skills?.foragingXp ?? 0 : skills?.beachcombingXp ?? 0);
}

/**
 * Shared by world labels and the live action dropdown. `level` is the viewer's
 * level in the node's skill; when given, `locked` says why it cannot be worked yet.
 */
export function harvestStatus(node: Tree, tick: number, harvester: Player | null, myHex: string | null, level?: number) {
  const berry = isBerryNode(node);
  const tier = tierNode(node.kind);
  const busy = node.harvester !== undefined;
  const regrowTicks = Math.max(0, node.cooldownUntilTick - tick);
  const item = getItemDef(node.itemId);
  const verb = berry ? 'Harvest' : tier ? tier.verb : node.kind === NodeKind.TideRock ? 'Knap' : node.kind === NodeKind.Obsidian ? 'Chip' : 'Gather';
  let label = `${verb} ${item?.name ?? (berry ? 'berries' : 'it')}`;
  if (busy) {
    const activity = berry ? 'harvesting' : 'gathering';
    label = harvester && myHex && identityHex(harvester.identity) === myHex
      ? `You are ${activity}`
      : `${harvester?.name ?? 'Someone'} is ${activity}`;
  } else if (regrowTicks > 0) {
    const seconds = Math.ceil(regrowTicks * TICK_MS / 1000);
    const regrow = tier ? tier.regrowLabel : node.kind === NodeKind.TideRock ? 'More flint in' : node.kind === NodeKind.Obsidian ? 'Reforming in' : 'Washing up in';
    label = berry ? `Regrowing (${seconds}s)` : `${regrow} ${seconds}s`;
  }
  const locked = level === undefined ? null : nodeLevelRejection(node.kind, level);
  return { label, berry, busy, regrowTicks, unavailable: busy || regrowTicks > 0, locked };
}
