import React, { useRef } from "react";
import {
  useUserInputStore,
  useUserStateStore,
} from "../../store";
import RenderGLB from "./RenderGLB";

const BerryTree = (props) => {
  const objRef = useRef(null);
  const setClickedOtherObject = useUserInputStore(
    (state) => state.setClickedOtherObject,
  );
  const setUserFollowing = useUserStateStore((state) => state.setUserFollowing);
  const setUserHarvesting = useUserStateStore((state) => state.setUserHarvesting);
  const onClick = (e) => {
    e.stopPropagation();
    // materialChange();
    setClickedOtherObject({
      ...objRef,
      isCombatable: false,
      connectionId: "TREE",
      e,
      dropdownOptions: [
        {
          label: "Harvest",
          onClick: () => {
            setUserFollowing(objRef);
            setUserHarvesting(objRef);
            setClickedOtherObject(null);
          },
        },
      ],
    });
    // setTimeout(() => {
    //   clearMaterialChange();
    // }, 150);
  };

  return (
    <RenderGLB
      onClick={onClick}
      objRef={objRef}
      url={"/tree.glb"}
      position={props.position || [5, 0, 0]}
    />
  );
};

export default BerryTree;
