import { useThree } from "@react-three/fiber";
import React, { useEffect } from "react"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

const CameraController = () => {
  const { camera , gl } = useThree();
  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.minDistance = 3;
    controls.maxDistance = 30;
    controls.target.set(0,2,0);
    camera.position.set(0, 2, 8);
    controls.update();
    return () => {
      controls.dispose();
    };
  }, [camera, gl]);
  return null;
};

export default CameraController;
