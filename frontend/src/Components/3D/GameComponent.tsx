import { Canvas } from '@react-three/fiber';
import React, { Suspense, useState } from 'react';
import CameraController from './CameraController';
import PlayerController from './PlayerController';
import RenderOnlineUsers from './RenderOnlineUsers';
import AlphaIsland from './AlphaIsland';
import ClickDropdown from '../ClickDropdown';
import { useUserInputStore } from '../../store';
import UIComponents from '../UIComponents';
import BerryTree from './BerryTree';
import LoadingScreen from '../LoadingScreen';
import GroundItem from './GroundItem';
import DebugBridge from './DebugBridge';
import { useGroundItems, usePlayersByHex, useTick, useTrees } from '../../spacetime/hooks';

const GameComponent = () => {
  const [playerRef, setPlayerRef] = useState<any>();
  const clickedOtherObject = useUserInputStore((state: any) => state.clickedOtherObject);
  const trees = useTrees();
  const groundItems = useGroundItems();
  const players = usePlayersByHex();
  const tick = useTick();

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <LoadingScreen />
      <UIComponents />
      {clickedOtherObject && <ClickDropdown />}
      <Canvas id="three-canvas" resize={{ scroll: true, debounce: { scroll: 50, resize: 0 } }}>
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
    </div>
  );
};

export default GameComponent;
