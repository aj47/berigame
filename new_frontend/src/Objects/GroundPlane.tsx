import { useThree } from "@react-three/fiber";
import React, { useRef } from "react";
import { DoubleSide } from "three";

const GroundPlane = (props) => {
  const mesh = useRef() as any;
  return (
    <mesh
      ref={mesh}
      name="land_mesh"
      scale={[500, 500, 1]}
      rotation={[Math.PI / 2, 0, 0]}
      position={[0, -0.1, 0]}
    >
      <planeBufferGeometry />
      <meshBasicMaterial color="#006994" side={DoubleSide} />
    </mesh>
  );
};

export default GroundPlane;
