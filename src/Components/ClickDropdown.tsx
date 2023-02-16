import React, { useEffect } from "react";
import { useUserInputStore } from "../store";

const ClickDropdown = (props) => {
  const clickedOtherObject = useUserInputStore(
    (state: any) => state.clickedOtherObject
  );
  const clickedX = clickedOtherObject.e.clientX;
  const clickedY = clickedOtherObject.e.clientY;
  // Used to offset dropdown so it is always in view
  const translateVal =
    (clickedX > window.innerWidth / 2 ? "-100%" : "0") +
    " , " +
    (clickedY > window.innerHeight / 2 ? "-100%" : "0");
  return (
    <div
      className="click-dropdown"
      style={{
        top: clickedOtherObject.e.clientY,
        left: clickedOtherObject.e.clientX,
        transform: `translate(${translateVal})`,
      }}
    >
      ---
    </div>
  );
};

export default ClickDropdown;
