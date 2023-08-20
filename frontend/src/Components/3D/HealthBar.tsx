import { Html } from "@react-three/drei";
import React, { useEffect, useState } from "react";
import { Vector3 } from "three";

const HealthBar = (props) => {
  const [showHealth, setShowHealth] = useState(false);
  const [lastHealthChange, setLastHealthChange] = useState(Date.now());
  const position = new Vector3(
    props.playerPosition.x,
    props.playerPosition.y + props.yOffset,
    props.playerPosition.z
  );

  //Only shows health bar if health has changed in the last 15 seconds
  useEffect(() => {
    const healthChangeTimeout = setTimeout(() => {
      if (Date.now() - lastHealthChange >= 5000) {
        setShowHealth(false);
      }
    }, 5000);
    return () => {
      clearTimeout(healthChangeTimeout);
    };
  }, [props.health, lastHealthChange]);

  useEffect(() => {
    setShowHealth(true);
    setLastHealthChange(Date.now());
  }, [props.health]);

  if (showHealth)
    return (
      <Html
        zIndexRange={[4, 0]}
        prepend
        center
        position={position}
        className="health-bar"
      >
        <div
          className="fill"
          style={{ width: (props.health / props.maxHealth) * 100 + "%" }}
        ></div>
      </Html>
    );
};

export default HealthBar;
