import React from 'react';
import { Html } from '@react-three/drei';
import { NodeKind, TICK_MS, getItemDef, harvestTicksFor, nodeKindDef, tileToWorld } from '@sim';
import type { Player, Tree } from '../../../module_bindings/types';
import { useGameActions } from '../../../spacetime/actions';
import { useUserInputStore } from '../../../store';
import { useMyIdentityHex } from '../../../spacetime/hooks';
import { identityHex } from '../../../spacetime/identity';
import DriftwoodPile from './DriftwoodPile';
import TideRock from './TideRock';
import ObsidianOutcrop from './ObsidianOutcrop';
import HarvestRing from '../../../fx/HarvestRing';

interface Props { node: Tree; tick: number; harvester: Player | null; }

/** A gathering node: a driftwood pile or a tide rock (M2), or an obsidian outcrop (M3), harvested like a berry tree. */
const CoastNode = ({ node, tick, harvester }: Props) => {
  const myHex = useMyIdentityHex();
  const setClickedOtherObject = useUserInputStore((s: any) => s.setClickedOtherObject);
  const { startHarvest } = useGameActions();
  const kind = nodeKindDef(node.kind);
  const item = getItemDef(node.itemId);
  const [wx, wy, wz] = tileToWorld(node);
  const regrowTicks = Math.max(0, node.cooldownUntilTick - tick);
  const ripe = regrowTicks === 0;
  const busy = node.harvester !== undefined;
  const total = harvestTicksFor(node.kind);
  const endTick = harvester?.harvestEndTick ?? 0;
  const verb = node.kind === NodeKind.TideRock ? 'Knap' : node.kind === NodeKind.Obsidian ? 'Chip' : 'Gather';
  const label = busy ? (harvester && myHex && identityHex(harvester.identity) === myHex ? 'You are gathering' : `${harvester?.name ?? 'Someone'} is gathering`) : regrowTicks > 0 ? `${node.kind === NodeKind.TideRock ? 'More flint in' : node.kind === NodeKind.Obsidian ? 'Reforming in' : 'Washing up in'} ${Math.ceil(regrowTicks * TICK_MS / 1000)}s` : `${verb} ${item?.name ?? 'it'}`;
  const disabled = busy || regrowTicks > 0;
  const onClick = (e: any) => {
    if (e.delta > 5) return;
    e.stopPropagation();
    // A busy or regrowing node still queues: you wait beside it (wait-and-claim).
    setClickedOtherObject({ connectionId: kind.name, e, dropdownOptions: [{ label: disabled ? `${label} — wait here` : label, disabled: false, onClick: () => { startHarvest(node.id); setClickedOtherObject(null); } }] });
  };
  // Seeded per id so the four piles and rocks do not look stamped.
  const rotation = ((node.id * 2.399) % (Math.PI * 2));
  const Model = node.kind === NodeKind.TideRock ? TideRock : node.kind === NodeKind.Obsidian ? ObsidianOutcrop : DriftwoodPile;
  return <group position={[wx, wy, wz]}>
    <Model position={[0, 0, 0]} ripe={ripe} rotation={rotation} onClick={onClick} />
    {busy && endTick > 0 && <HarvestRing endTick={endTick} totalTicks={total} color={item?.color} y={1.55} size={0.95} />}
    {(busy || regrowTicks > 0) && <Html zIndexRange={[3, 0]} position={[0, busy ? 2.15 : 1.5, 0]} center style={{ pointerEvents: 'none' }}>
      <div className="harvest-progress"><div>{busy ? `Gathering ${item?.name}` : label}</div></div>
    </Html>}
  </group>;
};
export default React.memo(CoastNode);
