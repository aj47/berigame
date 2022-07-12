import { Canvas } from "@react-three/fiber";
import React, { useState } from "react";
import CameraController from "../Components/CameraController";
import RenderGLB from "../Components/RenderGLB";
import GroundPlane from "../Objects/GroundPlane";
import PlayerController from "../Objects/PlayerController";

// react three fiber docs
// https://docs.pmnd.rs/react-three-fiber/api/objects

const ThreeJSCanvas = () => {
  const [playerRef, setPlayerRef] = useState<any>();
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <Canvas id="three-canvas" resize={{ scroll: true, debounce: { scroll: 50, resize: 0 } }}>
        <pointLight position={[10, 9, 10]} intensity={0.3} />
        <pointLight position={[-10, 10, -10]} intensity={0.3} />
        <GroundPlane />
        <RenderGLB url={"/tree.glb"} position={[5,0,0]}/>
        <RenderGLB url={"/tree.glb"} position={[-5,0,0]}/>
        <PlayerController setPlayerRef={setPlayerRef}/>
        <CameraController playerRef={playerRef}/>
      </Canvas>
    </div>
  );
};

export default ThreeJSCanvas;
