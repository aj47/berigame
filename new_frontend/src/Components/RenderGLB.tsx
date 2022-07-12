import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";

const RenderGLB = ({ url, onClick = null, position }) => {
  const { scene } = useGLTF(url) as any;
	const copiedScene = useMemo(() => scene.clone(), [scene]);
  return (
    <group>
      <primitive object={copiedScene} onClick={onClick} position={position} />;
    </group>
  );
};

export default RenderGLB;
