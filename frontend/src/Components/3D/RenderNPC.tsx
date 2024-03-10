import { useAnimations, useGLTF } from "@react-three/drei";
import { useGraph } from "@react-three/fiber";
import React, { Suspense, useEffect, useMemo, useState } from "react";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils";
import { useChatStore } from "../../store";
import RenderOtherUser from "./RenderOtherUser";
import { createLLMResponse } from "../../Api";

const RenderNPC = (props) => {
  const [restPosition, setRestPosition] = useState([1, 0, 0]);
  const [position, setPosition] = useState([1, 0, 0]);
  const [isWalking, setIsWalking] = useState(false);
  const [messageToRender, setMessageToRender] = useState("");
  const addChatMessage = useChatStore((state: any) => state.addChatMessage);
  const chatMessages = useChatStore((state) => state.chatMessages);

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

  const talkRandom = async () => {
    // OpenAI Call goes here.
    const response = await createLLMResponse([
      {
        role: "system",
        content: props.systemPrompt,
      },
      { role: "user", content: "hello" },
    ]);
    console.log(response.responseText);
    setMessageToRender(response.responseText);
  };

  const replyToMessage = async (message) => {
    const response = await createLLMResponse([
      {
        role: "system",
        content: props.systemPrompt,
      },
      { role: "user", content: message },
    ]);
    setMessageToRender(response.responseText);
  };

  useEffect(() => {
    if (chatMessages.length > 0)
      replyToMessage(chatMessages.at(-1)?.message);
  }, [chatMessages]);

  useEffect(() => {
    walkRandom();
    // talkRandom();
    // setTimeout(talkRandom, 9000);
  }, []);

  return (
    <group>
      <RenderOtherUser
        url="giant.glb"
        userName={"Big-Giant"}
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
