import { useAnimations, useGLTF } from '@react-three/drei';
import { useFrame, useGraph } from '@react-three/fiber';
import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils';
import { BoxGeometry, MeshBasicMaterial } from 'three';
import { CHAT_BUBBLE_TICKS, PlayerState } from '@sim';
import type { Player } from '../../module_bindings/types';
import { useTileMotion } from '../../hooks/useTileMotion';
import { useCombatFxStore } from '../../spacetime/stores/combatFxStore';
import { useGameActions } from '../../spacetime/actions';
import { useLoadingStore, useUserInputStore } from '../../store';
import ChatBubble from './ChatBubble';
import DamageNumber from './DamageNumber';
import HealthBar from './HealthBar';
import StanceBadge from './StanceBadge';

const ATTACK_ANIM_MS = 900;
const MODEL_URL = 'native-woman.glb';

type Clip = 'Idle' | 'Walk' | 'RightHook' | null;

interface Props {
  row: Player;
  isSelf: boolean;
  chatText?: string;
  chatTick?: number;
  currentTick: number;
  setPlayerRef?: (ref: React.MutableRefObject<any>) => void;
}

/** One component for every player, including yourself. */
const PlayerAvatar = ({ row, isSelf, chatText, chatTick, currentTick, setPlayerRef }: Props) => {
  const groupRef = useRef<any>(null);
  const { scene, animations, materials } = useGLTF(MODEL_URL) as any;
  const clone = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { nodes } = useGraph(clone);
  const model = nodes.Scene ?? clone;
  const { actions } = useAnimations(animations, model);
  const addLoadedAsset = useLoadingStore((s) => s.addLoadedAsset);
  const setClickedOtherObject = useUserInputStore((s: any) => s.setClickedOtherObject);
  const actionsApi = useGameActions();

  const hex = row.identity.toHexString();
  const motion = useTileMotion(row.x, row.z, row.facing, groupRef);
  const attackSeq = useCombatFxStore((s) => s.attackSeq[hex] ?? 0);
  const floating = useCombatFxStore((s) => s.numbers[hex]);
  const attackUntil = useRef(0);
  const currentClip = useRef<Clip>(null);
  const hitBox = useMemo(() => new BoxGeometry(1, 5.5, 1), []);
  const hitBoxMaterial = useMemo(() => new MeshBasicMaterial({ visible: false }), []);

  useEffect(() => {
    addLoadedAsset(MODEL_URL);
  }, [addLoadedAsset]);

  useEffect(() => {
    if (isSelf && setPlayerRef) setPlayerRef(groupRef);
  }, [isSelf, setPlayerRef]);

  useEffect(() => {
    if (attackSeq > 0) attackUntil.current = performance.now() + ATTACK_ANIM_MS;
  }, [attackSeq]);

  const dead = row.state === PlayerState.Dead;

  useFrame(() => {
    let desired: Clip;
    if (dead) desired = null;
    else if (performance.now() < attackUntil.current) desired = 'RightHook';
    else if (motion.current.moving) desired = 'Walk';
    else desired = 'Idle';
    if (desired === currentClip.current) return;
    const prev = currentClip.current ? actions[currentClip.current] : null;
    prev?.fadeOut(0.15);
    if (desired) actions[desired]?.reset().fadeIn(0.15).play();
    currentClip.current = desired;
  });

  const onClick = (e: any) => {
    if (isSelf) return;
    e.stopPropagation();
    setClickedOtherObject({
      connectionId: row.name,
      e,
      dropdownOptions: [
        { label: 'Attack', onClick: () => { actionsApi.attack(row.identity); setClickedOtherObject(null); } },
        { label: 'Follow', onClick: () => { actionsApi.follow(row.identity); setClickedOtherObject(null); } },
      ],
    });
  };

  const showChat = chatText && chatTick !== undefined && currentTick - chatTick <= CHAT_BUBBLE_TICKS;
  const origin = { x: 0, y: 0, z: 0 };

  return (
    <group ref={groupRef} onClick={onClick}>
      <mesh geometry={hitBox} material={hitBoxMaterial} position={[0, 2.5, 0]} />
      <HealthBar playerPosition={origin} health={row.hp} maxHealth={row.maxHp} yOffset={2.5} isOwnPlayer={isSelf} />
      {!dead && <StanceBadge stance={row.stance} fightState={row.fightState} yOffset={2.9} />}
      {floating && (
        <DamageNumber key={`fx-${hex}-${floating.seq}`} playerPosition={origin} yOffset={1.5} kind={floating.kind} text={floating.text} />
      )}
      {showChat && <ChatBubble playerPosition={origin} yOffset={3.4} chatMessage={chatText} />}
      {dead && <ChatBubble playerPosition={origin} yOffset={1} chatMessage="💀" />}
      <Suspense fallback={null}>
        <primitive object={model} visible={!dead} />
      </Suspense>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.45, 0.55, 24]} />
        <meshBasicMaterial color={isSelf ? '#ffffff' : '#000000'} transparent opacity={0.35} />
      </mesh>
    </group>
  );
};

useGLTF.preload(MODEL_URL);

export default PlayerAvatar;
