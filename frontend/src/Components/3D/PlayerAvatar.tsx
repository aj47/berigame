import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_APPEARANCE, normalizeAppearance, APPEARANCE_KEYS, PlayerState, RESPAWN_GRACE_TICKS, SPIRE_IFRAME_TICKS, type Appearance } from '@sim';
import { useFrame } from '@react-three/fiber';
import { useBossStore, type BossState } from '../../bosses/bossStore';
import { estimatedTick } from '../../fx/harvestProgress';
import type { Player } from '../../module_bindings/types';
import { useTileMotion } from '../../hooks/useTileMotion';
import { useCombatFxStore } from '../../spacetime/stores/combatFxStore';
import { useUserInputStore } from '../../store';
import DamageNumber from './DamageNumber';
import LoadGlow from './LoadGlow';
import { useAvatarDecal } from './AvatarDecals';
import { useAvatarLabels } from './AvatarOverlay';

import AdventurerModel, { BASE_MODEL_URL, modelUrl } from './AdventurerModel';
import { useAppearancePreview } from '../../appearance/store';
import { useToastStore } from '../../spacetime/stores/toastStore';
import { useWornCosmetics, useExpeditions, useMyPlayerSelector, useTickSelector } from '../../spacetime/hooks';
import { useGameActions } from '../../spacetime/actions';
import { useSettingsStore } from '../../spacetime/stores/settingsStore';
import { useProgressStore, XP_FLOAT_KIND } from '../../spacetime/stores/progressStore';
import type { AnimationCue } from '../../animation/combatPresentation';
import { identityHex } from '../../spacetime/identity';
import { useSocialStore } from '../../spacetime/stores/socialStore';
import { emoteCue } from '../../animation/emotes';
import { avatarSelection } from './playerSelection';
import { holdState, isDirectAttackClick } from './tapAssist';
import { homePoint, isHomeRegion } from '../../../../shared/sim/frontier/homeMap';
import type { FrontierSnapshot } from '../../../../shared/sim/frontier/snapshot';
import { meadowBlockedTiles } from './hoverTarget';
import { playerAttackProblem } from '../playerAttack';
import { useResourceHarvest } from '../../frontier/useResourceHarvest';

class HairBoundary extends React.Component<{ children:React.ReactNode; fallback:React.ReactNode }, { failed:boolean }> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){useToastStore.getState().show('That hairstyle could not load. Showing the starter style.');}
  render(){return this.state.failed?this.props.fallback:this.props.children;}
}
interface Props {
  frontierBlocked?: Set<string>;
  frontier?: Pick<FrontierSnapshot, 'buildings' | 'plots'>;
  row: Player;
  isSelf: boolean;
  /** This player's saved appearance row (looked up once by the parent), if any. */
  saved?: Appearance;
  /** You are hostile and this player is your combat target. */
  targeted?: boolean;
  /** A chat line still fresh enough to float above the head. */
  chatText?: string;
  /** Comma-separated identities standing on this tile that draw as this avatar (avatarStacks). */
  stacked?: string;
  setPlayerRef?: (ref: React.MutableRefObject<any>) => void;
}

/**
 * The tick of this player's last Spire bullet hit (`spire_fight.hitTick{slot}`
 * of the run you watch), or 0. Only your own run's fight row is subscribed, so
 * this is 0 for everyone outside it.
 */
export function spireHitTick(s: Pick<BossState, 'members' | 'fights'>, hex: string): number {
  const m = s.members.get(hex);
  const f = m ? s.fights.get(String(m.runId)) : undefined;
  if (!m || !f || m.slot > 3) return 0;
  return (f as unknown as Record<string, number>)[`hitTick${m.slot}`] ?? 0;
}

/** Immune (i-frames) at render tick `t`: the hit tick and the next SPIRE_IFRAME_TICKS server ticks. */
export function inIframes(hitTick: number, t: number): boolean {
  return hitTick > 0 && t >= hitTick && t < hitTick + SPIRE_IFRAME_TICKS + 1;
}

