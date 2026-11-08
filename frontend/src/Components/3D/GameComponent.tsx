import WorldInteractionController from '../../frontier/WorldInteractionController';
import { useAvatarFrontier, useFrontierEnabled } from "../../frontier/useFrontier";
import { type BuildDraft } from '../../frontier/FrontierPanel';
import FrontierWorld, { BramblewildCreatures, FrontierScene } from '../../frontier/FrontierWorld';
import HarbourApproach from '../../frontier/HarbourApproach';
import { MEADOW_OFFSET } from '../../../../shared/sim/frontier/homeMap';
import { Canvas, events as pointerEvents, useThree } from '@react-three/fiber';
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
import { useGroundItems, useMyPlayerSelector, usePlayersByHex, useTick, useTrees } from '../../spacetime/hooks';
import { NODE_VIEW_CELL, NODE_VIEW_RADIUS, nearbyNodes, nodeViewCell } from './nodes/nearbyNodes';
import { identityHex } from '../../spacetime/identity';
import { isWebGLError, WebGLContextWatch, webglAvailable, webglSupport } from './webgl';
import AdaptiveQuality from './AdaptiveQuality';
import { QUALITY, spireDpr, useGraphicsTier } from './renderQuality';
import { LANTERN_CENTRE_TILE, SPIRE_CENTRE, tileToWorld } from '@sim';
import { isAwayDistrict, isHomeScene, useHasPlayer, useMeadowsMounted, useMyRegion, useSealedFloor } from './homePresence';
import { withVisibleFilter } from '../../bosses/visibleEvents';
import { loadSpireScene } from '../../bosses/spire/loadSpireScene';
import { loadLanternScene } from '../../bosses/lantern/loadLanternScene';
import ClatterGlade from '../../bosses/clatterhorn/ClatterGlade';
import SpireGate from '../../bosses/spire/SpireGate';
import LanternGate from '../../bosses/lantern/LanternGate';
import { setWalkViewerOnFloor } from './walkTarget';
import type { CameraFocus } from './CameraController';
import { useHudStore } from '../hudVisibility';
import { WATCHING, WATCH_PARAMS } from '../../spacetime/viewer';

/** Only what you can see takes a click or a hover (FINAL_SPEC 7.4). */
const canvasEvents = withVisibleFilter(pointerEvents);
/** How long a sealed floor's scene (the Spire, Lanternmaw) waits before fetching its chunk again after a failed load. */
export const SPIRE_RETRY_MS = 1500;

/**
 * The Spire's scene is its own chunk, fetched during the lobby (SpireLobbyPanel preloads it). Its own error
 * boundary inside the Canvas: a failed chunk load renders nothing and retries with a fresh React.lazy (a lazy
 * component remembers its rejection), instead of reaching WorldBoundary and blanking the whole world.
 */
class SpireBoundary extends React.Component<{ children: React.ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.warn('The boss scene could not load; retrying', error); this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

/** A sealed floor's lazy scene with its own boundary and retry (the Spire's and Lanternmaw's). */
function SealedSceneSlot({ load }: { load: () => Promise<{ default: React.ComponentType<any> }> }) {
  const [attempt, setAttempt] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const Scene = useMemo(() => React.lazy(() => load()), [attempt]);
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => { setWaiting(false); setAttempt((n) => n + 1); }, SPIRE_RETRY_MS);
    return () => clearTimeout(timer);
  }, [waiting]);
  return <SpireBoundary key={attempt} onError={() => setWaiting(true)}><Suspense fallback={null}><Scene /></Suspense></SpireBoundary>;
}

export function SpireSceneSlot() {
  return <SealedSceneSlot load={loadSpireScene} />;
}

