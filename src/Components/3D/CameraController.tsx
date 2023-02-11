import { useFrame, useThree } from "@react-three/fiber";
import React, { useEffect, useMemo } from "react"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

const CameraController = (props) => {
  const { camera , gl } = useThree();
  const controls = useMemo(() => new OrbitControls(camera, gl.domElement), [])
  useEffect(() => {
    controls.minDistance = 10;
    controls.maxDistance = 10;
    // controls.maxPolarAngle = Math.PI/2 - 0.1; 
    camera.position.set(0, 2, 8);
    controls.update();
    return () => {
      controls.dispose();
    };
  }, [camera, gl]);
  
  useFrame(() => {
    if (!props.playerRef?.current?.position) return
    const {x,y,z} = props.playerRef?.current?.position;
    controls.target.set(x,y,z);
    return controls.update();
  })

  return null;
};

export default CameraController;
