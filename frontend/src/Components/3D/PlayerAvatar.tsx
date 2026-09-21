import { Html } from '@react-three/drei';
import React, { Suspense, useEffect, useRef } from 'react';
import { CHAT_BUBBLE_TICKS, DEFAULT_APPEARANCE, PlayerState } from '@sim';
import type { Player } from '../../module_bindings/types';
import { useTileMotion } from '../../hooks/useTileMotion';
import { useCombatFxStore } from '../../spacetime/stores/combatFxStore';
import { useGameActions } from '../../spacetime/actions';
import { useAppearanceRows, useMyPlayer } from '../../spacetime/hooks';
import { useUserInputStore } from '../../store';
import ChatBubble from './ChatBubble';
import { useNameplateVisibility } from './useNameplateVisibility';
import DamageNumber from './DamageNumber';
import HealthBar from './HealthBar';
import StanceBadge from './StanceBadge';

import AdventurerModel, { BASE_MODEL_URL, modelUrl } from './AdventurerModel';
import { useAppearancePreview } from '../../appearance/store';
import { useToastStore } from '../../spacetime/stores/toastStore';
import type { AnimationCue } from '../../animation/combatPresentation';
import { identityHex } from '../../spacetime/identity';

class HairBoundary extends React.Component<{ children:React.ReactNode; fallback:React.ReactNode }, { failed:boolean }> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){useToastStore.getState().show('That hairstyle could not load. Showing the starter style.');}
  render(){return this.state.failed?this.props.fallback:this.props.children;}
}
interface Props {
  row: Player;
  isSelf: boolean;
  chatText?: string;
  chatTick?: number;
  currentTick: number;
  setPlayerRef?: (ref: React.MutableRefObject<any>) => void;
}

/** One shared rig and mechanically identical silhouette for every adventurer. */
const PlayerAvatar = ({ row, isSelf, chatText, chatTick, currentTick, setPlayerRef }: Props) => {
  const groupRef = useRef<any>(null);
  const setClickedOtherObject = useUserInputStore((s: any) => s.setClickedOtherObject);
  const actionsApi = useGameActions();
  const me = useMyPlayer();
  const hex = identityHex(row.identity);
  const saved = useAppearanceRows().find((value) => value.identity.__identity__ === row.identity.__identity__) ?? DEFAULT_APPEARANCE;
  const preview = useAppearancePreview((value) => isSelf ? value.draft : null);
  const chosen = isSelf && preview ? preview : saved;
  const appearance = { hairStyle:chosen.hairStyle, skinTone:chosen.skinTone, hairColor:chosen.hairColor, robeColor:chosen.robeColor, wrapColor:chosen.wrapColor };
  const url = modelUrl(appearance.hairStyle);
  const targeted = me?.hostile && me.combatTarget?.__identity__ === row.identity.__identity__;
  const nameRef = useNameplateVisibility(hex, isSelf ? 3 : targeted ? 2 : 1);
  const motion = useTileMotion(row.x, row.z, row.facing, groupRef);
  const cue = useCombatFxStore((s) => s.cues[hex]);
  const floating = useCombatFxStore((s) => s.numbers[hex]);
  const transient = useRef<AnimationCue | null>(null);
  transient.current = cue ?? null;
  const dead = row.state === PlayerState.Dead;
  useEffect(() => { if (isSelf && setPlayerRef) setPlayerRef(groupRef); }, [isSelf, setPlayerRef]);

  const onClick = (e: any) => {
    if (isSelf || dead || e.delta > 5) return;
    e.stopPropagation();
    setClickedOtherObject({ connectionId: row.name, e, dropdownOptions: [
      { label: 'Attack', onClick: () => { actionsApi.attack(row.identity); setClickedOtherObject(null); } },
      { label: 'Follow', onClick: () => { actionsApi.follow(row.identity); setClickedOtherObject(null); } },
    ] });
  };
  const showChat = chatText && chatTick !== undefined && currentTick - chatTick <= CHAT_BUBBLE_TICKS;
  const origin = { x: 0, y: 0, z: 0 };
  return (
    <group ref={groupRef} onClick={onClick}>
      <mesh position={[0, 1.05, 0]} visible={false}><boxGeometry args={[0.9, 2.1, 0.8]} /><meshBasicMaterial /></mesh>
      {!dead && <HealthBar playerPosition={origin} health={row.hp} maxHealth={row.maxHp} yOffset={2.45} isOwnPlayer={isSelf} />}
      {!dead && <StanceBadge stance={row.stance} fightState={row.fightState} yOffset={3.05} />}
      <Html zIndexRange={[3,0]} center position={[0,2.63,0]} style={{ pointerEvents:'none' }}>
        <span ref={nameRef} data-player-name={hex} className={`adventurer-name ${isSelf ? 'self' : targeted ? 'targeted' : ''}`}>{isSelf ? 'You' : row.name}{targeted ? ' · Target' : ''}</span>
      </Html>
      {floating && <DamageNumber key={`fx-${hex}-${floating.seq}`} playerPosition={origin} yOffset={1.8} kind={floating.kind} text={floating.text} appearAt={floating.at + floating.delayMs} />}
      {showChat && <ChatBubble playerPosition={origin} yOffset={3.65} chatMessage={chatText} />}
      <Suspense fallback={<mesh position={[0,1,0]}><capsuleGeometry args={[.25,1,4,6]} /><meshStandardMaterial color="#42699c" /></mesh>}>
        <HairBoundary key={url} fallback={<AdventurerModel url={BASE_MODEL_URL} appearance={appearance} identity={hex} isSelf={isSelf} state={row.state} stance={row.stance} motion={motion} transient={transient} />}>
          <AdventurerModel url={url} appearance={appearance} identity={hex} isSelf={isSelf} state={row.state} stance={row.stance} motion={motion} transient={transient} />
        </HairBoundary>
      </Suspense>
      <mesh position={[0, 0.016, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[1, 0.65, 1]}>
        <circleGeometry args={[0.55, 16]} /><meshBasicMaterial color="#233c2a" transparent opacity={0.19} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.48, 0.58, 24]} /><meshBasicMaterial color={isSelf ? '#fff2c9' : targeted ? '#e67855' : '#a7c1d0'} transparent opacity={isSelf || targeted ? 1 : 0.35} depthWrite={false} />
      </mesh>
    </group>
  );
};
export default PlayerAvatar;
