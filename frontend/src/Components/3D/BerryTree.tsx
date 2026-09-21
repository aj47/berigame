import React from 'react';
import { Html } from '@react-three/drei';
import { HARVEST_TICKS, TICK_MS, getItemDef, tileToWorld } from '@sim';
import type { Player, Tree } from '../../module_bindings/types';
import { useGameActions } from '../../spacetime/actions';
import { useMyPlayer, usePlayersByHex } from '../../spacetime/hooks';
import { useUserInputStore } from '../../store';

interface Props { tree: Tree; tick: number; harvester: Player | null; }
const fruitPositions = [[-.55,1.65,.55],[.5,1.82,.47],[0,2.23,.45],[.66,1.95,-.16],[-.49,2.15,-.3],[.05,1.68,-.62]];
const BerryTree = ({ tree, tick, harvester }: Props) => {
  const setClickedOtherObject = useUserInputStore((s: any) => s.setClickedOtherObject);
  const { startHarvest } = useGameActions();
  const me = useMyPlayer();
  const players = usePlayersByHex();
  const target = me?.combatTarget ? players.get(me.combatTarget.toHexString()) : undefined;
  const faded = [me, target].some((p) => p && Math.hypot(p.x-tree.x, p.z-tree.z) < 2.3);
  const def = getItemDef(tree.itemId);
  const [wx, wy, wz] = tileToWorld(tree);
  const regrowTicks = Math.max(0, tree.cooldownUntilTick - tick);
  const busy = tree.harvester !== undefined;
  const progress = harvester && harvester.harvestEndTick > 0 ? Math.min(1, Math.max(0, 1 - (harvester.harvestEndTick - tick) / HARVEST_TICKS)) : 0;
  const label = busy ? `${harvester?.name ?? 'Someone'} is harvesting` : regrowTicks > 0 ? `Regrowing (${Math.ceil(regrowTicks * TICK_MS / 1000)}s)` : `Harvest ${def?.name ?? 'berries'}`;
  const disabled = busy || regrowTicks > 0;
  const onClick = (e: any) => {
    if (e.delta > 5) return;
    e.stopPropagation();
    setClickedOtherObject({ connectionId: def?.name ?? 'Berry tree', e, dropdownOptions: [{ label, disabled, onClick: () => { if (!disabled) startHarvest(tree.id); setClickedOtherObject(null); } }] });
  };
  const leaf = tree.itemId === 'berry_goldberry' ? '#839657' : tree.itemId === 'berry_blueberry' ? '#56856b' : '#6d925d';
  return <group position={[wx, wy, wz]} onClick={onClick}>
    <mesh position={[0,.68,0]}><cylinderGeometry args={[.11,.19,1.36,6]} /><meshStandardMaterial color="#795238" flatShading /></mesh>
    <mesh position={[0,1.76,0]} scale={[1,.84,1]}><icosahedronGeometry args={[.92,0]} /><meshStandardMaterial color={leaf} flatShading transparent={faded} opacity={faded ? .38 : 1} depthWrite={!faded} /></mesh>
    <mesh position={[-.18,2.23,-.07]} scale={[.78,.73,.77]}><icosahedronGeometry args={[.8,0]} /><meshStandardMaterial color="#85a575" flatShading transparent={faded} opacity={faded ? .38 : 1} depthWrite={!faded} /></mesh>
    <mesh rotation={[-Math.PI / 2,0,0]} position={[0,.015,0]}><circleGeometry args={[.8,10]} /><meshBasicMaterial color="#435c3c" transparent opacity={.18} depthWrite={false} /></mesh>
    {regrowTicks === 0 && fruitPositions.map((p,i) => <mesh key={i} position={p as [number,number,number]} scale={tree.itemId === 'berry_strawberry' ? [.8,1.15,.8] : [1,1,1]}>
      <icosahedronGeometry args={[.18,0]} /><meshStandardMaterial color={def?.color} roughness={.85} flatShading />
    </mesh>)}
    {(busy || regrowTicks > 0) && <Html zIndexRange={[3,0]} position={[0,2.9,0]} center style={{ pointerEvents:'none' }}>
      <div className="harvest-progress"><div>{busy ? `Gathering ${def?.name}` : label}</div>{busy && <div className="harvest-bar"><div className="harvest-fill" style={{ width:`${progress*100}%`,background:def?.color }} /></div>}</div>
    </Html>}
  </group>;
};
export default BerryTree;
