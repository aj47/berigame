import WorldInteractionController from '../../frontier/WorldInteractionController';
import { useFrontier } from "../../frontier/useFrontier";
import { avatarFrontierState } from '../../frontier/avatarFrontierState';
import { type BuildDraft } from '../../frontier/FrontierPanel';
import FrontierWorld, { FrontierScene } from '../../frontier/FrontierWorld';
import HarbourApproach from '../../frontier/HarbourApproach';
import { MEADOW_OFFSET } from '../../../../shared/sim/frontier/homeMap';
import { useMyPlayer } from '../../spacetime/hooks';
import { Canvas } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import React, { Suspense, useEffect, useState } from 'react';
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
import { isWebGLError, WebGLContextWatch, webglAvailable } from './webgl';

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
  // Without WebGL the renderer throws; skip it and show browser fix steps instead.
  const [webgl] = useState(webglAvailable);
  useEffect(() => { if (!webgl) useLoadingStore.getState().setGraphicsIssue('unsupported'); }, [webgl]);
  const homeScene = !me?.region || me.region === 'bramblewild' || (frontier.enabled && me.region === 'settlement');
  const inFrontier = !!me?.region && me.region !== 'bramblewild';
  const [playerRef, setPlayerRef] = useState<any>();
  const clickedOtherObject = useUserInputStore((state: any) => state.clickedOtherObject);
  // Adaptive resolution: pixel ratio capped at 1.5, dropped to 1.0 (2.25x fewer pixels) while frames are slow.
  const [dprCap, setDprCap] = useState(1.5);
  // Settings > Graphics: auto adapts; high uses the screen's density (max 2); low renders fewer pixels.
  const graphics = useSettingsStore((s) => s.graphics);
  const deviceDpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const dpr: [number, number] = graphics === 'high' ? [1, Math.min(2, deviceDpr)] : graphics === 'low' ? [0.75, 0.75] : [1, dprCap];

  return (
    <div style={{ width: '100%', height: '100dvh', position: 'relative', overflow: 'hidden' }}>
      <LoadingScreen />
      <WorldInteractionController disabled={!!draft} />
      <UIComponents frontier={frontier} frontierEnabled={frontier.enabled} frontierCoins={frontier.profile.coins} draft={draft} onDraft={setDraft} />
      {!inFrontier && <CharacterSetup />}
      {homeScene && !draft && <WorldHoverTooltip />}
      {!draft && clickedOtherObject && <ClickDropdown region={me?.region || 'bramblewild'} />}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
      {webgl && <WorldBoundary>
      {!homeScene ? <FrontierWorld draft={draft} onDraft={setDraft} /> : <Canvas id="three-canvas" data-world-floor dpr={dpr} camera={{ position: [8, 12, 15], fov: 42, near: 0.1, far: 180 }} gl={{ antialias: true, powerPreference: 'high-performance' }} resize={{ scroll: true, debounce: { scroll: 50, resize: 0 } }}>
        <WebGLContextWatch />
        {graphics === 'auto' && <PerformanceMonitor onDecline={() => setDprCap(1)} onIncline={() => setDprCap(1.5)} flipflops={3} onFallback={() => setDprCap(1)} />}
        <Suspense fallback={null}>
          <AlphaIsland />
          <WorldObjects />
          <Garden /><AdventureWorld frontierEnabled={frontier.enabled} />
          {frontier.enabled && <HarbourApproach />}
          {frontier.enabled && me && <group position={[MEADOW_OFFSET.x, 0, MEADOW_OFFSET.z]}>
            <FrontierScene embedded draft={draft} onDraft={setDraft} />
          </group>}
          <RenderOnlineUsers frontier={avatarFrontier} />
          <PlayerController setPlayerRef={setPlayerRef} frontier={avatarFrontier} />
          <CameraController playerRef={playerRef} />
          {!draft && <HoldToWalk />}
          {!draft && <WorldHover />}
          <DebugBridge />
          <FxLayer />
        </Suspense>
      </Canvas>}
      </WorldBoundary>}
      </div>
    </div>
  );
};

export default GameComponent;
