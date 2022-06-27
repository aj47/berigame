import { useAnimations, useGLTF } from "@react-three/drei";
import { useEffect, useRef } from "react";
import { AnimationMixer } from "three";

const RenderGLB = ({ url, onClick = null }) => {
  const group: any = useRef();
  const { scene, materials, animations } = useGLTF(url) as any;
  const { actions, mixer, ref, names } = useAnimations(animations, scene);
  useEffect(() => {
    // console.log(names, "names");
    // console.log(animations, "animations");
    // console.log(actions, "actions");
    console.log(
      actions[Object.keys(actions)[0]]?.play(),
      "Object.keys(actions)"
    );
  }, [animations, mixer]);

  return (
    <group ref={group}>
      <primitive object={scene} onClick={onClick} />;
    </group>
  );
};

export default RenderGLB;
