import { Html } from "@react-three/drei";
import React from "react";
import { Vector3 } from "three";

const HealthBar = (props) => {
  const position = new Vector3(
    props.playerPosition.x,
    props.playerPosition.y + props.yOffset,
    props.playerPosition.z
  );

  return (
    <Html
      zIndexRange={[4, 0]}
      prepend
      center
      position={position}
      className="health-bar"
    >
      <div className="fill" style={{ width: props.health + "%" }}></div>
    </Html>
  );
};

export default HealthBar;
