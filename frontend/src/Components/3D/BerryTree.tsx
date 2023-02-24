import React, { useRef } from "react";
import { useUserInputStore } from "../../store";
import RenderGLB from "./RenderGLB";

const BerryTree = (props) => {
  const objRef = useRef(null);
  const setClickedOtherObject = useUserInputStore(
    (state) => state.setClickedOtherObject
  );
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
            console.log("test");
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
      position={[5, 0, 0]}
    />
  );
};

export default BerryTree;
