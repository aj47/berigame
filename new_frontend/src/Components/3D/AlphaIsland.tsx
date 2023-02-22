import React from "react";
import GroundPlane from "../../Objects/GroundPlane";
import RenderGLB from "./RenderGLB";

const AlphaIsland = (props) => {
  return (
    <>
      <pointLight position={[10, 9, 10]} intensity={0.5} />
      <pointLight position={[-10, 10, 0]} intensity={0.5} />
      <pointLight position={[10, 30, 0]} intensity={0.5} />
      <GroundPlane />
      <RenderGLB url={"/tree.glb"} position={[5, 0, 0]} />
    </>
  );
};

export default AlphaIsland;
