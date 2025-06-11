import { Html, useAnimations, useGLTF } from "@react-three/drei";
import TWEEN from "@tweenjs/tween.js";
import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useGraph } from "@react-three/fiber";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils";
import {
  BoxBufferGeometry,
  BoxGeometry,
  MeshBasicMaterial,
  Vector3,
} from "three";
import {
  useOtherUsersStore,
  useUserInputStore,
  useUserStateStore,
} from "../../store";
import ChatBubble from "./ChatBubble";
import HealthBar from "./HealthBar";
import DamageNumber from "./DamageNumber";

const RenderOtherUser = ({
  url = "native-woman.glb",
  position,
  rotation,
  restPosition,
  isWalking,
  messagesToRender,
  isCombatable = false,
  inCombat = false,
  isAttacking = false,
  connectionId = "NPC",
}) => {
  const { scene, animations, materials } = useGLTF(url);
  const clone = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { nodes } = useGraph(clone);
  const copiedScene = nodes.Scene;
  const { actions, mixer } = useAnimations(animations, copiedScene);
  const [currentTween, setCurrentTween] = useState(null);
  const objRef = useRef();
  const hitBox = new BoxGeometry(1, 5.5, 1);
  const hitBoxMaterial = new MeshBasicMaterial({ visible: false });
  const setClickedOtherObject = useUserInputStore(
    (state) => state.setClickedOtherObject
  );
  const setUserFollowing = useUserStateStore((state) => state.setUserFollowing);
  const setUserAttacking = useUserStateStore((state) => state.setUserAttacking);
  const damageToRender = useOtherUsersStore((state) => state.damageToRender);
  const removeDamageToRender = useOtherUsersStore(
    (state) => state.removeDamageToRender
  );
  const playerHealths = useOtherUsersStore((state) => state.playerHealths);
  const setPlayerHealth = useOtherUsersStore((state) => state.setPlayerHealth);

  const [localHealth, setLocalHealth] = useState(30);
  const [currentDamage, setCurrentDamage] = useState(null);

  // Use centralized health if available, otherwise use local health
  const currentHealth = playerHealths[connectionId] !== undefined ? playerHealths[connectionId] : localHealth;

  useEffect(() => {
    // Check expired damage number
    if (currentDamage?.timestamp < Date.now() - 1400) setCurrentDamage(null);
  });

  useEffect(() => {
    const userDamage = damageToRender[connectionId];
    if (userDamage) {
      const newHealth = currentHealth - userDamage;
      setLocalHealth(newHealth);
      setPlayerHealth(connectionId, newHealth);
      setCurrentDamage({ val: userDamage, timestamp: Date.now() });
      removeDamageToRender(connectionId);

      // Check for death (visual feedback only - backend handles the actual death logic)
      if (newHealth <= 0) {
        console.log(`Other player ${connectionId} appears to have died`);
        // Stop animations for dead player
        actions["Walk"]?.stop();
        actions["RightHook"]?.stop();
        actions["Idle"]?.stop();
      }
    }
  }, [damageToRender]);

  // Update local health when centralized health changes (e.g., on respawn)
  useEffect(() => {
    if (playerHealths[connectionId] !== undefined) {
      setLocalHealth(playerHealths[connectionId]);

      // If player respawned (health restored), restart idle animation
      if (playerHealths[connectionId] > 0) {
        actions["Idle"]?.play();
      }
    }
  }, [playerHealths[connectionId]]);

  useEffect(() => {
    if (isAttacking) {
      actions["Idle"]?.stop();
      actions["RightHook"]?.play();
    }
  }, [isAttacking]);

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
    setClickedOtherObject({
      ...objRef,
      isCombatable,
      connectionId,
      e,
      dropdownOptions: [
        {
          label: "Follow",
          onClick: () => {
            setUserFollowing(objRef);
            setUserAttacking(false);
            setClickedOtherObject(null);
          },
        },
        {
          label: "Attack",
          onClick: () => {
            setUserFollowing(objRef);
            setUserAttacking(connectionId);
            setClickedOtherObject(null);
          },
        },
      ],
    });
    setTimeout(() => {
      clearMaterialChange();
    }, 150);
  };

  return (
    <group ref={objRef} onClick={onClick}>
      <mesh geometry={hitBox} material={hitBoxMaterial} />
      {connectionId !== "NPC" && (
        <>
          <HealthBar
            playerPosition={copiedScene.position}
            health={Math.max(0, currentHealth)}
            maxHealth={30}
            yOffset={2.5}
          />
          {currentDamage && (
            <DamageNumber
              key={currentDamage.timestamp}
              playerPosition={copiedScene.position}
              yOffset={1.5}
              damageToRender={currentDamage.val}
            />
          )}
          {currentHealth <= 0 && (
            <ChatBubble
              playerPosition={copiedScene.position}
              yOffset={3.5}
              chatMessage="💀 DEAD"
            />
          )}
        </>
      )}
      {messagesToRender && (
        <ChatBubble
          playerPosition={copiedScene.position}
          yOffset={3.2}
          chatMessage={messagesToRender}
        />
      )}
      <Suspense fallback={null}>
        <primitive object={copiedScene} rotation={rotation} />
      </Suspense>
    </group>
  );
};

export default RenderOtherUser;
