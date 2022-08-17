import React, { useEffect, useState } from "react";
import RenderGLB from "./RenderGLB";
import RenderOtherUser from "./RenderOtherUser";
import { Html } from "@react-three/drei";
import { useUserPositionStore } from "../../store";

const RenderOnlineUsers = (props) => {
  const [chatMessages, setChatMessages] = useState<any>({});
  const userPositions = useUserPositionStore(
    (state: any) => state.userPositions
  );
  const userConnectionId = useUserPositionStore(
    (state: any) => state.userConnectionId
  );


  const onNewMessage = (data) => {
    setChatMessages({ ...chatMessages, [data.senderId]: data });
    setTimeout(() => {
      setChatMessages(
        ({ [data.senderId]: value, ...otherMessages }) => otherMessages
      );
    }, 8000);
  };
  
  useEffect(() => {
    console.log(userPositions, "userPositions");
  }, [userPositions])

  return (
    <>
      {Object.keys(userPositions).map((playerKey) => {
        if (playerKey == userConnectionId) return;
        const { x, y, z } = userPositions[playerKey].position;
        const { _x, _y, _z } = userPositions[playerKey].rotation;
        const { x: rX, y: rY, z: rZ } = userPositions[playerKey].restPosition;
        return (
          <group key={playerKey}>
            {chatMessages[playerKey] && (
              <Html
                center
                position={[x, y + 2, z]}
                className="player-chat-bubble"
              >
                {chatMessages[playerKey].message}
              </Html>
            )}
            <RenderOtherUser
              position={[x, y, z]}
              rotation={[_x, _y, _z]}
              restPosition={[rX, rY, rZ]}
            />
          </group>
        );
      })}
    </>
  );
};

export default RenderOnlineUsers;
