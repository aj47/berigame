import { useAnimations, useGLTF } from "@react-three/drei";
import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useGraph } from "@react-three/fiber";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils";
import { Vector3 } from "three";

const RenderOtherUser = ({ position, rotation, restPosition }) => {
  const { scene, materials, animations } = useGLTF("island-man.glb");
  const clone = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { nodes } = useGraph(clone);
  const copiedScene = nodes.Scene;
  const { actions, mixer, ref, names } = useAnimations(animations, copiedScene);
  const [atRestPosition, setAtRestPosition] = useState(false);
  useEffect(() => {
    if (atRestPosition) {
      actions["Walk"]?.stop();
      actions["Idle"]?.play();
    } else {  
      actions["Idle"]?.stop();
      actions["Walk"]?.play();
    }
  });
  
  useEffect(() => {
    setAtRestPosition(restPosition[0] === position[0] &&
    restPosition[1] === position[1] &&
    restPosition[2] === position[2]);
  }, [position])

  useEffect(() => {
    actions["Idle"]?.play();
  }, [animations, mixer]);

  return (
    <group>
      <Suspense fallback={null}>
        <primitive
          object={copiedScene}
          position={position}
          rotation={rotation}
        />
        ;
      </Suspense>
    </group>
  );
};

export default RenderOtherUser;
