import { Canvas } from "@react-three/fiber";
import React, { useState } from "react";
import CameraController from "./CameraController";
import RenderGLB from "./RenderGLB";
import GroundPlane from "../../Objects/GroundPlane";
import PlayerController from "./PlayerController";
import ChatBox from "../ChatBox";
import RenderOnlineUsers from "./RenderOnlineUsers";
import Api from "../Api";
import RenderNPC from "./RenderNPC";
import AlphaIsland from "./AlphaIsland";
import ClickDropdown from "../ClickDropdown";
import { useUserInputStore } from "../../store";

// react three fiber docs
// https://docs.pmnd.rs/react-three-fiber/api/objects

const GameComponent = () => {
  const [playerRef, setPlayerRef] = useState<any>();
  const [chatMessageSent, setChatMessageSent] = useState();
  const clickedOtherObject = useUserInputStore(
    (state: any) => state.clickedOtherObject
  );
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <Api />
      {clickedOtherObject && <ClickDropdown />}
      <ChatBox setChatMessageSent={setChatMessageSent} />
      <Canvas
        id="three-canvas"
        resize={{ scroll: true, debounce: { scroll: 50, resize: 0 } }}
      >
        <AlphaIsland />
        <RenderNPC isCombatable={false} />
        <RenderOnlineUsers />
        <PlayerController
          chatMessage={chatMessageSent}
          setPlayerRef={setPlayerRef}
        />
        <CameraController playerRef={playerRef} />
      </Canvas>
    </div>
  );
};

export default GameComponent;
