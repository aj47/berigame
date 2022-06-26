import React from "react";
import { DoubleSide } from "three";

const GroundPlane = (props) => {
  return (
    <mesh
      scale={[500, 500, 1]}
      rotation={[Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
    >
      <planeBufferGeometry />
      <meshBasicMaterial color="grey" side={DoubleSide} />
    </mesh>
  );
};

export default GroundPlane;
