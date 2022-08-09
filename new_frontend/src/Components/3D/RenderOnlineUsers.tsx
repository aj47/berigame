import React, { useEffect, useState } from "react";
import { setSetUserPositions } from "../../Api";
import RenderGLB from "./RenderGLB";

const RenderOnlineUsers = (props) => {
  const [userPositions, setUserPositions] = useState<any[]>([]);
	
	useEffect(() => {
		setSetUserPositions(setUserPositions);
	},[])

  return (
    <>
      {Object.keys(userPositions).map((playerKey) => {
				const {x,y,z} = userPositions[playerKey].position;
        return (
          <RenderGLB
						key={playerKey}
            url={"/tree.glb"}
            position={[x,y,z]}
          />
        );
      })}
    </>
  );
};

export default RenderOnlineUsers;
