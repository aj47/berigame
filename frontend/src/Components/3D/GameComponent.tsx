import { Canvas } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import React, { Suspense, useState } from 'react';
import CameraController from './CameraController';
import PlayerController from './PlayerController';
import RenderOnlineUsers from './RenderOnlineUsers';
import AlphaIsland from './AlphaIsland';
import ClickDropdown from '../ClickDropdown';
import { useLoadingStore, useUserInputStore } from '../../store';
import UIComponents from '../UIComponents';
import BerryTree from './BerryTree';
import CoastNode from './nodes/CoastNode';
import { isBerryNode } from '@sim';
import LoadingScreen from '../LoadingScreen';
import GroundItem from './GroundItem';
import DebugBridge from './DebugBridge';
import FxLayer from '../../fx/FxLayer';
import HoldToWalk from './HoldToWalk';
import { useSettingsStore } from '../../spacetime/stores/settingsStore';
import { useGroundItems, usePlayersByHex, useTick, useTrees } from '../../spacetime/hooks';
import { identityHex } from '../../spacetime/identity';

class WorldBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() {
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
      <UIComponents />
      {clickedOtherObject && <ClickDropdown />}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
      <WorldBoundary>
      <Canvas id="three-canvas" dpr={dpr} camera={{ position: [8, 12, 15], fov: 42, near: 0.1, far: 180 }} gl={{ antialias: true, powerPreference: 'high-performance' }} resize={{ scroll: true, debounce: { scroll: 50, resize: 0 } }}>
        {graphics === 'auto' && <PerformanceMonitor onDecline={() => setDprCap(1)} onIncline={() => setDprCap(1.5)} flipflops={3} onFallback={() => setDprCap(1)} />}
        <Suspense fallback={null}>
          <AlphaIsland />
          <WorldObjects />
          <RenderOnlineUsers />
          <PlayerController setPlayerRef={setPlayerRef} />
          <CameraController playerRef={playerRef} />
          <HoldToWalk />
          <DebugBridge />
          <FxLayer />
        </Suspense>
      </Canvas>
      </WorldBoundary>
      </div>
    </div>
  );
};

export default GameComponent;
