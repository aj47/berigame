import { useAnimations, useGLTF } from "@react-three/drei";
import { useEffect, useRef } from "react";
import { AnimationMixer } from "three";

const RenderGLB = ({ url, onClick = null }) => {
  const group: any = useRef();
  const { scene } = useGLTF(url) as any;
  return (
    <group ref={group}>
      <primitive object={scene} onClick={onClick} />;
    </group>
  );
};

export default RenderGLB;
