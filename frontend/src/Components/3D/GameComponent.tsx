import WorldInteractionController from '../../frontier/WorldInteractionController';
import { useFrontier } from "../../frontier/useFrontier";
import { avatarFrontierState } from '../../frontier/avatarFrontierState';
import { type BuildDraft } from '../../frontier/FrontierPanel';
import FrontierWorld, { BramblewildCreatures, FrontierScene } from '../../frontier/FrontierWorld';
import HarbourApproach from '../../frontier/HarbourApproach';
import { MEADOW_OFFSET } from '../../../../shared/sim/frontier/homeMap';
import { useMyPlayer } from '../../spacetime/hooks';
import { Canvas, events as pointerEvents } from '@react-three/fiber';
import React, { Suspense, useEffect, useMemo, useState } from 'react';
import CameraController from './CameraController';
import PlayerController from './PlayerController';
import RenderOnlineUsers from './RenderOnlineUsers';
import AlphaIsland from './AlphaIsland';
import ClickDropdown from '../ClickDropdown';
import { useLoadingStore, useUserInputStore } from '../../store';
import CharacterSetup from '../CharacterSetup';
import UIComponents from '../UIComponents';
import BerryTree from './BerryTree';
import CoastNode from './nodes/CoastNode';
import { isBerryNode } from '@sim';
import LoadingScreen from '../LoadingScreen';
import GroundItem from './GroundItem';
import DebugBridge from './DebugBridge';
import Garden from './Garden';
import AdventureWorld from './AdventureWorld';
import FxLayer from '../../fx/FxLayer';
import HoldToWalk from './HoldToWalk';
import WorldHover, { WorldHoverTooltip } from './WorldHover';
import { useSettingsStore } from '../../spacetime/stores/settingsStore';
import { useGroundItems, usePlayersByHex, useTick, useTrees } from '../../spacetime/hooks';
import { identityHex } from '../../spacetime/identity';
import { isWebGLError, WebGLContextWatch, webglAvailable, webglSupport } from './webgl';
import AdaptiveQuality from './AdaptiveQuality';
import { QUALITY, useGraphicsTier } from './renderQuality';
import { SPIRE_CENTRE, tileToWorld } from '@sim';
import { inSpire } from '../../bosses/selectors';
import { withVisibleFilter } from '../../bosses/visibleEvents';
import { loadSpireScene } from '../../bosses/spire/loadSpireScene';
import ClatterGlade from '../../bosses/clatterhorn/ClatterGlade';
import SpireGate from '../../bosses/spire/SpireGate';
import { setWalkViewerOnFloor } from './walkTarget';
import type { CameraFocus } from './CameraController';
import { useHudStore } from '../hudVisibility';

/** Only what you can see takes a click or a hover (FINAL_SPEC 7.4). */
const canvasEvents = withVisibleFilter(pointerEvents);
/** How long the Spire scene waits before fetching its chunk again after a failed load. */
export const SPIRE_RETRY_MS = 1500;

/**
 * The Spire's scene is its own chunk, fetched during the lobby (SpireLobbyPanel preloads it). Its own error
 * boundary inside the Canvas: a failed chunk load renders nothing and retries with a fresh React.lazy (a lazy
 * component remembers its rejection), instead of reaching WorldBoundary and blanking the whole world.
 */
class SpireBoundary extends React.Component<{ children: React.ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.warn('The Spire scene could not load; retrying', error); this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function SpireSceneSlot() {
  const [attempt, setAttempt] = useState(0);
  const Scene = useMemo(() => React.lazy(() => loadSpireScene()), [attempt]);
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => { setWaiting(false); setAttempt((n) => n + 1); }, SPIRE_RETRY_MS);
    return () => clearTimeout(timer);
  }, [waiting]);
  return <SpireBoundary key={attempt} onError={() => setWaiting(true)}><Suspense fallback={null}><Scene /></Suspense></SpireBoundary>;
}
const [spireX, , spireZ] = tileToWorld(SPIRE_CENTRE);
/** Inside the Spire the camera frames the arena centre: 24 (landscape) or 30 (portrait), zoom 18..34. */
export const SPIRE_CAMERA: CameraFocus = { target: [spireX, spireZ], distance: 24, min: 18, max: 34 };

class WorldBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) {
    if (isWebGLError(error) || !webglAvailable()) return useLoadingStore.getState().setGraphicsIssue('unsupported');
    useLoadingStore.setState({ isLoading: true, assetError: 'The island graphics could not load. Rejoin to retry.', loadingMessage: 'The island graphics could not load. Rejoin to retry.' });
  }
  render() { return this.state.failed ? null : this.props.children; }
}

/**
 * Gathering nodes and ground piles. Kept out of GameComponent so a server tick
 * re-renders this list, not the Canvas and the whole HUD. A node only sees the
 * tick while it regrows (its countdown); a ripe node gets a constant, so its
 * memoized component skips the tick.
 */
