import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { Group } from 'three';
import { EventKind, dummyHpAt, tileToWorld } from '@sim';
import type { TrainingDummy as TrainingDummyRow } from '../../module_bindings/types';
import { useGameActions } from '../../spacetime/actions';
import { useMyPlayer } from '../../spacetime/hooks';
import { useSocialStore } from '../../spacetime/stores/socialStore';
import { useUserInputStore } from '../../store';
import DamageNumber from './DamageNumber';
import { useSettingsStore } from '../../spacetime/stores/settingsStore';
import { approachWorldInteraction } from '../../frontier/worldInteraction';
import { holdState, isDirectAttackClick } from './tapAssist';

const WOOD = '#7a5234', STRAW = '#d8b56a', SACK = '#c9a877', ROPE = '#6b4a2a';
const WOBBLE_MS = 700;

/**
 * The Grove's practice post: a straw-stuffed sack on a crossed post. It wobbles
 * when struck, floats the damage, and shows its HP while someone trains on it.
 * It never dies: a blow that would floor it springs it back to full.
 */
const TrainingDummy = ({ dummy, tick }: { dummy: TrainingDummyRow; tick: number }) => {
  const body = useRef<Group>(null);
  const setClickedOtherObject = useUserInputStore((s: any) => s.setClickedOtherObject);
  const { attackDummy } = useGameActions();
  const me = useMyPlayer();
  const oneClickAttack = useSettingsStore(s => s.oneClickAttack);
  const hit = useSocialStore((s) => s.dummyHits[dummy.id]);
  const eventHp = useSocialStore((s) => s.dummyHp[dummy.id]);
  const [x, , z] = tileToWorld(dummy);
  const recent = tick - dummy.lastHitTick < 25;
  const hp = recent && eventHp !== undefined ? eventHp : dummyHpAt(dummy, tick);

  useFrame(() => {
    const g = body.current;
    if (!g) return;
    const since = hit ? performance.now() - (hit.at + hit.delayMs) : Infinity;
    if (since >= 0 && since < WOBBLE_MS) {
      const k = 1 - since / WOBBLE_MS;
      g.rotation.x = -Math.sin(since / 55) * 0.22 * k * k;
      g.rotation.z = Math.sin(since / 80) * 0.08 * k;
    } else { g.rotation.x = 0; g.rotation.z = 0; }
  });

  const attack = () => {
    setClickedOtherObject(null);
    if (me?.region && me.region !== 'bramblewild') {
      approachWorldInteraction({ region: 'bramblewild', x: dummy.x, z: dummy.z }, () => { void attackDummy(dummy.id); }, 1);
    } else void attackDummy(dummy.id);
  };
  const onClick = (e: any) => {
    if (e.delta > 5) return;
    e.stopPropagation();
    if (holdState.active || performance.now() < holdState.suppressClickUntil) return;
    if (isDirectAttackClick(e, useSettingsStore.getState().oneClickAttack)) { attack(); return; }
    setClickedOtherObject({ connectionId: 'Training dummy', e: { clientX: e.clientX, clientY: e.clientY, ray: e.ray?.clone() }, dropdownOptions: [
      { label: 'Attack Training dummy', onClick: attack },
    ] });
  };

  return (
    <group position={[x, 0, z]} onClick={onClick} name="training-dummy" userData={{ berigameDummy: dummy.id, hoverTarget: {
      title: 'Training dummy', action: oneClickAttack ? 'Click to attack · hold for options' : 'Click for practice options', click: 'action', detail: 'Train your combat skills', radius: .7,
    } }}>
      {/* Base stake and footing. */}
      <mesh position={[0, 0.04, 0]} receiveShadow><cylinderGeometry args={[0.32, 0.38, 0.08, 10]} /><meshStandardMaterial color="#8a7a5c" roughness={1} /></mesh>
      <group ref={body}>
        <mesh position={[0, 0.75, 0]} castShadow><cylinderGeometry args={[0.07, 0.08, 1.5, 8]} /><meshStandardMaterial color={WOOD} roughness={0.9} /></mesh>
        {/* Arms: a crossbar with straw tufts. */}
        <mesh position={[0, 1.2, 0]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.05, 0.05, 1.0, 6]} /><meshStandardMaterial color={WOOD} roughness={0.9} /></mesh>
        {[-0.52, 0.52].map((sx) => <mesh key={sx} position={[sx, 1.2, 0]} rotation={[0, 0, sx > 0 ? -Math.PI / 2 : Math.PI / 2]}><coneGeometry args={[0.09, 0.2, 6]} /><meshStandardMaterial color={STRAW} roughness={1} /></mesh>)}
        {/* Sack torso, belted with rope. */}
        <mesh position={[0, 0.98, 0]} castShadow><capsuleGeometry args={[0.24, 0.42, 4, 10]} /><meshStandardMaterial color={SACK} roughness={1} /></mesh>
        <mesh position={[0, 0.86, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.25, 0.025, 6, 16]} /><meshStandardMaterial color={ROPE} /></mesh>
        {/* Head: a sack ball with a painted target. */}
        <mesh position={[0, 1.55, 0]} castShadow><sphereGeometry args={[0.2, 12, 10]} /><meshStandardMaterial color={SACK} roughness={1} /></mesh>
        <mesh position={[0, 1.02, 0.245]}><circleGeometry args={[0.12, 16]} /><meshStandardMaterial color="#b3402e" /></mesh>
        <mesh position={[0, 1.02, 0.247]}><circleGeometry args={[0.06, 16]} /><meshStandardMaterial color="#f1e6c8" /></mesh>
      </group>
      {/* Invisible click target, a little larger than the dummy. */}
      <mesh position={[0, 0.9, 0]} visible={false}><boxGeometry args={[0.9, 1.9, 0.9]} /><meshBasicMaterial /></mesh>
      {hit && <DamageNumber key={`dummy-${hit.seq}`} playerPosition={{ x: 0, y: 0, z: 0 }} yOffset={1.95} kind={EventKind.Hit} text={hit.reset ? `${hit.damage} · reset` : String(hit.damage)} itemId={hit.itemId} appearAt={hit.at + hit.delayMs} />}
      {recent && (
        <Html position={[0, 2.05, 0]} center zIndexRange={[3, 0]} style={{ pointerEvents: 'none' }}>
          <div className="dummy-hp" role="meter" aria-label="Training dummy" aria-valuenow={hp} aria-valuemax={dummy.maxHp}>
            <div className="dummy-hp-fill" style={{ width: `${(hp / Math.max(1, dummy.maxHp)) * 100}%` }} />
          </div>
        </Html>
      )}
    </group>
  );
};

export default React.memo(TrainingDummy);