/** Lanternmaw's Drowned Hollow, the same way (LanternLobbyPanel preloads its chunk). */
export function LanternSceneSlot() {
  return <SealedSceneSlot load={loadLanternScene} />;
}
const [spireX, , spireZ] = tileToWorld(SPIRE_CENTRE);
/** Inside the Spire the camera frames the arena centre: 24 (landscape) or 30 (portrait), zoom 18..34. */
export const SPIRE_CAMERA: CameraFocus = { target: [spireX, spireZ], distance: 24, min: 18, max: 34 };
const [lanternX, , lanternZ] = tileToWorld(LANTERN_CENTRE_TILE);
/** In the Drowned Hollow the camera frames the maw the same way (the floor is 15 x 15 too). */
export const LANTERN_CAMERA: CameraFocus = { target: [lanternX, lanternZ], distance: 24, min: 18, max: 34 };

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
 * memoized component skips the tick. Only nodes near you are mounted
 * (nearbyNodes.ts): your position is quantized to a view cell, so the filter
 * reruns when the trees change or you cross a cell, not every tick.
 */
const nearGroundItem = (item: { x: number; z: number }, cell: string) => {
  const [cx, cz] = cell.split(',').map(Number);
  return Math.abs(item.x - (cx + 0.5) * NODE_VIEW_CELL) <= NODE_VIEW_RADIUS && Math.abs(item.z - (cz + 0.5) * NODE_VIEW_CELL) <= NODE_VIEW_RADIUS;
};
const selectViewCell = (me: { x: number; z: number; region?: string } | null) => nodeViewCell(me);
const WorldObjects = () => {
  const trees = useTrees();
  const groundItems = useGroundItems();
  const players = usePlayersByHex();
  const tick = useTick();
  const cell = useMyPlayerSelector(selectViewCell);
  const visible = useMemo(() => nearbyNodes(trees, cell), [trees, cell]);
  // A spectator holds the whole world's ground items; a player holds only the block around them.
  const piles = useMemo(() => (WATCHING ? groundItems.filter((item) => nearGroundItem(item, cell)) : groundItems), [groundItems, cell]);
  return (
    <>
      {visible.map((tree) => {
        const nodeTick = Math.min(tick, tree.cooldownUntilTick);
        const harvester = tree.harvester ? players.get(identityHex(tree.harvester)) ?? null : null;
        return !isBerryNode(tree)
          ? <CoastNode key={tree.id} node={tree} tick={nodeTick} harvester={harvester} />
          : <BerryTree key={tree.id} tree={tree} tick={nodeTick} harvester={harvester} />;
      })}
      {piles.map((item) => (
        <GroundItem key={item.id.toString()} groundItem={item} />
      ))}
    </>
  );
};

