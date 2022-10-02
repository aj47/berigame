import { Html } from "@react-three/drei";
import React from "react";
import { Vector3 } from "three";

const HealthBar = (props) => {
  const position = new Vector3(
    props.playerPosition.x,
    props.playerPosition.y + 2,
    props.playerPosition.z
  );

  return <Html center position={position} className="health-bar" >
		<div className="fill" style={{width: props.health+"%"}}></div>
	</Html>;
};

export default HealthBar;
