import { useGLTF } from "@react-three/drei";
import { useGraph } from "@react-three/fiber";
import React from "react";
import { Suspense, useMemo } from "react";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils";

const RenderGLB = ({ url, onClick = null, position, animated = false }) => {
  const { scene } = useGLTF(url);
  let copiedScene = null;
  if (animated) {
    const clone = useMemo(() => SkeletonUtils.clone(scene), [scene])
    const { nodes } = useGraph(clone)
    copiedScene = nodes.Scene;
  } else {
    copiedScene = useMemo(() => scene.clone(), [scene]);
  }
  return (
    <Suspense fallback={null}>
      <primitive
        object={copiedScene}
        onClick={onClick}
        position={position}
      />
      ;
    </Suspense>
  );
};

export default RenderGLB;
