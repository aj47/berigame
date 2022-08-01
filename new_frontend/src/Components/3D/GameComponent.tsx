import { Canvas } from "@react-three/fiber";
import React, { useState } from "react";
import CameraController from "./CameraController";
import RenderGLB from "./RenderGLB";
import GroundPlane from "../../Objects/GroundPlane";
import PlayerController from "./PlayerController";
import ChatBox from "../ChatBox";

// react three fiber docs
// https://docs.pmnd.rs/react-three-fiber/api/objects

const GameComponent = () => {
  const [playerRef, setPlayerRef] = useState<any>();
  const [chatMessageSent, setChatMessageSent] = useState();
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <ChatBox setChatMessageSent={setChatMessageSent} />
      <Canvas
        id="three-canvas"
        resize={{ scroll: true, debounce: { scroll: 50, resize: 0 } }}
      >
        <pointLight position={[10, 9, 10]} intensity={0.5} />
        <pointLight position={[-10, 10, 0]} intensity={0.5} />
        <pointLight position={[10, 30, 0]} intensity={0.5} />
        <GroundPlane />
        <RenderGLB url={"/tree.glb"} position={[5, 0, 0]} />
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
