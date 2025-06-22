import { Canvas } from "@react-three/fiber";
import React, { useState, Suspense } from "react";
import CameraController from "./CameraController";
import RenderGLB from "./RenderGLB";
import GroundPlane from "../../Objects/GroundPlane";
import PlayerController from "./PlayerController";
import RenderOnlineUsers from "./RenderOnlineUsers";
import Api from "../Api";
import RenderNPC from "./RenderNPC";
import AlphaIsland from "./AlphaIsland";
import ClickDropdown from "../ClickDropdown";
import { useChatStore, useUserInputStore, useLoadingStore } from "../../store";
import UIComponents from "../UIComponents";
import BerryTree from "./BerryTree";
import LoadingScreen from "../LoadingScreen";

// react three fiber docs
// https://docs.pmnd.rs/react-three-fiber/api/objects

const GameComponent = () => {
  const [playerRef, setPlayerRef] = useState<any>();
  const clickedOtherObject = useUserInputStore(
    (state: any) => state.clickedOtherObject
  );
  const { isLoading } = useLoadingStore();

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <LoadingScreen />
      <Api />
      <UIComponents/>
      {clickedOtherObject && <ClickDropdown />}
      <Canvas
        id="three-canvas"
        resize={{ scroll: true, debounce: { scroll: 50, resize: 0 } }}
      >
        <Suspense fallback={null}>
          <AlphaIsland />
          <RenderNPC isCombatable={false} />
          <RenderOnlineUsers />
          <PlayerController
            setPlayerRef={setPlayerRef}
          />
          <CameraController playerRef={playerRef} />
        </Suspense>
      </Canvas>
    </div>
  );
};

export default GameComponent;