import { useAnimations, useGLTF } from "@react-three/drei";
import { useEffect, useRef } from "react";
import { AnimationMixer } from "three";

const RenderGLB = ({ url, onClick = null }) => {
  const group: any = useRef();
  const { scene, materials, animations } = useGLTF(url) as any;
  const { actions, mixer, ref, names } = useAnimations(animations, scene);
  useEffect(() => {
    actions["Idle"]?.play();
  }, [animations, mixer]);

  return (
    <group ref={group}>
      <primitive object={scene} onClick={onClick} />;
    </group>
  );
};

export default RenderGLB;
