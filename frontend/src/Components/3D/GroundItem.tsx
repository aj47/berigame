import React, { useEffect } from 'react';
import { sRGBEncoding } from 'three';
import { Html, useTexture } from '@react-three/drei';
import { ITEM_DEFS, getItemDef, tileToWorld } from '@sim';
import type { GroundItem as GroundItemRow } from '../../module_bindings/types';
import { useUserInputStore } from '../../store';
import { holdState } from './tapAssist';

// Fetch every item icon up front: the first stick anyone drops must not
// suspend the world's shared Suspense boundary while its sprite loads.
for (const def of Object.values(ITEM_DEFS)) useTexture.preload(def.icon);

const GroundItem = ({ groundItem }: { groundItem: GroundItemRow }) => {
  const setClickedOtherObject = useUserInputStore((s: any) => s.setClickedOtherObject);
  const def = getItemDef(groundItem.itemId);
  const texture = useTexture(def?.icon ?? '/items/blueberry.png');
  useEffect(() => { texture.encoding = sRGBEncoding; texture.needsUpdate = true; }, [texture]);
  const [x,y,z] = tileToWorld(groundItem);
  const onClick = (e: any) => {
    if (e.delta > 5) return;
    e.stopPropagation();
    if (holdState.active || performance.now() < holdState.suppressClickUntil) return;
    // Choose first; Pick up walks over.
    setClickedOtherObject({ connectionId: def?.name ?? groundItem.itemId, e: { clientX: e.clientX, clientY: e.clientY, ray: e.ray?.clone() },
      groundItemId: groundItem.id, groundTiles: [{ x: groundItem.x, z: groundItem.z }],
    });
  };
  return <group position={[x,y,z]} onClick={onClick} userData={{ hoverTarget: {
    title: `${groundItem.quantity}× ${def?.name ?? groundItem.itemId}`, action: 'Click for pickup options', click: 'panel', detail: groundItem.droppedOnDeath ? 'Dropped on defeat' : 'On the ground', radius: .48,
  } }}>
    <sprite position={[0,.42,0]} scale={[.7,.7,1]}><spriteMaterial map={texture} transparent alphaTest={.1} depthWrite={false} /></sprite>
    <mesh position={[0,.025,0]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.28,.32,16]} /><meshBasicMaterial color={def?.color} transparent opacity={.65} depthWrite={false} /></mesh>
    {groundItem.quantity > 1 && <Html zIndexRange={[3,0]} position={[0,.95,0]} center style={{ pointerEvents:'none' }}>
      <div className="ground-item-label" style={{ borderColor:def?.color }}>{groundItem.quantity}× {def?.name}{groundItem.droppedOnDeath && <div className="dim">Dropped on defeat</div>}</div>
    </Html>}
  </group>;
};
export default React.memo(GroundItem);
