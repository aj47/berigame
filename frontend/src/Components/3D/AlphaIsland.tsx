import React from "react";
import GroundPlane from "../../Objects/GroundPlane";
import BerryTree from "./BerryTree";

const AlphaIsland = (props) => {
  return (
    <>
      <pointLight position={[10, 30, 0]} intensity={0.5} />
      <hemisphereLight intensity={0.4} /> 
      <GroundPlane />
      <BerryTree />
    </>
  );
};

export default AlphaIsland;
