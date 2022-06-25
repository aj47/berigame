import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useState } from "react";
import CameraController from "../Components/CameraController";
import RenderGLB from "../Components/RenderGLB";

interface ThreeJSCanvasProps {
  templateURL: string;
  children: any;
  customColor: THREE.Color;
}

const ThreeJSCanvas = (props: ThreeJSCanvasProps) => {
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <Canvas resize={{ scroll: true, debounce: { scroll: 50, resize: 0 } }}>
        {props.templateURL && (
          <Suspense fallback={null}>
            <RenderGLB url={props.templateURL} customColor={props.customColor}/>
          </Suspense>
        )}
        <CameraController />
        {props.children}
      </Canvas>
    </div>
  );
};

export default ThreeJSCanvas;
