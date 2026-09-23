import { Canvas } from '@react-three/fiber';
import React, { Suspense, useState } from 'react';
import CameraController from './CameraController';
import PlayerController from './PlayerController';
import RenderOnlineUsers from './RenderOnlineUsers';
import AlphaIsland from './AlphaIsland';
import ClickDropdown from '../ClickDropdown';
import { useLoadingStore, useUserInputStore } from '../../store';
import UIComponents from '../UIComponents';
import BerryTree from './BerryTree';
import LoadingScreen from '../LoadingScreen';
import GroundItem from './GroundItem';
import DebugBridge from './DebugBridge';
import { useGroundItems, usePlayersByHex, useTick, useTrees } from '../../spacetime/hooks';

class WorldBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() {
    useLoadingStore.setState({ isLoading: true, assetError: 'The island graphics could not load. Rejoin to retry.', loadingMessage: 'The island graphics could not load. Rejoin to retry.' });
  }
  render() { return this.state.failed ? null : this.props.children; }
}

const GameComponent = () => {
  const [playerRef, setPlayerRef] = useState<any>();
  const clickedOtherObject = useUserInputStore((state: any) => state.clickedOtherObject);
  const trees = useTrees();
  const groundItems = useGroundItems();
  const players = usePlayersByHex();
  const tick = useTick();

  return (
    <div style={{ width: '100%', height: '100dvh', position: 'relative', overflow: 'hidden' }}>
      <LoadingScreen />
      <UIComponents />
      {clickedOtherObject && <ClickDropdown />}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
      <WorldBoundary>
      <Canvas id="three-canvas" dpr={[1, 1.5]} camera={{ position: [8, 12, 15], fov: 42, near: 0.1, far: 180 }} gl={{ antialias: true, powerPreference: 'high-performance' }} resize={{ scroll: true, debounce: { scroll: 50, resize: 0 } }}>
        <Suspense fallback={null}>
          <AlphaIsland />
          {trees.map((tree) => (
            <BerryTree
              key={tree.id}
              tree={tree}
              tick={tick}
              harvester={tree.harvester ? players.get(tree.harvester.toHexString()) ?? null : null}
            />
          ))}
          {groundItems.map((item) => (
            <GroundItem key={item.id.toString()} groundItem={item} />
          ))}
          <RenderOnlineUsers />
          <PlayerController setPlayerRef={setPlayerRef} />
          <CameraController playerRef={playerRef} />
          <DebugBridge />
        </Suspense>
      </Canvas>
      </WorldBoundary>
      </div>
    </div>
  );
};

export default GameComponent;
