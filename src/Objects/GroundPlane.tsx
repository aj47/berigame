import { useThree } from "@react-three/fiber";
import React, { useState } from "react";
import {
  ArrowHelper,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  SphereGeometry,
} from "three";
import { useUserInputStore } from "../store";

const GroundPlane = (props) => {
  const [justClicked, setJustClicked] = useState(false);
  const { camera, gl, scene } = useThree();
  const setClickedPointOnLand = useUserInputStore(
    (state: any) => state.setClickedPointOnLand
  );

  const landClickReleased = (e) => {
    if (!justClicked) return;
    // Get clicked position on land
    const clickPosition = {
      x: (e.clientX * 2) / gl.domElement.clientWidth - 1,
      y: (e.clientY * -2) / gl.domElement.clientHeight + 1,
    };
    const raycaster = new Raycaster();
    raycaster.setFromCamera(clickPosition, camera);
    const intersects = raycaster.intersectObjects(scene.children, false);
    for (const intersect of intersects) {
      if (intersect.object.name === "land_mesh") {
        const sphere = new Mesh(
          new SphereGeometry(0.25, 32, 16),
          new MeshBasicMaterial({ color: 0xffff00 })
        );
        const { x, y, z } = intersect.point;
        sphere.position.set(x, y, z);
        scene.add(sphere);
        setTimeout(() => {
          scene.remove(sphere);
        }, 1000);
        // clicked position
        setClickedPointOnLand(intersect.point);
      }
    }
  };

  const landClicked = (e) => {
    setJustClicked(true);
    setTimeout(() => {
      setJustClicked(false);
    }, 200);
  };

  return (
    <>
      <mesh
        name="land_mesh"
        scale={[50, 50, 1]}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, -0, 0]}
        onPointerDown={landClicked}
        onPointerUp={landClickReleased}
      >
        <planeGeometry />
        <meshBasicMaterial color="#fff1a1" side={DoubleSide} />
      </mesh>
      <mesh
        name="water_mesh"
        scale={[500, 500, 1]}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, -0.1, 0]}
      >
        <planeGeometry />
        <meshBasicMaterial color="#006994" side={DoubleSide} />
      </mesh>
    </>
  );
};

export default GroundPlane;
