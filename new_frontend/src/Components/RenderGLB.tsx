import { useGLTF } from "@react-three/drei";
import { useEffect } from "react";

const RenderGLB = ({ url, onClick = null }) => {
  const { scene, materials } = useGLTF(url) as any;
  useEffect(() => {});
  return <primitive object={scene} onClick={onClick} />;
};

export default RenderGLB;