/** Renders at the source's frame cap (/watch fps=), so several OBS sources share a GPU. */
function WatchFrameCap({ fps }: { fps: number }) {
  const advance = useThree((s) => s.advance);
  useEffect(() => {
    let frame = 0, last = 0;
    const interval = 1000 / fps;
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (now - last < interval - 1) return;
      last = now;
      advance(now / 1000);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [advance, fps]);
  return null;
}

/** `spectator`: the scene alone (/watch): no HUD, loading screen or input, and a fixed resolution and frame cap. */
const GameComponent = ({ spectator = false }: { spectator?: boolean }) => {
  const hasPlayer = useHasPlayer();
  const region = useMyRegion();
  const frontierEnabled = useFrontierEnabled();
  const avatarFrontier = useAvatarFrontier();
  const [draft, setDraft] = useState<BuildDraft | null>(null);
  // Without WebGL 2 the renderer throws; skip it and show browser fix steps instead.
  const [webgl] = useState(webglSupport);
  useEffect(() => { if (webgl !== 'webgl2') useLoadingStore.getState().setGraphicsIssue(webgl === 'webgl1' ? 'webgl1' : 'unsupported'); }, [webgl]);
  const homeScene = isHomeScene(region, frontierEnabled);
  const inFrontier = isAwayDistrict(region);
  // Position-based, so it flips on the teleport row. Inside, the overworld is unmounted, not hidden:
  // R3F raycasts invisible meshes, and its useFrame loops would keep running during the bullet-hell.
  const floor = useSealedFloor();
  const inside = floor !== null;
  const meadows = useMeadowsMounted(frontierEnabled, !!draft);
  useEffect(() => { setWalkViewerOnFloor(floor); }, [floor]);
  const [playerRef, setPlayerRef] = useState<any>();
  const clickedOtherObject = useUserInputStore((state: any) => state.clickedOtherObject);
  // Settings > Graphics: a fixed tier, or auto (start from the device, then follow the frame rate).
  const graphics = useSettingsStore((s) => s.graphics);
  const quality = QUALITY[useGraphicsTier()];
  const worldLoading = useLoadingStore((s) => s.isLoading);
  const hudHidden = useHudStore((s) => s.hidden);

  return (
    <div style={{ width: '100%', height: '100dvh', position: 'relative', overflow: 'hidden' }}>
      {!spectator && <>
        <LoadingScreen />
        <WorldInteractionController disabled={!!draft} />
        <UIComponents frontierEnabled={frontierEnabled} draft={draft} onDraft={setDraft} />
        {!inFrontier && <CharacterSetup />}
        {homeScene && !draft && <WorldHoverTooltip />}
        {!draft && clickedOtherObject && <ClickDropdown region={region} />}
      </>}
      <div data-world-layer style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
      {webgl === 'webgl2' && <WorldBoundary>
      {!homeScene ? <FrontierWorld draft={draft} onDraft={setDraft} /> : <Canvas id="three-canvas" data-world-floor data-spire={floor === 'spire' || undefined} data-lantern={floor === 'lantern' || undefined} events={canvasEvents} frameloop={spectator ? 'never' : 'always'} dpr={spectator ? 1 : inside ? spireDpr(quality.dpr) : quality.dpr} shadows="percentage" camera={{ position: [8, 12, 15], fov: 42, near: 0.1, far: 180 }} gl={{ antialias: true, powerPreference: 'high-performance' }} resize={{ scroll: true, debounce: { scroll: 50, resize: 0 } }}>
        <WebGLContextWatch />
        {spectator && <WatchFrameCap fps={WATCH_PARAMS?.fps ?? 30} />}
        {graphics === 'auto' && !worldLoading && <AdaptiveQuality />}
        <Suspense fallback={null}>
          {!inside && <>
            <AlphaIsland />
            <WorldObjects />
            <Garden /><AdventureWorld frontierEnabled={frontierEnabled} />
            {frontierEnabled && <HarbourApproach />}
            {frontierEnabled && hasPlayer && <BramblewildCreatures disabled={!!draft} />}
            {meadows && <group position={[MEADOW_OFFSET.x, 0, MEADOW_OFFSET.z]}>
              <FrontierScene embedded draft={draft} onDraft={setDraft} />
            </group>}
            <ClatterGlade />
            <SpireGate />
            <LanternGate />
          </>}
          <RenderOnlineUsers frontier={avatarFrontier} />
          <PlayerController setPlayerRef={setPlayerRef} frontier={avatarFrontier} />
          <CameraController playerRef={playerRef} focus={floor === 'spire' ? SPIRE_CAMERA : floor === 'lantern' ? LANTERN_CAMERA : undefined} />
          {!spectator && !draft && <HoldToWalk />}
          {!spectator && !draft && !hudHidden && <WorldHover />}
          {!spectator && <DebugBridge />}
          <FxLayer />
        </Suspense>
        {/* Its own Suspense and error boundary: the chunk loading (or failing) never blanks the avatars. */}
        {floor === 'spire' && <SpireSceneSlot />}
        {floor === 'lantern' && <LanternSceneSlot />}
      </Canvas>}
      </WorldBoundary>}
      </div>
    </div>
  );
};

export default GameComponent;
