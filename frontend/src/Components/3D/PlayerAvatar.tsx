import React, { Suspense, useEffect, useRef, useState } from 'react';
import { DEFAULT_APPEARANCE, PlayerState, type Appearance } from '@sim';
import type { Player } from '../../module_bindings/types';
import { useTileMotion } from '../../hooks/useTileMotion';
import { useCombatFxStore } from '../../spacetime/stores/combatFxStore';
import { useGameActions } from '../../spacetime/actions';
import { useUserInputStore } from '../../store';
import DamageNumber from './DamageNumber';
import { useAvatarDecal } from './AvatarDecals';
import { useAvatarLabels } from './AvatarOverlay';

import AdventurerModel, { BASE_MODEL_URL, modelUrl } from './AdventurerModel';
import { useAppearancePreview } from '../../appearance/store';
import { useToastStore } from '../../spacetime/stores/toastStore';
import type { AnimationCue } from '../../animation/combatPresentation';
import { identityHex } from '../../spacetime/identity';
import { useSocialStore } from '../../spacetime/stores/socialStore';
import { emoteCue } from '../../animation/emotes';

class HairBoundary extends React.Component<{ children:React.ReactNode; fallback:React.ReactNode }, { failed:boolean }> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){useToastStore.getState().show('That hairstyle could not load. Showing the starter style.');}
  render(){return this.state.failed?this.props.fallback:this.props.children;}
}
interface Props {
  row: Player;
  isSelf: boolean;
  /** This player's saved appearance row (looked up once by the parent), if any. */
  saved?: Appearance;
  /** You are hostile and this player is your combat target. */
  targeted?: boolean;
  /** A chat line still fresh enough to float above the head. */
  chatText?: string;
  setPlayerRef?: (ref: React.MutableRefObject<any>) => void;
}

/** Health bar: while below max, and for 5 s after any change. */
function useHealthShown(hp: number, maxHp: number): boolean {
  const [recent, setRecent] = useState(false);
  useEffect(() => {
    // As before: a bar also flashes up for 5 s when the avatar first appears.
    setRecent(true);
    const timer = setTimeout(() => setRecent(false), 5000);
    return () => clearTimeout(timer);
  }, [hp]);
  return hp < maxHp || recent;
}

/**
 * One shared rig and mechanically identical silhouette for every adventurer.
 * Memoized: a server tick re-renders only the avatars whose row (or labels) changed.
 */
const PlayerAvatar = ({ row, isSelf, saved = DEFAULT_APPEARANCE, targeted = false, chatText, setPlayerRef }: Props) => {
  const groupRef = useRef<any>(null);
  const setClickedOtherObject = useUserInputStore((s: any) => s.setClickedOtherObject);
  const actionsApi = useGameActions();
  const hex = identityHex(row.identity);
  const preview = useAppearancePreview((value) => isSelf ? value.draft : null);
  const chosen = isSelf && preview ? preview : saved;
  const appearance = { hairStyle:chosen.hairStyle, skinTone:chosen.skinTone, hairColor:chosen.hairColor, robeColor:chosen.robeColor, wrapColor:chosen.wrapColor };
  const url = modelUrl(appearance.hairStyle);
  const motion = useTileMotion(row.x, row.z, row.facing, groupRef);
  const cue = useCombatFxStore((s) => s.cues[hex]);
  const floating = useCombatFxStore((s) => s.numbers[hex]);
  const found = useCombatFxStore((s) => s.finds[hex]);
  const emote = useSocialStore((s) => s.emotes[hex]);
  const dead = row.state === PlayerState.Dead;
  // Moving, fighting, harvesting or dying ends an emote (a Sit holds until then).
  const activity = `${row.x},${row.z},${row.hostile},${row.pending},${row.harvestTreeId},${row.state}`;
  const lastActivity = useRef(activity);
  useEffect(() => {
    if (lastActivity.current === activity) return;
    lastActivity.current = activity;
    const current = useSocialStore.getState().emotes[hex];
    if (current) useSocialStore.getState().clearEmote(hex);
  }, [activity, hex]);
  const transient = useRef<AnimationCue | null>(null);
  // Combat cues win over an emote; an emote plays as a one-off 'action' cue.
  const emoteClip = emote && !dead ? emoteCue(emote.emote) : null;
  transient.current = cue ?? (emote && emoteClip ? { clip: emoteClip.clip, durationMs: emote.durationMs, at: emote.at, seq: 100000 + emote.seq, role: 'action' } : null);
  const healthShown = useHealthShown(row.hp, row.maxHp);
  useEffect(() => { if (isSelf && setPlayerRef) setPlayerRef(groupRef); }, [isSelf, setPlayerRef]);
  useAvatarDecal(groupRef, isSelf ? 'self' : targeted ? 'target' : 'other');
  useAvatarLabels(groupRef, {
    id: hex,
    name: `${isSelf ? 'You' : row.name}${targeted ? ' · Target' : ''}`,
    tone: isSelf ? 'self' : targeted ? 'targeted' : '',
    priority: isSelf ? 3 : targeted ? 2 : 1,
    health: !dead && healthShown ? row.hp / row.maxHp : null,
    chat: chatText || null,
  });

  const onClick = (e: any) => {
    if (isSelf || dead || e.delta > 5) return;
    e.stopPropagation();
    setClickedOtherObject({ connectionId: row.name, e, dropdownOptions: [
      { label: 'Attack', onClick: () => { actionsApi.attack(row.identity); setClickedOtherObject(null); } },
      { label: 'Follow', onClick: () => { actionsApi.follow(row.identity); setClickedOtherObject(null); } },
    ] });
  };
  const origin = { x: 0, y: 0, z: 0 };
  // Blob shadow and ring: <AvatarDecals />. Name, health bar and chat bubble: <AvatarOverlay />.
  return (
    <group ref={groupRef} onClick={onClick}>
      <mesh position={[0, 1.05, 0]} visible={false}><boxGeometry args={[0.9, 2.1, 0.8]} /><meshBasicMaterial /></mesh>
      {floating && <DamageNumber key={`fx-${hex}-${floating.seq}`} playerPosition={origin} yOffset={1.8} kind={floating.kind} text={floating.text} itemId={floating.itemId} appearAt={floating.at + floating.delayMs} />}
      {found && <DamageNumber key={`find-${hex}-${found.seq}`} playerPosition={origin} yOffset={1.8} kind={found.kind} text={found.text} itemId={found.itemId} appearAt={found.at + found.delayMs} />}
      <Suspense fallback={<mesh position={[0,1,0]}><capsuleGeometry args={[.25,1,4,6]} /><meshStandardMaterial color="#42699c" /></mesh>}>
        <HairBoundary key={url} fallback={<AdventurerModel url={BASE_MODEL_URL} appearance={appearance} identity={hex} isSelf={isSelf} state={row.state} weapon={row.weapon} motion={motion} transient={transient} />}>
          <AdventurerModel url={url} appearance={appearance} identity={hex} isSelf={isSelf} state={row.state} weapon={row.weapon} motion={motion} transient={transient} />
        </HairBoundary>
      </Suspense>
    </group>
  );
};
export default React.memo(PlayerAvatar);
