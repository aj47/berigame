import { useThree } from "@react-three/fiber";
import React, { useRef } from "react";
import {
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  SphereGeometry,
} from "three";

const GroundPlane = (props) => {
  const mesh = useRef() as any;
  const { camera, gl, scene } = useThree();
  const onClick = (e) => {
    console.log(e, "e");
    console.log(scene, "scene");
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
        // clickPointOnLand = intersect.point;
      }
    }
    console.log(intersects, "intersects");
  };
  return (
    <mesh
      ref={mesh}
      name="land_mesh"
      scale={[500, 500, 1]}
      rotation={[Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
      onClick={onClick}
    >
      <planeBufferGeometry />
      <meshBasicMaterial color="grey" side={DoubleSide} />
    </mesh>
  );
};

export default GroundPlane;
