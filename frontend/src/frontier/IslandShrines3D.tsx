import React from 'react';
import { Html } from '@react-three/drei';
import type { Profile } from '../../../shared/sim/frontier/model';
import { ISLAND_SHRINES, shrineRestored } from '../../../shared/sim/frontier/shrines';
import { holdState } from '../Components/3D/tapAssist';
import { openSettlement } from './navigation';

/** Shared landmarks; only the viewing character's earned blessing changes their flame. */
export default function IslandShrines3D({ region, profile, showLabels, disabled }: {
  region: string; profile: Profile; showLabels: boolean; disabled: boolean;
}) {
  return <>{ISLAND_SHRINES.filter(shrine => shrine.region === region).map(shrine => {
    const restored = shrineRestored(profile, shrine.id);
    return <group key={shrine.id} position={[shrine.x - 25, 0, shrine.z - 25]}
      userData={{ hoverTarget: disabled ? null : { title: shrine.name, action: 'View shrine restoration', detail: restored ? 'Restored · permanent +5% discipline XP' : 'Restore for permanent +5% discipline XP', click: 'panel', radius: 1 } }}
      onClick={event => {
        if (disabled || event.delta > 5 || (event.button ?? event.nativeEvent?.button ?? 0) !== 0) return;
        event.stopPropagation();
        if (holdState.active || performance.now() < holdState.suppressClickUntil) return;
        openSettlement('Harbour');
      }}>
      <mesh position={[0, .14, 0]}><cylinderGeometry args={[.85, 1, .28, 8]} /><meshStandardMaterial color="#696e67" roughness={1} /></mesh>
      {[-.66, .66].map(x => <mesh key={x} position={[x, .88, 0]}><boxGeometry args={[.28, 1.55, .38]} /><meshStandardMaterial color="#9b9c8c" roughness={1} /></mesh>)}
      <mesh position={[0, 1.7, 0]}><boxGeometry args={[1.7, .32, .48]} /><meshStandardMaterial color={shrine.color} roughness={.85} /></mesh>
      <mesh position={[0, .48, 0]}><cylinderGeometry args={[.43, .3, .42, 8]} /><meshStandardMaterial color="#5c6462" /></mesh>
      <mesh position={[0, .98, 0]}><octahedronGeometry args={[restored ? .35 : .22]} /><meshStandardMaterial color={restored ? shrine.color : '#777e73'} emissive={restored ? shrine.color : '#000000'} emissiveIntensity={restored ? .6 : 0} /></mesh>
      <mesh position={[0, 1, 0]} visible={false}><boxGeometry args={[2, 2.1, 1.2]} /><meshBasicMaterial /></mesh>
      {showLabels && <Html position={[0, 2.25, 0]} center style={{ pointerEvents: 'none' }} zIndexRange={[3, 0]}><span className="frontier-label">{shrine.name}{restored ? ' · Restored' : ''}</span></Html>}
    </group>;
  })}</>;
}
