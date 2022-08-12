import React, { useEffect, useState } from "react";
import { getClientConnectionId, setSetUserPositions } from "../../Api";
import RenderGLB from "./RenderGLB";
import RenderOtherUser from "./RenderOtherUser";
import { setOnNewMessage } from "../../Api";
import { Html } from "@react-three/drei";

const RenderOnlineUsers = (props) => {
  const [userPositions, setUserPositions] = useState<any[]>([]);
  const [clientConnectionId, setClientConnectionId] = useState<null | string>(
    null
  );
  const [chatMessages, setChatMessages] = useState<any>({});

  // TODO IMPROVEMENT:
  // this method should probably be done without timeout
  const getUserConnectionId = () => {
    const connId = getClientConnectionId();
    if (connId) setClientConnectionId(connId);
    else setTimeout(getUserConnectionId, 250);
  };

  const updateUserPositions = (data) => {
    setUserPositions({ ...data });
  };

  const onNewMessage = (data) => {
    setChatMessages({ ...chatMessages, [data.senderId]: data });
		setTimeout(() => {
			setChatMessages(({[data.senderId]: value, ...otherMessages}) =>  otherMessages);
		}, 8000)
  };
  setOnNewMessage(onNewMessage);

  useEffect(() => {
    getUserConnectionId();
    setSetUserPositions(updateUserPositions);
  }, []);

	console.log("test");
  return (
    <>
      {Object.keys(userPositions).map((playerKey) => {
        if (playerKey == clientConnectionId) return;
        const { x, y, z } = userPositions[playerKey].position;
        const { _x, _y, _z } = userPositions[playerKey].rotation;
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
            <RenderOtherUser position={[x, y, z]} rotation={[_x, _y, _z]} />
          </group>
        );
      })}
    </>
  );
};

export default RenderOnlineUsers;
