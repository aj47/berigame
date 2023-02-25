import React, { Suspense, useState } from "react";
import TWEEN from "@tweenjs/tween.js";
import { Html, useAnimations, useGLTF } from "@react-three/drei";
import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useChatStore, useUserInputStore, useUserStateStore, useWebsocketStore } from "../../store";
import { webSocketSendAction, webSocketSendPosition } from "../../Api";
import { Vector3 } from "three";
import HealthBar from "./HealthBar";
import ChatBubble from "./ChatBubble";

const PlayerController = (props) => {
  const objRef = useRef(null) as any;
  const { scene: obj, animations } = useGLTF("native-woman.glb") as any;
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
  const userFollowing = useUserStateStore(
    (state: any) => state.userFollowing
  );
  const justSentMessage = useChatStore(
    (state) => state.justSentMessage
  );

  const walkToPointOnLand = (pointOnLand) => {
    if (followingInterval) clearInterval(followingInterval);
    actions["Walk"]?.play();
    actions["RightHook"]?.stop();
    obj.lookAt(pointOnLand);

    // Smoothly transition position of character to clicked location
    if (currentTween) TWEEN.remove(currentTween);
    setCurrentTween(
      new TWEEN.Tween(objRef.current.position)
        .to(pointOnLand, objRef.current.position.distanceTo(pointOnLand) * 500)
        .onUpdate(onPositionUpdate)
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
        attackingPlayer: clickedOtherObject?.connectionId,
        isWalking: true,
      },
      websocketConnection,
      allConnections
    );
  };

  const onPositionUpdate = () => {
    // if clicked enemy
    if (!clickedOtherObject) return;
    if (!clickedOtherObject.isCombatable) return;
    // Check if in attack range and attack
    const enemyLocation = clickedOtherObject.current.position;
    const distance = objRef.current.position.distanceTo(enemyLocation);
    if (distance < 2) {
      // attack
      actions["Walking"]?.stop();
      actions["RightHook"]?.play();
    } else {
      // stop attacking
      actions["Walking"]?.play();
      actions["RightHook"]?.stop();
    }
  };

  useEffect(() => {
    if (!userFollowing) return;
    clearInterval(followingInterval);
    setFollowingInterval(setInterval(walkTowardsOtherPlayer, 500));
    return () => clearInterval(followingInterval);
  }, [currentTween]);

  const walkTowardsOtherPlayer = () => {
    const separation = 1.5;
    const pointOnLand = userFollowing.current.position;
    const distance =
      objRef.current.position.distanceTo(pointOnLand) - separation;
    if (distance < 1) {
      onPositionUpdate();
      obj.lookAt(pointOnLand);
      webSocketSendPosition(
        {
          position: objRef.current.position,
          restPosition: objRef.current.position,
          rotation: obj.rotation,
          // attackingPlayer: userFollowing?.connectionId,
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
      .subVectors(objRef.current.position, userFollowing.current.position)
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
        attackingPlayer: clickedOtherObject?.connectionId,
      },
      websocketConnection,
      allConnections
    );
  }, [allConnections]);

  useEffect(() => {
    if (clickedPointOnLand) walkToPointOnLand(clickedPointOnLand);
  }, [clickedPointOnLand]);

  useEffect(() => {
    if (userFollowing) {
      walkTowardsOtherPlayer();
      setFollowingInterval(setInterval(walkTowardsOtherPlayer, 500));
    }
    return () => clearInterval(followingInterval);
  }, [userFollowing]);

  useFrame(() => {
    TWEEN.update();
  });

  useEffect(() => {
    actions["Idle"]?.play();
  }, [animations, mixer]);

  useEffect(() => {
    props.setPlayerRef(objRef);
    if (objRef)
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
  }, [objRef]);

  return (
    <group ref={objRef}>
      {justSentMessage && (
        <ChatBubble
          playerPosition={obj.position}
          yOffset={2.5}
          chatMessage={justSentMessage}
        />
      )}
      {/* {true && <HealthBar playerPosition={obj.position} health={100}/>} */}
      <Suspense fallback={null}>
        <primitive object={obj} />
      </Suspense>
    </group>
  );
};

export default PlayerController;
