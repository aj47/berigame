import React, { useEffect, useState } from 'react';
import { sRGBEncoding } from 'three';
import { Html, useTexture } from '@react-three/drei';
import { getItemDef, tileToWorld } from '@sim';
import type { GroundItem as GroundItemRow } from '../../module_bindings/types';
import { useGameActions } from '../../spacetime/actions';
import { useUserInputStore } from '../../store';

const GroundItem = ({ groundItem }: { groundItem: GroundItemRow }) => {
  const [hovered, setHovered] = useState(false);
  const setClickedOtherObject = useUserInputStore((s: any) => s.setClickedOtherObject);
  const { pickupItem } = useGameActions();
  const def = getItemDef(groundItem.itemId);
  const texture = useTexture(def?.icon ?? '/items/blueberry.png');
  useEffect(() => { texture.encoding = sRGBEncoding; texture.needsUpdate = true; }, [texture]);
  const [x,y,z] = tileToWorld(groundItem);
  const onClick = (e: any) => {
    if (e.delta > 5) return;
    e.stopPropagation();
    setClickedOtherObject({ connectionId:def?.name ?? groundItem.itemId, e, dropdownOptions:[{
      label:`Pick up ${groundItem.quantity}x ${def?.name ?? groundItem.itemId}`,
      onClick:() => { pickupItem(groundItem.id); setClickedOtherObject(null); },
    }] });
  };
  return <group position={[x,y,z]} onClick={onClick} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
    <sprite position={[0,.42,0]} scale={[.7,.7,1]}><spriteMaterial map={texture} transparent alphaTest={.1} depthWrite={false} /></sprite>
    <mesh position={[0,.025,0]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.28,.32,16]} /><meshBasicMaterial color={def?.color} transparent opacity={.65} depthWrite={false} /></mesh>
    {(groundItem.quantity > 1 || hovered) && <Html zIndexRange={[3,0]} position={[0,.95,0]} center style={{ pointerEvents:'none' }}>
      <div className="ground-item-label" style={{ borderColor:def?.color }}>{groundItem.quantity}× {def?.name}{groundItem.droppedOnDeath && <div className="dim">Dropped on defeat</div>}</div>
    </Html>}
  </group>;
};
export default GroundItem;
