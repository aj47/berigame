import React, { useState } from 'react';
import { Html } from '@react-three/drei';
import { getItemDef, tileToWorld } from '@sim';
import type { GroundItem as GroundItemRow } from '../../module_bindings/types';
import { useGameActions } from '../../spacetime/actions';
import { useUserInputStore } from '../../store';

const GroundItem = ({ groundItem }: { groundItem: GroundItemRow }) => {
  const [isHovered, setIsHovered] = useState(false);
  const setClickedOtherObject = useUserInputStore((s: any) => s.setClickedOtherObject);
  const { pickupItem } = useGameActions();
  const def = getItemDef(groundItem.itemId);
  const color = def?.color ?? '#888';
  const [wx, wy, wz] = tileToWorld(groundItem);

  const onClick = (e: any) => {
    e.stopPropagation();
    setClickedOtherObject({
      connectionId: def?.name ?? groundItem.itemId,
      e,
      dropdownOptions: [
        { label: `Pick up ${groundItem.quantity}x ${def?.name ?? groundItem.itemId}`, onClick: () => { pickupItem(groundItem.id); setClickedOtherObject(null); } },
      ],
    });
  };

  return (
    <group position={[wx, wy + 0.15, wz]} onClick={onClick} onPointerEnter={() => setIsHovered(true)} onPointerLeave={() => setIsHovered(false)}>
      <mesh>
        <sphereGeometry args={[0.15, 8, 8]} />
        <meshStandardMaterial color={color} emissive={isHovered ? color : '#000000'} emissiveIntensity={isHovered ? 0.3 : 0} />
      </mesh>
      {(groundItem.quantity > 1 || isHovered) && (
        <Html position={[0, 0.4, 0]} center style={{ pointerEvents: 'none' }}>
          <div className="ground-item-label" style={{ borderColor: color }}>
            {groundItem.quantity}x {def?.name ?? groundItem.itemId}
            {groundItem.droppedOnDeath && <div className="dim">💀 dropped on death</div>}
          </div>
        </Html>
      )}
    </group>
  );
};

export default GroundItem;
