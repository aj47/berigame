import { useGLTF } from "@react-three/drei";
import React, { Suspense, useMemo } from "react";

const BasicTree = (props) => {
  const { scene } = useGLTF("tree.glb");
	const copiedScene = useMemo(() => scene.clone(), [scene]);
  return (
    <Suspense fallback={null}>
      <primitive position={props.position} object={copiedScene} />
    </Suspense>
  );
};

export default BasicTree;
