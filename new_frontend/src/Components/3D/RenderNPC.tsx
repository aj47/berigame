import { useAnimations, useGLTF } from "@react-three/drei";
import { useGraph } from "@react-three/fiber";
import React, { Suspense, useEffect, useMemo, useState } from "react";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils";
import RenderOtherUser from "./RenderOtherUser";

const RenderNPC = (props) => {
  const [restPosition, setRestPosition] = useState([1, 0, 0]);
  const [position, setPosition] = useState([1, 0, 0]);
  const [isWalking, setIsWalking] = useState(false);
  const [messageToRender, setMessageToRender] = useState("");

  const isSameCoordinates = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const walkRandom = () => {
    setIsWalking(true);
    const r = Math.floor(Math.random() * 5);
    let newRestPosition: any = null;
    if (r === 0) newRestPosition = [12, 0, 2];
    else if (r === 1) newRestPosition = [-4, 0, 4];
    else if (r === 2) newRestPosition = [6, 0, -1];
    else if (r === 3) newRestPosition = [7, 0, 7];
    else newRestPosition = [-1, 0, -2];
    if (isSameCoordinates(restPosition, newRestPosition))
      setTimeout(walkRandom, 2000);
    else {
      setRestPosition(newRestPosition);
    }
  };
  
  const talkRandom = () => {
    const r = Math.floor(Math.random() * 5);
    let newText: any = null;
    if (r === 0) newText = "Hello! Welcome to the cubespaced alpha!";
    else if (r === 1) newText = "I am the first NPC ever created in this metaverse";
    else if (r === 2) newText = "I can't wait until i have more friends to play with!";
    else if (r === 2) newText = "sign up at cubespaced.com for whitelist!";
    else newText = "";
    setMessageToRender(newText);
    setTimeout(talkRandom, 8000);
  }

  //npc ai
  useEffect(() => {
    setTimeout(talkRandom, 8000);
    const timeout = setTimeout(walkRandom, 5000);
    return () => {
      clearTimeout(timeout);
    };
  }, [restPosition]);
  
  
  return (
    <group>
      <RenderOtherUser
        url="native-woman.glb"
        messagesToRender={messageToRender}
        position={position}
        restPosition={restPosition}
        isWalking={isWalking}
        rotation={[0,0,0]}
      />
    </group>
  );
};

export default RenderNPC;
