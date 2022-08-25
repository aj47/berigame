import React, { Suspense, useState } from "react";
import TWEEN from "@tweenjs/tween.js";
import { Html, useAnimations, useGLTF } from "@react-three/drei";
import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useUserInputStore, useWebsocketStore } from "../../store";
import { webSocketSendPosition } from "../../Api";
import { Vector3 } from "three";

const PlayerController = (props) => {
  const objRef = useRef(null) as any;
  const { scene: obj, animations } = useGLTF("island-man.glb") as any;
  const { actions, mixer } = useAnimations(animations, obj);
  const [currentTween, setCurrentTween] = useState<any>(null);
  const [followingInterval, setFollowingInterval] = useState<any>(null);
  const websocketConnection = useWebsocketStore(
    (state: any) => state.websocketConnection
  );
  const allConnections = useWebsocketStore(
    (state: any) => state.allConnections
  );
  const clickedPointOnLand = useUserInputStore(
    (state: any) => state.clickedPointOnLand
  );
  const clickedOtherObject = useUserInputStore(
    (state: any) => state.clickedOtherObject
  );

  const walkToPointOnLand = (pointOnLand) => {
    if (followingInterval) clearInterval(followingInterval);
    actions["Walk"]?.play();
    obj.lookAt(pointOnLand);

    // Smoothly transition position of character to clicked location
    if (currentTween) TWEEN.remove(currentTween);
    setCurrentTween(
      new TWEEN.Tween(objRef.current.position)
        .to(pointOnLand, objRef.current.position.distanceTo(pointOnLand) * 500)
        .onComplete(() => {
          actions["Walk"]?.stop();
          actions["Idle"]?.play();
          webSocketSendPosition(
            {
              position: objRef.current.position,
              restPosition: objRef.current.position,
              rotation: obj.rotation,
              isWalking: false,
            },
            websocketConnection,
            allConnections
          );
        })
        .start()
    );

    webSocketSendPosition(
      {
        position: objRef.current.position,
        restPosition: pointOnLand,
        rotation: obj.rotation,
        isWalking: true,
      },
      websocketConnection,
      allConnections
    );
  };

  const walkTowardsOtherPlayer = () => {
    const separation = 1.5;
    const pointOnLand = clickedOtherObject.current.position;
    const distance =
      objRef.current.position.distanceTo(pointOnLand) - separation;
    if (distance < 1) {
      obj.lookAt(pointOnLand);
      webSocketSendPosition(
        {
          position: objRef.current.position,
          restPosition: objRef.current.position,
          rotation: obj.rotation,
          isWalking: true,
        },
        websocketConnection,
        allConnections
      );
      return;
    }
    const dirV = new Vector3();
    const distV = new Vector3();
    const direction = dirV
      .subVectors(objRef.current.position, clickedOtherObject.current.position)
      .normalize();
    // calculate vector that is towards clicked object but 1 unit away
    distV.addVectors(
      objRef.current.position,
      direction.multiplyScalar(-1 * distance)
    );
    walkToPointOnLand(distV);
  };

  useEffect(() => {
    // broadcast position
    if (!allConnections || allConnections.length === 0) return;
    webSocketSendPosition(
      {
        position: objRef.current.position,
        restPosition: objRef.current.position,
        rotation: obj.rotation,
        isWalking: false,
      },
      websocketConnection,
      allConnections
    );
  }, [allConnections]);

  useEffect(() => {
    if (clickedPointOnLand) walkToPointOnLand(clickedPointOnLand);
  }, [clickedPointOnLand]);

  useEffect(() => {
    if (clickedOtherObject) {
      walkTowardsOtherPlayer();
      setFollowingInterval(setInterval(walkTowardsOtherPlayer, 1000));
    }
    return () => clearInterval(followingInterval);
  }, [clickedOtherObject]);

  useFrame(() => {
    TWEEN.update();
  });

  useEffect(() => {
    actions["Idle"]?.play();
  }, [animations, mixer]);

  useEffect(() => {
    props.setPlayerRef(objRef);
  }, [objRef]);

  useEffect(() => {}, []);

  return (
    <group ref={objRef}>
      {props.chatMessage && (
        <Html
          center
          position={[obj.position.x, obj.position.y + 2, obj.position.z]}
          className="player-chat-bubble"
        >
          {props.chatMessage}
        </Html>
      )}
      <Suspense fallback={null}>
        <primitive object={obj} />;
      </Suspense>
    </group>
  );
};

export default PlayerController;
