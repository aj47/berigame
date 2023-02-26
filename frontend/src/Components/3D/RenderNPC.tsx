import { useAnimations, useGLTF } from "@react-three/drei";
import { useGraph } from "@react-three/fiber";
import React, { Suspense, useEffect, useMemo, useState } from "react";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils";
import { useChatStore } from "../../store";
import RenderOtherUser from "./RenderOtherUser";

const RenderNPC = (props) => {
  const [restPosition, setRestPosition] = useState([1, 0, 0]);
  const [position, setPosition] = useState([1, 0, 0]);
  const [isWalking, setIsWalking] = useState(false);
  const [messageToRender, setMessageToRender] = useState("");
  const addChatMessage = useChatStore((state: any) => state.addChatMessage);

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
      setTimeout(walkRandom, 8000);
    }
  };

  const talkRandom = () => {
    const r = Math.floor(Math.random() * 11);
    let newText: any = null;src/Components
    if (r === 0) newText = "Hello! Welcome to the berigame alpha!";
    else if (r === 1)
      newText = "I am the first NPC ever created in this metaverse";
    else if (r === 2)
      newText = "I can't wait until i have more friends to play with!";
    else if (r === 4) newText = "hello";
    else if (r === 5) newText = "haha";
    else if (r === 6) newText = "what do you want to see in berigame?";
    // else if (r === 7) newText = "I've heard character creation is next!";
    else if (r === 7) newText = "hehehe";
    else if (r === 8) newText = "I like playing the sims!";
    // else if (r === 3) newText = "sign up at cubespaced.com for whitelist!";
    else newText = "";
    setMessageToRender(newText);
    if (newText)
      addChatMessage({
        message: newText,
        senderId: "XGIatezNSwMCEAI+",
        chatMessage: true,
        timestamp: new Date().getTime(),
      });
    setTimeout(talkRandom, 9000);
  };

  //npc ai
  useEffect(() => {
    walkRandom();
    setTimeout(talkRandom, 9000);
  }, []);

  return (
    <group>
      <RenderOtherUser
        url="giant.glb"
        messagesToRender={messageToRender}
        position={position}
        restPosition={restPosition}
        isWalking={isWalking}
        rotation={[0, 0, 0]}
        isCombatable={props.isCombatable}
      />
    </group>
  );
};

export default RenderNPC;
