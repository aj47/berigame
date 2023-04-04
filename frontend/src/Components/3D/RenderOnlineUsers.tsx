import React, { useEffect, useState } from "react";
import RenderOtherUser from "./RenderOtherUser";
import { useChatStore, useOtherUsersStore, useUserStateStore } from "../../store";

const RenderOnlineUsers = (props) => {
  const [messagesToRender, setMessagesToRender] = useState<any>({});
  const chatMessages = useChatStore((state: any) => state.chatMessages);
  const userPositions = useOtherUsersStore((state: any) => state.userPositions);
  const userConnectionId = useUserStateStore(
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
        const currentPlayer = userPositions[playerKey];
        const { x, y, z } = currentPlayer.position;
        const { _x, _y, _z } = currentPlayer.rotation;
        const { x: rX, y: rY, z: rZ } = currentPlayer.restPosition;
        return (
          <group key={playerKey}>
            <RenderOtherUser
              isAttacking={currentPlayer.attackingPlayer}
              connectionId={playerKey}
              isCombatable={true}
              messagesToRender={messagesToRender[playerKey]?.message}
              position={[x, y, z]}
              rotation={[_x, _y, _z]}
              restPosition={[rX, rY, rZ]}
              isWalking={currentPlayer.isWalking}
            />
          </group>
        );
      })}
    </>
  );
};

export default RenderOnlineUsers;
