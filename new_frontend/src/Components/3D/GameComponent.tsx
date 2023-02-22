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

// react three fiber docs
// https://docs.pmnd.rs/react-three-fiber/api/objects

const GameComponent = () => {
  const [playerRef, setPlayerRef] = useState<any>();
  const [chatMessageSent, setChatMessageSent] = useState();
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <Api/>
      <ChatBox setChatMessageSent={setChatMessageSent} />
      <Canvas
        id="three-canvas"
        resize={{ scroll: true, debounce: { scroll: 50, resize: 0 } }}
      >
        <AlphaIsland/>
        <RenderNPC isCombatable={false}/>
        <RenderOnlineUsers/>
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
