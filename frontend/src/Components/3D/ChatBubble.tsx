import { Html } from "@react-three/drei";
import React from "react";
import { Vector3 } from "three";

const ChatBubble = (props) => {
  const offsetPosition = new Vector3(
    props.playerPosition.x,
    props.playerPosition.y + props.yOffset,
    props.playerPosition.z
  );
  return (
    <Html
      zIndexRange={[4, 0]}
      center
      style={{ transform: 'translate(-50%, -100%)', pointerEvents: 'none' }}
      position={offsetPosition}
      className="player-chat-bubble"
    >
      {props.chatMessage}
    </Html>
  );
};

export default ChatBubble;
