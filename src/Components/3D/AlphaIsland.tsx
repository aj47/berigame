import React from "react";
import GroundPlane from "../../Objects/GroundPlane";
import RenderGLB from "./RenderGLB";

const AlphaIsland = (props) => {
  return (
    <>
      <pointLight position={[10, 30, 0]} intensity={0.5} />
      <hemisphereLight intensity={0.4} /> 
      <GroundPlane />
      <RenderGLB url={"/tree.glb"} position={[5, 0, 0]} />
    </>
  );
};

export default AlphaIsland;
