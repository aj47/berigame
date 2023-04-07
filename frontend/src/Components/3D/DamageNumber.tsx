import { Html } from "@react-three/drei";
import React from "react";
import { Vector3 } from "three";

const DamageNumber = (props) => {
  const position = new Vector3(
    props.playerPosition.x,
    props.playerPosition.y + props.yOffset,
    props.playerPosition.z
  );
  const randBool = Math.random() < 0.5;
  return (
    <Html
      zIndexRange={[6, 4]}
      prepend
      center
      position={position}
      className={"damage-number" + (randBool ? " animation1" : " animation2")}
    >
      {props.damageToRender}
    </Html>
  );
};

export default DamageNumber;
