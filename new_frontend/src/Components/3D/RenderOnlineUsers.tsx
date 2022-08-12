import React, { useEffect, useState } from "react";
import { getClientConnectionId, setSetUserPositions } from "../../Api";
import RenderGLB from "./RenderGLB";
import RenderOtherUser from "./RenderOtherUser";

const RenderOnlineUsers = (props) => {
  const [userPositions, setUserPositions] = useState<any[]>([]);
	const [clientConnectionId, setClientConnectionId] = useState<null | string>(null);
	
	// TODO IMPROVEMENT:
	// this method should probably be done without timeout
	const getUserConnectionId = () => {
		const connId = getClientConnectionId();
		if (connId)
			setClientConnectionId(connId);
		else
			setTimeout(getUserConnectionId, 250);
	}
	
	const updateUserPositions = (data) => {
		setUserPositions({...data});
	}

	useEffect(() => {
		getUserConnectionId();
		setSetUserPositions(updateUserPositions);
	},[])


  return (
    <>
      {Object.keys(userPositions).map((playerKey) => {
				if (playerKey == clientConnectionId) return;
				const {x,y,z} = userPositions[playerKey].position;
				const {_x, _y, _z} = userPositions[playerKey].rotation;
        return (
          <RenderOtherUser
						key={playerKey}
            position={[x,y,z]}
            rotation={[_x, _y, _z]}
          />
        );
      })}
    </>
  );
};

export default RenderOnlineUsers;
