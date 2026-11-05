import React from 'react';
import { Html } from '@react-three/drei';
import { NodeKind, getItemDef, harvestTicksFor, nodeKindDef, tierNode, tileToWorld } from '@sim';
import type { Player, Tree } from '../../../module_bindings/types';
import { harvestStatus, mySkillLevel } from '../../harvestUi';
import { useUserInputStore } from '../../../store';
import { useMyIdentityHex, useMySkills } from '../../../spacetime/hooks';
import DriftwoodPile from './DriftwoodPile';
import TideRock from './TideRock';
import ObsidianOutcrop from './ObsidianOutcrop';
import SeasonNode, { seasonNodeHeight } from './SeasonNodes';
import HarvestRing from '../../../fx/HarvestRing';
import { holdState } from '../tapAssist';

interface Props { node: Tree; tick: number; harvester: Player | null; }

/** Model height for the original kinds' rings and labels. */
const BASE_TOP = 1.3;

/**
 * A gathering node: a driftwood pile or a tide rock (M2), an obsidian outcrop
 * (M3) or a Long Season tier node, harvested like a berry tree.
 */
const CoastNode = ({ node, tick, harvester }: Props) => {
  const myHex = useMyIdentityHex();
  const tier = tierNode(node.kind);
  const skills = useMySkills();
  const setClickedOtherObject = useUserInputStore((s: any) => s.setClickedOtherObject);
  const kind = nodeKindDef(node.kind);
  const item = getItemDef(node.itemId);
  const [wx, wy, wz] = tileToWorld(node);
  const { label, busy, regrowTicks, unavailable: disabled, locked } = harvestStatus(node, tick, harvester, myHex, tier ? mySkillLevel(skills, node.kind) : undefined);
  const ripe = regrowTicks === 0;
  const total = harvestTicksFor(node.kind);
  const endTick = harvester?.harvestEndTick ?? 0;
  const onClick = (e: any) => {
    if (e.delta > 5) return;
    e.stopPropagation();
    if (holdState.active || performance.now() < holdState.suppressClickUntil) return;
    // Choose first; the gather action walks over.
    setClickedOtherObject({ connectionId: kind.name, e: { clientX: e.clientX, clientY: e.clientY, ray: e.ray?.clone() }, harvestNodeId: node.id });
  };
  // Seeded per id so the four piles and rocks do not look stamped.
  const rotation = ((node.id * 2.399) % (Math.PI * 2));
  const top = tier ? Math.max(BASE_TOP, seasonNodeHeight(node.kind) + 0.1) : BASE_TOP;
  const Model = node.kind === NodeKind.TideRock ? TideRock : node.kind === NodeKind.Obsidian ? ObsidianOutcrop : DriftwoodPile;
  const detail = locked ? `${label} · ${locked}` : disabled ? `${label} · you can wait here` : label;
  return <group position={[wx, wy, wz]} userData={{ hoverTarget: {
    title: kind.name, action: 'Click for gathering options', click: 'panel', detail, tone: disabled || locked ? 'muted' : 'ready', radius: tier ? 1 : .9,
  } }}>
    {tier
      ? <SeasonNode kind={node.kind} position={[0, 0, 0]} ripe={ripe} rotation={rotation} onClick={onClick} />
      : <Model position={[0, 0, 0]} ripe={ripe} rotation={rotation} onClick={onClick} />}
    {busy && endTick > 0 && <HarvestRing endTick={endTick} totalTicks={total} color={tier?.color ?? item?.color} y={top + 0.25} size={0.95} />}
    {(busy || regrowTicks > 0) && <Html zIndexRange={[3, 0]} position={[0, busy ? top + 0.85 : top + 0.2, 0]} center style={{ pointerEvents: 'none' }}>
      <div className="harvest-progress"><div>{busy ? `Gathering ${item?.name}` : label}</div></div>
    </Html>}
  </group>;
};
export default React.memo(CoastNode);
