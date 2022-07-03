import React, { Suspense } from "react";
import { useAnimations, useGLTF } from "@react-three/drei";
import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Raycaster } from "three";

const PlayerController = (props) => {
  const { scene, materials, animations } = useGLTF("man.glb") as any;
  const { actions, mixer, ref, names } = useAnimations(animations, scene);
  const { camera, gl } = useThree();
  // document
  //   .getElementById("three-canvas")
  //   ?.addEventListener("pointerup", (e) => mouseDown(e), false);

  useEffect(() => {
    console.log(gl, "gl");
    console.log(actions, "actions");
    console.log(names, "names");
    actions["Idle"]?.play();
  }, [animations, mixer]);

  return (
    <Suspense fallback={null}>
      <primitive object={scene} />;
    </Suspense>
  );
};

export default PlayerController;
