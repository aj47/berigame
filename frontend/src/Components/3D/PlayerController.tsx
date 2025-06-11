import React, { Suspense, useState, useEffect, useRef } from "react";
import TWEEN from "@tweenjs/tween.js";
import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import {
  useChatStore,
  useOtherUsersStore,
  useUserInputStore,
  useUserStateStore,
  useWebsocketStore,
} from "../../store";
import { webSocketSendUpdate } from "../../Api";
import { RawShaderMaterial, Vector3, cloneUniformsGroups } from "three";
import HealthBar from "./HealthBar";
import ChatBubble from "./ChatBubble";
import DamageNumber from "./DamageNumber";
import WeaponAttachment from "./WeaponSystem/WeaponAttachment";
import { WeaponType } from "./WeaponSystem/Weapon";

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
  const userFollowing = useUserStateStore((state: any) => state.userFollowing);
  const userAttacking = useUserStateStore((state: any) => state.userAttacking);
  const userConnectionId = useUserStateStore(
    (state: any) => state.userConnectionId
  );
  const justSentMessage = useChatStore((state) => state.justSentMessage);
  const damageToRender = useOtherUsersStore((state) => state.damageToRender);
  const removeDamageToRender = useOtherUsersStore(
    (state) => state.removeDamageToRender
  );

  const [health, setHealth] = useState(30);
  const [currentDamage, setCurrentDamage] = useState<any>(null);

  // Weapon system state
  const [weaponEquipped, setWeaponEquipped] = useState(true); // Start with sword equipped for testing
  const [currentWeaponType, setCurrentWeaponType] = useState<WeaponType>(WeaponType.SWORD);

  useEffect(() => {
    // Check expired damage number
    if (currentDamage?.timestamp < Date.now() - 1400) setCurrentDamage(null);
  });
  useEffect(() => {
    // Set damage to render variables
    const userDamage = damageToRender[userConnectionId];
    if (userDamage) {
      setHealth(health - userDamage);
      setCurrentDamage({ val: userDamage, timestamp: Date.now() });
      removeDamageToRender(userConnectionId);
    }
  }, [damageToRender]);

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
          webSocketSendUpdate(
            {
              position: objRef.current.position,
              restPosition: objRef.current.position,
              rotation: obj.rotation,
              attackingPlayer: userAttacking,
              isWalking: false,
            },
            websocketConnection,
            allConnections
          );
        })
        .start()
    );

    webSocketSendUpdate(
      {
        position: objRef.current.position,
        restPosition: pointOnLand,
        rotation: obj.rotation,
        attackingPlayer: userAttacking,
        isWalking: true,
      },
      websocketConnection,
      allConnections
    );
  };

  const onPositionUpdate = () => {
    // if clicked enemy
    if (!userFollowing) return;
    // if (!userFollowing.isCombatable) return;
    // Check if in attack range and attack
    const enemyLocation = userFollowing.current.position;
    const distance = objRef.current.position.distanceTo(enemyLocation);
    if (distance < 2 && userAttacking) {
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
      webSocketSendUpdate(
        {
          position: objRef.current.position,
          restPosition: objRef.current.position,
          rotation: obj.rotation,
          isWalking: true,
          attackingPlayer: userAttacking,
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
    webSocketSendUpdate(
      {
        position: objRef.current.position,
        restPosition: objRef.current.position,
        rotation: obj.rotation,
        isWalking: false,
        attackingPlayer: userAttacking,
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
      setFollowingInterval(setInterval(walkTowardsOtherPlayer, 1000));
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
      webSocketSendUpdate(
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
          yOffset={2}
          chatMessage={justSentMessage}
        />
      )}
      <>
        <HealthBar
          playerPosition={obj.position}
          health={health}
          maxHealth={30}
          yOffset={2.5}
        />
        {currentDamage && (
          <DamageNumber
            key={currentDamage.timestamp}
            playerPosition={obj.position}
            yOffset={1.5}
            damageToRender={currentDamage.val}
          />
        )}
      </>
      <Suspense fallback={null}>
        <primitive object={obj} />
        {/* Weapon System - Attach weapon to character */}
        {weaponEquipped && (
          <WeaponAttachment
            characterScene={obj}
            weaponType={currentWeaponType}
            enabled={weaponEquipped}
          />
        )}
      </Suspense>
    </group>
  );
};

export default PlayerController;
