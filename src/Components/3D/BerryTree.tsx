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
    setClickedOtherObject({ ...objRef, isCombatable, connectionId, e });
    // setTimeout(() => {
    //   clearMaterialChange();
    // }, 150);
  };

  return <RenderGLB ref={useRef} url={"/tree.glb"} position={[5, 0, 0]} />;
};

export default BerryTree;
