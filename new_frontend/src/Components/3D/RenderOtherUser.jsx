import { useGLTF } from "@react-three/drei";
import React, { Suspense, useMemo } from "react";
import { useGraph } from "@react-three/fiber";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils";

const RenderOtherUser = (props) => {
  const { scene, materials, animations } = useGLTF("island-man.glb");
  const clone = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { nodes } = useGraph(clone);
  const copiedScene = nodes.Scene;
  return (
    <group>
      <Suspense fallback={null}>
        <primitive object={copiedScene} position={props.position} rotation={props.rotation}/>;
      </Suspense>
    </group>
  );
};

export default RenderOtherUser;
