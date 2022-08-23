import React, { Suspense, useState } from "react";
import TWEEN from "@tweenjs/tween.js";
import { Html, useAnimations, useGLTF } from "@react-three/drei";
import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useUserInputStore, useWebsocketStore } from "../../store";
import { webSocketSendPosition } from "../../Api";

const PlayerController = (props) => {
  const objRef = useRef(null) as any;
  const { scene: obj, animations } = useGLTF("island-man.glb") as any;
  const { actions, mixer } = useAnimations(animations, obj);
  const [currentTween, setCurrentTween] = useState<any>(null);
  const websocketConnection = useWebsocketStore(
    (state: any) => state.websocketConnection
  );
  const allConnections = useWebsocketStore(
    (state: any) => state.allConnections
  );
  const clickedPointOnLand = useUserInputStore(
    (state: any) => state.clickedPointOnLand
  );

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
    if (clickedPointOnLand) {
      actions["Walk"]?.play();
      obj.lookAt(clickedPointOnLand);

      // Smoothly transition position of character to clicked location
      if (currentTween) TWEEN.remove(currentTween);
      setCurrentTween(
        new TWEEN.Tween(objRef.current.position)
          .to(
            clickedPointOnLand,
            objRef.current.position.distanceTo(clickedPointOnLand) * 500
          )
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
          restPosition: clickedPointOnLand,
          rotation: obj.rotation,
          isWalking: true,
        },
        websocketConnection,
        allConnections
      );
    }
  }, [clickedPointOnLand]);

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
