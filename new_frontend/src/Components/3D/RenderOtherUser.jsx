import { Html, useAnimations, useGLTF } from "@react-three/drei";
import TWEEN from "@tweenjs/tween.js";
import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useGraph } from "@react-three/fiber";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils";
import { BoxBufferGeometry, MeshBasicMaterial, Vector3 } from "three";
import { useUserInputStore } from "../../store";

const RenderOtherUser = ({
  url = "island-man.glb",
  position,
  rotation,
  restPosition,
  isWalking,
  messagesToRender,
}) => {
  const { scene, animations } = useGLTF(url);
  const clone = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { nodes } = useGraph(clone);
  const copiedScene = nodes.Scene;
  const { actions, mixer } = useAnimations(animations, copiedScene);
  const [currentTween, setCurrentTween] = useState(null);
  const objRef = new useRef();
  const hitBox = new BoxBufferGeometry(1, 5.5, 1);
  const hitBoxMaterial = new MeshBasicMaterial({ visible: false });
  const setClickedOtherObject = useUserInputStore(
    (state) => state.setClickedOtherObject
  );

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

  const onClick = (e) => {
    e.stopPropagation();
    setClickedOtherObject({...objRef});
  };

  return (
    <group ref={objRef} onClick={onClick}>
      <mesh geometry={hitBox} material={hitBoxMaterial} />
      {messagesToRender && (
        <Html
          center
          position={[
            copiedScene.position.x,
            copiedScene.position.y + 3,
            copiedScene.position.z,
          ]}
          className="player-chat-bubble"
        >
          {messagesToRender}
        </Html>
      )}
      <Suspense fallback={null}>
        <primitive object={copiedScene} rotation={rotation} />
      </Suspense>
    </group>
  );
};

export default RenderOtherUser;
