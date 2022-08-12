import { useGLTF } from "@react-three/drei";
import React, { Suspense, useMemo } from "react";

const RenderOtherUser = (props) => {
  const {
    scene: obj,
    materials,
    animations,
  } = useGLTF("island-man.glb") as any;
  const copiedObj = useMemo(() => obj.clone(), [obj]);
  return (
    <group>
      <Suspense fallback={null}>
        <primitive object={copiedObj} position={props.position}/>;
      </Suspense>
    </group>
  );
};

export default RenderOtherUser;
