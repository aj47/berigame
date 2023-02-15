import React, { useEffect } from "react";
import { useUserInputStore } from "../store";

const ClickDropdown = (props) => {
  const clickedOtherObject = useUserInputStore(
    (state: any) => state.clickedOtherObject
  );
  useEffect(() => {
    console.log(clickedOtherObject);
  });
  return (
    <div
      className="click-dropdown"
      style={{
        top: clickedOtherObject.e.clientY,
        left: clickedOtherObject.e.clientX,
      }}
    >
      ---
    </div>
  );
};

export default ClickDropdown;
