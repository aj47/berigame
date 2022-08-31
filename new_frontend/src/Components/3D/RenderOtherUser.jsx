import { Html, useAnimations, useGLTF } from "@react-three/drei";
import TWEEN from "@tweenjs/tween.js";
import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useGraph } from "@react-three/fiber";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils";
import { BoxBufferGeometry, MeshBasicMaterial, Vector3 } from "three";
import { useUserInputStore } from "../../store";

const RenderOtherUser = ({
  url = "native-woman.glb",
  position,
  rotation,
  restPosition,
  isWalking,
  messagesToRender,
  isCombatable = false,
  inCombat = false,
}) => {
  const { scene, animations, materials } = useGLTF(url);
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
    if (!isWalking)
      objRef.current.position.set(position[0], position[1], position[2]);
  }, [position]);

  const isSameCoordinates = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  useEffect(() => {
    const restPositionV3 = new Vector3(
      restPosition[0],
      restPosition[1],
      restPosition[2]
    );
    if (isWalking) {
      if (currentTween) TWEEN.remove(currentTween);
      if (isSameCoordinates(rotation, [0, 0, 0])) {
        copiedScene.lookAt(restPositionV3);
      }
      if (isSameCoordinates(objRef.current.position, restPositionV3)) return;
      actions["Idle"]?.stop();
      actions["Walk"]?.play();
      setCurrentTween(
        new TWEEN.Tween(objRef.current.position)
          .to(
            restPositionV3,
            objRef.current.position.distanceTo(restPositionV3) * 500
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

  const materialChange = () => {
    for (const material of Object.keys(materials)) {
      materials[material].userData.originalColor =
        "0x" + materials[material].color.getHexString();
      if (isCombatable) materials[material].color.setHex(0xff0000);
      else materials[material].color.setHex(0x00ff00);
    }
  };

  const clearMaterialChange = () => {
    for (const material of Object.keys(materials))
      materials[material].color.setHex(
        materials[material].userData.originalColor
      );
  };

  const onClick = (e) => {
    e.stopPropagation();
    materialChange();
    setClickedOtherObject({ ...objRef, isCombatable });
    setTimeout(() => {
      clearMaterialChange();
    }, 150);
  };

  return (
    <group ref={objRef} onClick={onClick}>
      <mesh geometry={hitBox} material={hitBoxMaterial} />
      {inCombat && (
        <Html
          center
          position={[
            copiedScene.position.x,
            copiedScene.position.y + 4,
            copiedScene.position.z,
          ]}
          className="player-chat-bubble"
        >
          in combat
        </Html>
      )}
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
