import React, { memo } from "react";
import ChatBox from "./ChatBox";
import Inventory from "./Inventory";

const UIComponents = memo((props) => {
  return (
    <>
      <ChatBox/>
      <Inventory />
    </>
  );
});

export default UIComponents;
