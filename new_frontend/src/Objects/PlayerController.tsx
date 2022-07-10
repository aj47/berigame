import React, { Suspense, useState } from "react";
import TWEEN, { Tween } from "@tweenjs/tween.js";
import { useAnimations, useGLTF } from "@react-three/drei";
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  SphereGeometry,
  Vector3,
} from "three";

const PlayerController = (props) => {
  const objRef = useRef(null) as any;
  const {
    scene: obj,
    materials,
    animations,
  } = useGLTF("island-man.glb") as any;
  const { actions, mixer, ref, names } = useAnimations(animations, obj);
  const { camera, gl, scene } = useThree();
  const [clickedPointOnLand, setClickedPointOnLand] = useState<Vector3 | null>(
    null
  );
  const [hasJustClicked, setHasJustClicked] = useState(false);

  let currentWalkTween: null | Tween<any> = null;

  //Listener for click / touch
  document
    .getElementById("three-canvas")
    ?.addEventListener("pointerup", (e) => mouseUp(e), false);

  const mouseUp = (e) => {
    console.log(hasJustClicked, "hasJustClicked");
    if (hasJustClicked) return;
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
        setClickedPointOnLand(intersect.point);
      }
    }
    setHasJustClicked(true);
    setTimeout(() => {setHasJustClicked(false);console.log("yes")}, 1000);
  };

  useEffect(() => {
    if (clickedPointOnLand) {
      console.log("yo");
      actions["Walk"]?.play();
      obj.lookAt(clickedPointOnLand);

      // Smoothly transition position of character to clicked location
      currentWalkTween = new TWEEN.Tween(obj.position)
        .to(
          clickedPointOnLand,
          obj.position.distanceTo(clickedPointOnLand) * 500
        )
        .onUpdate((position) => {
          objRef.position = position;
        })
        .onComplete(() => {
          setClickedPointOnLand(null);
          actions["Walk"]?.stop();
          actions["Idle"]?.play();
        })
        .start();
    }
  }, [clickedPointOnLand]);

  useFrame(() => {
    TWEEN.update();
  });

  useEffect(() => {
    actions["Idle"]?.play();
  }, [animations, mixer]);

  return (
    <Suspense fallback={null}>
      <primitive object={obj} ref={objRef} />;
    </Suspense>
  );
};

export default PlayerController;
