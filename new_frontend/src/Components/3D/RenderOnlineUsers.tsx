import React, { useEffect, useState } from "react";
import RenderGLB from "./RenderGLB";
import RenderOtherUser from "./RenderOtherUser";
import { Html } from "@react-three/drei";
import { useChatStore, useUserPositionStore } from "../../store";

const RenderOnlineUsers = (props) => {
  const [messagesToRender, setMessagesToRender] = useState<any>({});
  const chatMessages = useChatStore((state: any) => state.chatMessages);
  const userPositions = useUserPositionStore(
    (state: any) => state.userPositions
  );
  const userConnectionId = useUserPositionStore(
    (state: any) => state.userConnectionId
  );

  const updateMessages = () => {
    const selectedMessage = chatMessages[chatMessages.length - 1];
    setMessagesToRender({
      ...messagesToRender,
      [selectedMessage.senderId]: selectedMessage,
    });
    setTimeout(() => {
      const key: string = selectedMessage.senderId;
      setMessagesToRender(
        ({ [key]: value, ...otherMessages }) => otherMessages
      );
    }, 8000);
  };

  useEffect(() => {
    if (chatMessages.length > 0) updateMessages();
  }, [chatMessages]);

  return (
    <>
      {Object.keys(userPositions).map((playerKey) => {
        if (playerKey == userConnectionId) return;
        const { x, y, z } = userPositions[playerKey].position;
        const { _x, _y, _z } = userPositions[playerKey].rotation;
        const { x: rX, y: rY, z: rZ } = userPositions[playerKey].restPosition;
        return (
          <group key={playerKey}>
            <RenderOtherUser
              messagesToRender={messagesToRender[playerKey]?.message}
              position={[x, y, z]}
              rotation={[_x, _y, _z]}
              restPosition={[rX, rY, rZ]}
              isWalking={userPositions[playerKey].isWalking}
            />
          </group>
        );
      })}
    </>
  );
};

export default RenderOnlineUsers;
