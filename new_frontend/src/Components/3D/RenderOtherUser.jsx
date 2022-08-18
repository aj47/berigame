import { useAnimations, useGLTF } from "@react-three/drei";
import TWEEN, { Tween } from "@tweenjs/tween.js";
import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useGraph } from "@react-three/fiber";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils";
import { Vector3 } from "three";

const RenderOtherUser = ({ position, rotation, restPosition, isWalking }) => {
  const { scene, materials, animations } = useGLTF("island-man.glb");
  const clone = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { nodes } = useGraph(clone);
  const copiedScene = nodes.Scene;
  const { actions, mixer, ref, names } = useAnimations(animations, copiedScene);
  const [atRestPosition, setAtRestPosition] = useState(false);
  const [currentTween, setCurrentTween] = useState(null);
  const objRef = new useRef();

  useEffect(() => {
    objRef.current.position.set(position[0], position[1], position[2]);
  }, [position]);

  useEffect(() => {
    if (atRestPosition) {
      actions["Walk"]?.stop();
      actions["Idle"]?.play();
    } else {
      actions["Idle"]?.stop();
      actions["Walk"]?.play();
    }
  });

  useEffect(() => {
    setAtRestPosition(
      restPosition[0] === position[0] &&
        restPosition[1] === position[1] &&
        restPosition[2] === position[2]
    );
  }, [position]);

  useEffect(() => {
    if (isWalking) {
      if (currentTween) TWEEN.remove(currentTween);
      setCurrentTween(
        new TWEEN.Tween(objRef.current.position)
          .to(
            { x: restPosition[0], y: restPosition[1], z: restPosition[2] },
            objRef.current.position.distanceTo({
              x: restPosition[0],
              y: restPosition[1],
              z: restPosition[2],
            }) * 500
          )
          .onComplete(() => {
            actions["Walk"]?.stop();
            actions["Idle"]?.play();
          })
          .start()
      );
    }
  }, [isWalking, restPosition]);

  useFrame(() => {
    TWEEN.update();
  });

  useEffect(() => {
    actions["Idle"]?.play();
  }, [animations, mixer]);

  return (
    <group ref={objRef}>
      <Suspense fallback={null}>
        <primitive object={copiedScene} rotation={rotation} />;
      </Suspense>
    </group>
  );
};

export default RenderOtherUser;
