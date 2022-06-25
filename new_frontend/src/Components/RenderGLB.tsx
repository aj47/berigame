import { useGLTF } from "@react-three/drei";
import { useEffect } from "react";

const RenderGLB = ({ url, onClick = null, customColor = null }) => {
  const { scene, materials } = useGLTF(url) as any;
  useEffect(() => {
    if (customColor) {
      for (const material of Object.keys(materials)) {
        materials[material].color.setRGB(
          customColor.r,
          customColor.g,
          customColor.b
        );
      }
    }
  }, [customColor]);
  return <primitive object={scene} onClick={onClick} />;
};

export default RenderGLB;
