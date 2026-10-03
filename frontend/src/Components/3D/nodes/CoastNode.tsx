import React from 'react';
import { Html } from '@react-three/drei';
import { NodeKind, getItemDef, harvestTicksFor, nodeKindDef, tileToWorld } from '@sim';
import type { Player, Tree } from '../../../module_bindings/types';
import { harvestStatus } from '../../harvestUi';
import { useUserInputStore } from '../../../store';
import { useMyIdentityHex } from '../../../spacetime/hooks';
import DriftwoodPile from './DriftwoodPile';
import TideRock from './TideRock';
import ObsidianOutcrop from './ObsidianOutcrop';
import HarvestRing from '../../../fx/HarvestRing';
import { approachWorldInteraction } from '../../../frontier/worldInteraction';
import { holdState } from '../tapAssist';

interface Props { node: Tree; tick: number; harvester: Player | null; }

/** A gathering node: a driftwood pile or a tide rock (M2), or an obsidian outcrop (M3), harvested like a berry tree. */
const CoastNode = ({ node, tick, harvester }: Props) => {
  const myHex = useMyIdentityHex();
  const setClickedOtherObject = useUserInputStore((s: any) => s.setClickedOtherObject);
  const kind = nodeKindDef(node.kind);
  const item = getItemDef(node.itemId);
  const [wx, wy, wz] = tileToWorld(node);
  const { label, busy, regrowTicks, unavailable: disabled } = harvestStatus(node, tick, harvester, myHex);
  const ripe = regrowTicks === 0;
  const total = harvestTicksFor(node.kind);
  const endTick = harvester?.harvestEndTick ?? 0;
  const onClick = (e: any) => {
    if (e.delta > 5) return;
    e.stopPropagation();
    if (holdState.active || performance.now() < holdState.suppressClickUntil) return;
    const event = { clientX: e.clientX, clientY: e.clientY, ray: e.ray?.clone() };
    approachWorldInteraction({ region: 'bramblewild', x: node.x, z: node.z }, () => {
      setClickedOtherObject({ connectionId: kind.name, e: event, harvestNodeId: node.id });
    }, 1);
  };
  // Seeded per id so the four piles and rocks do not look stamped.
  const rotation = ((node.id * 2.399) % (Math.PI * 2));
  const Model = node.kind === NodeKind.TideRock ? TideRock : node.kind === NodeKind.Obsidian ? ObsidianOutcrop : DriftwoodPile;
  return <group position={[wx, wy, wz]} userData={{ hoverTarget: {
    title: kind.name, action: 'Walk over for gathering options', click: 'panel', detail: disabled ? `${label} · you can wait here` : label, tone: disabled ? 'muted' : 'ready', radius: .9,
  } }}>
    <Model position={[0, 0, 0]} ripe={ripe} rotation={rotation} onClick={onClick} />
    {busy && endTick > 0 && <HarvestRing endTick={endTick} totalTicks={total} color={item?.color} y={1.55} size={0.95} />}
    {(busy || regrowTicks > 0) && <Html zIndexRange={[3, 0]} position={[0, busy ? 2.15 : 1.5, 0]} center style={{ pointerEvents: 'none' }}>
      <div className="harvest-progress"><div>{busy ? `Gathering ${item?.name}` : label}</div></div>
    </Html>}
  </group>;
};
export default React.memo(CoastNode);
