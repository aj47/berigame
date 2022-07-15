import { useThree } from "@react-three/fiber";
import React from "react";
import { DoubleSide } from "three";

const GroundPlane = (props) => {
  return (
    <>
      <mesh
        name="land_mesh"
        scale={[50, 50, 1]}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, -0, 0]}
      >
        <planeBufferGeometry />
        <meshBasicMaterial color="#fff1a1" side={DoubleSide} />
      </mesh>
      <mesh
        name="water_mesh"
        scale={[500, 500, 1]}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, -0.1, 0]}
      >
        <planeBufferGeometry />
        <meshBasicMaterial color="#006994" side={DoubleSide} />
      </mesh>
    </>
  );
};

export default GroundPlane;
