import { Html, useAnimations, useGLTF } from "@react-three/drei";
import TWEEN, { Tween } from "@tweenjs/tween.js";
import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useGraph } from "@react-three/fiber";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils";
import { Vector3 } from "three";

const RenderOtherUser = ({
  url = "island-man.glb",
  position,
  rotation,
  restPosition,
  isWalking,
  messagesToRender,
}) => {
  const { scene, materials, animations } = useGLTF(url);
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

  const isSameCoordinates = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  useEffect(() => {
    if (isWalking) {
      if (currentTween) TWEEN.remove(currentTween);
      if (isSameCoordinates(rotation, [0, 0, 0])) {
        copiedScene.lookAt(restPosition[0], restPosition[1], restPosition[2]);
      }
      actions["Idle"]?.stop();
      actions["Walk"]?.play();
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
      {messagesToRender && (
        <Html
          center
          position={[
            copiedScene.position.x,
            copiedScene.position.y + 2,
            copiedScene.position.z,
          ]}
          className="player-chat-bubble"
        >
          {messagesToRender}
        </Html>
      )}
      <Suspense fallback={null}>
        <primitive object={copiedScene} rotation={rotation} />;
      </Suspense>
    </group>
  );
};

export default RenderOtherUser;