const WorldObjects = () => {
  const trees = useTrees();
  const groundItems = useGroundItems();
  const players = usePlayersByHex();
  const tick = useTick();
  return (
    <>
      {trees.map((tree) => {
        const nodeTick = Math.min(tick, tree.cooldownUntilTick);
        const harvester = tree.harvester ? players.get(identityHex(tree.harvester)) ?? null : null;
        return !isBerryNode(tree)
          ? <CoastNode key={tree.id} node={tree} tick={nodeTick} harvester={harvester} />
          : <BerryTree key={tree.id} tree={tree} tick={nodeTick} harvester={harvester} />;
      })}
      {groundItems.map((item) => (
        <GroundItem key={item.id.toString()} groundItem={item} />
      ))}
    </>
  );
};

const GameComponent = () => {
  const me = useMyPlayer();
  const frontier = useFrontier();
  const avatarFrontier = avatarFrontierState(frontier);
  const [draft, setDraft] = useState<BuildDraft | null>(null);
  // Without WebGL 2 the renderer throws; skip it and show browser fix steps instead.
  const [webgl] = useState(webglSupport);
  useEffect(() => { if (webgl !== 'webgl2') useLoadingStore.getState().setGraphicsIssue(webgl === 'webgl1' ? 'webgl1' : 'unsupported'); }, [webgl]);
  const homeScene = !me?.region || me.region === 'bramblewild' || (frontier.enabled && me.region === 'settlement');
  const inFrontier = !!me?.region && me.region !== 'bramblewild';
  // Position-based, so it flips on the teleport row. Inside, the overworld is unmounted, not hidden:
  // R3F raycasts invisible meshes, and its useFrame loops would keep running during the bullet-hell.
  const inside = inSpire(me);
  useEffect(() => { setWalkViewerOnFloor(inside); }, [inside]);
  const [playerRef, setPlayerRef] = useState<any>();
  const clickedOtherObject = useUserInputStore((state: any) => state.clickedOtherObject);
  // Settings > Graphics: a fixed tier, or auto (start from the device, then follow the frame rate).
  const graphics = useSettingsStore((s) => s.graphics);
  const quality = QUALITY[useGraphicsTier()];
  const worldLoading = useLoadingStore((s) => s.isLoading);
  const hudHidden = useHudStore((s) => s.hidden);

  return (
    <div style={{ width: '100%', height: '100dvh', position: 'relative', overflow: 'hidden' }}>
      <LoadingScreen />
      <WorldInteractionController disabled={!!draft} />
      <UIComponents frontier={frontier} frontierEnabled={frontier.enabled} frontierCoins={frontier.profile.coins} draft={draft} onDraft={setDraft} />
      {!inFrontier && <CharacterSetup />}
      {homeScene && !draft && <WorldHoverTooltip />}
      {!draft && clickedOtherObject && <ClickDropdown region={me?.region || 'bramblewild'} />}
      <div data-world-layer style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
      {webgl === 'webgl2' && <WorldBoundary>
      {!homeScene ? <FrontierWorld draft={draft} onDraft={setDraft} /> : <Canvas id="three-canvas" data-world-floor data-spire={inside || undefined} events={canvasEvents} dpr={quality.dpr} shadows="percentage" camera={{ position: [8, 12, 15], fov: 42, near: 0.1, far: 180 }} gl={{ antialias: true, powerPreference: 'high-performance' }} resize={{ scroll: true, debounce: { scroll: 50, resize: 0 } }}>
        <WebGLContextWatch />
        {graphics === 'auto' && !worldLoading && <AdaptiveQuality />}
        <Suspense fallback={null}>
          {!inside && <>
            <AlphaIsland />
            <WorldObjects />
            <Garden /><AdventureWorld frontierEnabled={frontier.enabled} />
            {frontier.enabled && <HarbourApproach />}
            {frontier.enabled && me && <BramblewildCreatures disabled={!!draft} />}
            {frontier.enabled && me && <group position={[MEADOW_OFFSET.x, 0, MEADOW_OFFSET.z]}>
              <FrontierScene embedded draft={draft} onDraft={setDraft} />
            </group>}
            <ClatterGlade />
            <SpireGate />
          </>}
          <RenderOnlineUsers frontier={avatarFrontier} />
          <PlayerController setPlayerRef={setPlayerRef} frontier={avatarFrontier} />
          <CameraController playerRef={playerRef} focus={inside ? SPIRE_CAMERA : undefined} />
          {!draft && <HoldToWalk />}
          {!draft && !hudHidden && <WorldHover />}
          <DebugBridge />
          <FxLayer />
        </Suspense>
        {/* Its own Suspense and error boundary: the chunk loading (or failing) never blanks the avatars. */}
        {inside && <SpireSceneSlot />}
      </Canvas>}
      </WorldBoundary>}
      </div>
    </div>
  );
};

export default GameComponent;