const SHIELD_ARGS: [number, number, number, number, number, boolean] = [0.55, 0.55, 2, 12, 1, true];

/**
 * Shows or hides the avatar model inside `group`: its children that carry
 * `userData.berigameAvatar` (AdventurerModel's object). The model must stay a
 * direct child of PlayerAvatar's group, because AdventurerModel registers
 * `model.parent` as the avatar's ground group (avatarRegistry: world
 * interactions, HitBack, knockback read its position and facing).
 */
export function setAvatarModelVisible(group: { children: { visible: boolean; userData: Record<string, unknown> }[] } | null | undefined, visible: boolean): void {
  if (!group) return;
  for (const child of group.children) if (child.userData.berigameAvatar) child.visible = visible;
}

/**
 * I-frame feedback on the avatar timeline (render tick = estimated tick - 1):
 * the model blinks, or with reduced motion a steady half-transparent shield
 * shows instead. Mounted only once a hit tick exists; never allocates per frame.
 */
const IframeBlink = ({ group, hitTick }: { group: React.MutableRefObject<any>; hitTick: number }) => {
  const shield = useRef<any>(null);
  const reduced = useSettingsStore((s) => s.reduceMotion);
  useEffect(() => () => setAvatarModelVisible(group.current, true), [group]);
  useFrame(() => {
    const now = performance.now();
    const on = inIframes(hitTick, Math.floor(estimatedTick(now) - 1));
    setAvatarModelVisible(group.current, reduced || !on || Math.floor(now / 90) % 2 === 0);
    if (shield.current) shield.current.visible = reduced && on;
  });
  return (
    <mesh ref={shield} position={[0, 1, 0]} visible={false} raycast={() => null}>
      <cylinderGeometry args={SHIELD_ARGS} />
      <meshBasicMaterial color="#9fe7ff" transparent opacity={0.5} depthWrite={false} />
    </mesh>
  );
};

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
const PlayerAvatar = ({ row, isSelf, saved = DEFAULT_APPEARANCE, targeted = false, chatText, stacked = '', setPlayerRef, frontierBlocked, frontier: frontierState }: Props) => {
  const groupRef = useRef<any>(null);
  const setClickedOtherObject = useUserInputStore((s: any) => s.setClickedOtherObject);
  const hex = identityHex(row.identity);
  const gathering = useResourceHarvest(hex);
  const hitTick = useBossStore((s) => spireHitTick(s, hex));
  const expeditions=useExpeditions();
  const carrying=expeditions.some(e=>e.stage==='hauling' && e.carrier?.toHexString()===hex);
  const preview = useAppearancePreview((value) => isSelf ? value.draft : null);
  const chosen = isSelf && preview ? preview : saved;
  // Stable while the colours hold, so the memoized model skips row-only (movement) renders.
  const appearanceKey = APPEARANCE_KEYS.map(key => chosen[key] ?? 0).join(':');
  const appearance = useMemo(() => normalizeAppearance(chosen), [appearanceKey]);
  const url = modelUrl(appearance.hairStyle);
  const motion = useTileMotion(row.x, row.z, row.facing, groupRef, (row.region || 'bramblewild') as any, frontierBlocked,
    frontierState ? from => meadowBlockedTiles(frontierState, from, hex, isHomeRegion(from.region) ? 'settlement' : from.region) : undefined, isSelf);
  const cue = useCombatFxStore((s) => s.cues[hex]);
  const floating = useCombatFxStore((s) => s.numbers[hex]);
  const found = useCombatFxStore((s) => s.finds[hex]);
  const emote = useSocialStore((s) => s.emotes[hex]);
  const worn = useWornCosmetics(hex);
  const head = worn >> 8, neck = worn & 255;
  // XP floaters are yours alone (other players' XP is not broadcast as events).
  const xpFloat = useProgressStore((s) => (isSelf ? s.xpFloat : null));
  const dead = row.state === PlayerState.Dead;
  // Only the grace boundary can change a Bramblewild target's availability.
  // Regional protection also uses wall-clock claim/challenge windows, so it still checks each tick.
  const tick = useTickSelector(useCallback((currentTick: number) => {
    if (isSelf) return 0;
    if (row.region && row.region !== 'bramblewild') return currentTick;
    const graceEnds = row.respawnTick + RESPAWN_GRACE_TICKS;
    return currentTick < graceEnds ? graceEnds - 1 : graceEnds;
  }, [isSelf, row.region, row.respawnTick]));
  const attackAllowed = useMyPlayerSelector(useCallback(me => !isSelf && !playerAttackProblem(me, row, frontierState, tick), [isSelf, row, frontierState, tick]));
  const { attack } = useGameActions();
  const oneClickAttack = useSettingsStore(s => s.oneClickAttack);
  const selfGroundActions = isSelf && (!row.region || row.region === 'bramblewild');
  const directAttack = oneClickAttack && attackAllowed;
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
  const stackedHexes = useMemo(() => (stacked ? stacked.split(',') : []), [stacked]);
  useEffect(() => { if (isSelf && setPlayerRef) setPlayerRef(groupRef); }, [isSelf, setPlayerRef]);
  useAvatarDecal(groupRef, isSelf ? 'self' : targeted ? 'target' : 'other');
  useAvatarLabels(groupRef, {
    id: hex,
    name: `${isSelf ? 'You' : row.name}${stackedHexes.length ? ` +${stackedHexes.length}` : ''}${targeted ? ' · Target' : ''}`,
    tone: isSelf ? 'self' : targeted ? 'targeted' : '',
    priority: isSelf ? 3 : targeted ? 2 : 1,
    health: !dead && healthShown ? row.hp / row.maxHp : null,
    chat: chatText || null,
  });

  const onClick = (e: any) => {
    if (dead || e.delta > 5 || (isSelf && !selfGroundActions)) return;
    e.stopPropagation();
    if (holdState.active || performance.now() < holdState.suppressClickUntil) return;
    // The toolbar can commit before the separate 3D renderer updates its handler.
    const attackNow = useSettingsStore.getState().oneClickAttack && attackAllowed;
    if (isDirectAttackClick(e, attackNow)) {
      setClickedOtherObject(null);
      void attack(row.identity);
      return;
    }
    const selection = avatarSelection({ hex, name: row.name, x: row.x, z: row.z, isSelf }, e.intersections ?? [], stackedHexes);
    const groundRegion = row.region || 'bramblewild';
    setClickedOtherObject({
      ...selection,
      groundRegion,
      // Regional dropped bags have their own table; local coordinates must not alias island loot.
      groundTiles: groundRegion === 'bramblewild' ? selection.groundTiles : [],
      e: { clientX: e.clientX, clientY: e.clientY, ray: e.ray },
    });
  };
  const origin = { x: 0, y: 0, z: 0 };
  // Blob shadow and ring: <AvatarDecals />. Name, health bar and chat bubble: <AvatarOverlay />.
  return (
    <group ref={groupRef} onClick={onClick} userData={{ hoverTarget: dead || (isSelf && !selfGroundActions) ? null : {
      title: isSelf ? 'You' : row.name,
      action: isSelf ? 'Click for ground actions' : directAttack ? 'Click to attack' : 'Click for player actions',
      detail: isSelf ? 'Pick up items · walk here' : directAttack ? 'Hold for player actions' : 'Follow · trade · attack',
      radius: .65, tile: homePoint(row, row.region || 'bramblewild'),
      ...(isSelf ? {} : { playerHex: hex, click: 'action' }),
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
      {hitTick > 0 && <IframeBlink group={groupRef} hitTick={hitTick} />}
      {!dead && (row.load ?? 0) > 0 && <LoadGlow level={row.load} />}
    </group>
  );
};
export default React.memo(PlayerAvatar);
