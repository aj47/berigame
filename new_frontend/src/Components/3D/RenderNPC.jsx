import { useAnimations, useGLTF } from "@react-three/drei";
import { useGraph } from "@react-three/fiber";
import React, { Suspense, useMemo } from "react"
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils";

const RenderNPC= (props) => {
  const { scene, materials, animations } = useGLTF("native-woman.glb");
  const clone = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { nodes } = useGraph(clone);
  const copiedScene = nodes.Scene;
  const { actions, mixer, ref, names } = useAnimations(animations, copiedScene);
	return (
    <group>
      <Suspense fallback={null}>
        <primitive object={copiedScene} position={[0,0,0]}/>;
      </Suspense>
    </group>
	)
};

export default RenderNPC;
