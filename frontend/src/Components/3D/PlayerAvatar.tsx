import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_APPEARANCE, normalizeAppearance, APPEARANCE_KEYS, PlayerState, inGrace, inSafeRing, type Appearance } from '@sim';
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
import { useWornCosmetics, useExpeditions, useMyPlayer, useTick } from '../../spacetime/hooks';
import { useGameActions } from '../../spacetime/actions';
import { useSettingsStore } from '../../spacetime/stores/settingsStore';
import { useProgressStore, XP_FLOAT_KIND } from '../../spacetime/stores/progressStore';
import type { AnimationCue } from '../../animation/combatPresentation';
import { identityHex } from '../../spacetime/identity';
import { useSocialStore } from '../../spacetime/stores/socialStore';
import { emoteCue } from '../../animation/emotes';
import { avatarSelection } from './playerSelection';
import { holdState, isDirectAttackClick } from './tapAssist';
import { homePoint } from '../../../../shared/sim/frontier/homeMap';
import { openSettlement } from '../../frontier/navigation';
import { useResourceHarvest } from '../../frontier/useResourceHarvest';
import { approachWorldInteraction } from '../../frontier/worldInteraction';

class HairBoundary extends React.Component<{ children:React.ReactNode; fallback:React.ReactNode }, { failed:boolean }> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){useToastStore.getState().show('That hairstyle could not load. Showing the starter style.');}
  render(){return this.state.failed?this.props.fallback:this.props.children;}
}
interface Props {
  frontierBlocked?: Set<string>;
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
const PlayerAvatar = ({ row, isSelf, saved = DEFAULT_APPEARANCE, targeted = false, chatText, setPlayerRef, frontierBlocked }: Props) => {
  const groupRef = useRef<any>(null);
  const setClickedOtherObject = useUserInputStore((s: any) => s.setClickedOtherObject);
  const hex = identityHex(row.identity);
  const gathering = useResourceHarvest(hex);
  const expeditions=useExpeditions();
  const carrying=expeditions.some(e=>e.stage==='hauling' && e.carrier?.toHexString()===hex);
  const preview = useAppearancePreview((value) => isSelf ? value.draft : null);
  const chosen = isSelf && preview ? preview : saved;
  // Stable while the colours hold, so the memoized model skips row-only (movement) renders.
  const appearanceKey = APPEARANCE_KEYS.map(key => chosen[key] ?? 0).join(':');
  const appearance = useMemo(() => normalizeAppearance(chosen), [appearanceKey]);
  const url = modelUrl(appearance.hairStyle);
  const motion = useTileMotion(row.x, row.z, row.facing, groupRef, (row.region || 'bramblewild') as any, frontierBlocked);
  const cue = useCombatFxStore((s) => s.cues[hex]);
  const floating = useCombatFxStore((s) => s.numbers[hex]);
  const found = useCombatFxStore((s) => s.finds[hex]);
  const emote = useSocialStore((s) => s.emotes[hex]);
  const worn = useWornCosmetics(hex);
  const head = worn >> 8, neck = worn & 255;
  // XP floaters are yours alone (other players' XP is not broadcast as events).
  const xpFloat = useProgressStore((s) => (isSelf ? s.xpFloat : null));
  const dead = row.state === PlayerState.Dead;
  const me = useMyPlayer();
  const tick = useTick();
  const { attack, frontier } = useGameActions();
  const oneClickAttack = useSettingsStore(s => s.oneClickAttack);
  const regionalActions = !isSelf && ((row.region && row.region !== 'bramblewild') || (me?.region && me.region !== 'bramblewild'));
  const selfGroundActions = isSelf && (!row.region || row.region === 'bramblewild');
  const sameRegion = (row.region || 'bramblewild') === (me?.region || 'bramblewild');
  const directAttack = oneClickAttack && !isSelf && row.online && !dead && !!me && me.state === PlayerState.Alive
    && sameRegion && (!!regionalActions || (!inSafeRing(me) && !inSafeRing(row) && !inGrace(row, tick)));
  const liveAttack = useRef({ row, directAttack, mounted: true });
  liveAttack.current = { row, directAttack, mounted: true };
  useEffect(() => {
    liveAttack.current.mounted = true;
    return () => { liveAttack.current.mounted = false; };
  }, []);
  // Moving, fighting, harvesting or dying ends an emote (a Sit holds until then).
  const activity = `${row.x},${row.z},${row.hostile},${row.pending},${row.harvestTreeId},${row.state},${gathering?.harvest?.startedAt ?? ''}`;
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
    if (dead || e.delta > 5 || (isSelf && !selfGroundActions)) return;
    e.stopPropagation();
    if (holdState.active || performance.now() < holdState.suppressClickUntil) return;
    if (isDirectAttackClick(e, directAttack)) {
      setClickedOtherObject(null);
      if (regionalActions) {
        approachWorldInteraction({ ...row, region: (row.region || 'bramblewild') as any }, () => {
          const current = liveAttack.current;
          if (current.mounted && current.directAttack) void frontier({ action: 'attack', id: identityHex(current.row.identity) });
        }, 1);
      } else void attack(row.identity);
      return;
    }
    if (regionalActions) {
      setClickedOtherObject(null);
      approachWorldInteraction({ ...row, region: (row.region || 'bramblewild') as any }, () => openSettlement('Wildlife'));
      return;
    }
    setClickedOtherObject({
      ...avatarSelection({ hex, name: row.name, x: row.x, z: row.z, isSelf }, e.intersections ?? []),
      e: { clientX: e.clientX, clientY: e.clientY, ray: e.ray },
    });
  };
  const origin = { x: 0, y: 0, z: 0 };
  // Blob shadow and ring: <AvatarDecals />. Name, health bar and chat bubble: <AvatarOverlay />.
  return (
    <group ref={groupRef} onClick={onClick} userData={{ hoverTarget: dead || (isSelf && !selfGroundActions) ? null : {
      title: isSelf ? 'You' : row.name,
      action: isSelf ? 'Click for ground actions' : directAttack ? 'Click to attack' : regionalActions ? 'View player actions' : 'Click for player actions',
      detail: isSelf ? 'Pick up items · walk here' : directAttack ? 'Hold for player actions' : regionalActions ? undefined : 'Follow · trade · attack',
      radius: .65, tile: homePoint(row, row.region || 'bramblewild'),
      ...(isSelf ? {} : directAttack ? { playerHex: hex, click: 'action' } : regionalActions ? { click: 'panel' } : { playerHex: hex }),
    } }}>
      <mesh position={[0, 1.05, 0]} visible={false}><boxGeometry args={[0.9, 2.1, 0.8]} /><meshBasicMaterial /></mesh>
      {floating && <DamageNumber key={`fx-${hex}-${floating.seq}`} playerPosition={origin} yOffset={1.8} kind={floating.kind} text={floating.text} itemId={floating.itemId} appearAt={floating.at + floating.delayMs} />}
      {found && <DamageNumber key={`find-${hex}-${found.seq}`} playerPosition={origin} yOffset={1.8} kind={found.kind} text={found.text} itemId={found.itemId} appearAt={found.at + found.delayMs} />}
      {xpFloat && <DamageNumber key={`xp-${xpFloat.seq}`} playerPosition={origin} yOffset={2.25} kind={XP_FLOAT_KIND} text={xpFloat.text} appearAt={xpFloat.at} />}
      <Suspense fallback={<mesh position={[0,1,0]}><capsuleGeometry args={[.25,1,4,6]} /><meshStandardMaterial color="#42699c" /></mesh>}>
        <HairBoundary key={url} fallback={<AdventurerModel url={BASE_MODEL_URL} appearance={appearance} identity={hex} isSelf={isSelf} state={row.state} weapon={row.weapon} carrying={carrying} gathering={gathering} motion={motion} transient={transient} head={head} neck={neck} />}>
          <AdventurerModel url={url} appearance={appearance} identity={hex} isSelf={isSelf} state={row.state} weapon={row.weapon} carrying={carrying} gathering={gathering} motion={motion} transient={transient} head={head} neck={neck} />
        </HairBoundary>
      </Suspense>
    </group>
  );
};
export default React.memo(PlayerAvatar);
