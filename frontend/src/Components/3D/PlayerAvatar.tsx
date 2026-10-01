import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_APPEARANCE, normalizeAppearance, APPEARANCE_KEYS, PlayerState, type Appearance } from '@sim';
import type { Player } from '../../module_bindings/types';
import { useTileMotion } from '../../hooks/useTileMotion';
import { useCombatFxStore } from '../../spacetime/stores/combatFxStore';
import { useUserInputStore } from '../../store';
import DamageNumber from './DamageNumber';
import { useAvatarDecal } from './AvatarDecals';
import { useAvatarLabels } from './AvatarOverlay';

import AdventurerModel, { BASE_MODEL_URL, modelUrl } from './AdventurerModel';
import { useAppearancePreview } from '../../appearance/store';
import { useToastStore } from '../../spacetime/stores/toastStore';
import { useWornCosmetics, useExpeditions } from '../../spacetime/hooks';
import { useProgressStore, XP_FLOAT_KIND } from '../../spacetime/stores/progressStore';
import type { AnimationCue } from '../../animation/combatPresentation';
import { identityHex } from '../../spacetime/identity';
import { useSocialStore } from '../../spacetime/stores/socialStore';
import { emoteCue } from '../../animation/emotes';
import { playersInHits } from './playerSelection';
import { holdState } from './tapAssist';

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
  const hex = identityHex(row.identity);
  const expeditions=useExpeditions();
  const carrying=expeditions.some(e=>e.stage==='hauling' && e.carrier?.toHexString()===hex);
  const preview = useAppearancePreview((value) => isSelf ? value.draft : null);
  const chosen = isSelf && preview ? preview : saved;
  // Stable while the colours hold, so the memoized model skips row-only (movement) renders.
  const appearanceKey = APPEARANCE_KEYS.map(key => chosen[key] ?? 0).join(':');
  const appearance = useMemo(() => normalizeAppearance(chosen), [appearanceKey]);
  const url = modelUrl(appearance.hairStyle);
  const motion = useTileMotion(row.x, row.z, row.facing, groupRef);
  const cue = useCombatFxStore((s) => s.cues[hex]);
  const floating = useCombatFxStore((s) => s.numbers[hex]);
  const found = useCombatFxStore((s) => s.finds[hex]);
  const emote = useSocialStore((s) => s.emotes[hex]);
  const worn = useWornCosmetics(hex);
  const head = worn >> 8, neck = worn & 255;
  // XP floaters are yours alone (other players' XP is not broadcast as events).
  const xpFloat = useProgressStore((s) => (isSelf ? s.xpFloat : null));
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
  transient.current = cue ?? (!carrying && emote && emoteClip ? { clip: emoteClip.clip, durationMs: emote.durationMs, at: emote.at, seq: 100000 + emote.seq, role: 'action' } : null);
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
    if (holdState.active || performance.now() < holdState.suppressClickUntil) return;
    const candidates = playersInHits(e.intersections ?? []);
    if (!candidates.some(player => player.hex === hex)) candidates.unshift({ hex, name: row.name });
    setClickedOtherObject({
      connectionId: candidates.length > 1 ? 'Choose player' : row.name,
      e: { clientX: e.clientX, clientY: e.clientY },
      playerChoices: candidates.map(player => player.hex),
      playerHex: candidates.length === 1 ? hex : undefined,
    });
  };
  const origin = { x: 0, y: 0, z: 0 };
  // Blob shadow and ring: <AvatarDecals />. Name, health bar and chat bubble: <AvatarOverlay />.
  return (
    <group ref={groupRef} onClick={onClick} userData={{ hoverTarget: isSelf || dead ? null : {
      title: row.name, action: 'Click for player actions', detail: 'Follow · trade · friend · attack', radius: .65, playerHex: hex,
    } }}>
      <mesh position={[0, 1.05, 0]} visible={false}><boxGeometry args={[0.9, 2.1, 0.8]} /><meshBasicMaterial /></mesh>
      {floating && <DamageNumber key={`fx-${hex}-${floating.seq}`} playerPosition={origin} yOffset={1.8} kind={floating.kind} text={floating.text} itemId={floating.itemId} appearAt={floating.at + floating.delayMs} />}
      {found && <DamageNumber key={`find-${hex}-${found.seq}`} playerPosition={origin} yOffset={1.8} kind={found.kind} text={found.text} itemId={found.itemId} appearAt={found.at + found.delayMs} />}
      {xpFloat && <DamageNumber key={`xp-${xpFloat.seq}`} playerPosition={origin} yOffset={2.25} kind={XP_FLOAT_KIND} text={xpFloat.text} appearAt={xpFloat.at} />}
      <Suspense fallback={<mesh position={[0,1,0]}><capsuleGeometry args={[.25,1,4,6]} /><meshStandardMaterial color="#42699c" /></mesh>}>
        <HairBoundary key={url} fallback={<AdventurerModel url={BASE_MODEL_URL} appearance={appearance} identity={hex} isSelf={isSelf} state={row.state} weapon={row.weapon} carrying={carrying} motion={motion} transient={transient} head={head} neck={neck} />}>
          <AdventurerModel url={url} appearance={appearance} identity={hex} isSelf={isSelf} state={row.state} weapon={row.weapon} carrying={carrying} motion={motion} transient={transient} head={head} neck={neck} />
        </HairBoundary>
      </Suspense>
    </group>
  );
};
export default React.memo(PlayerAvatar);
