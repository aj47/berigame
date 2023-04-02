import React, { memo } from "react";
import ChatBox from "./ChatBox";
import Inventory from "./Inventory";
import Landing from "./Landing";

const UIComponents = memo((props) => {
  return (
    <>
      <Landing/>
      <ChatBox/>
      <Inventory />
    </>
  );
});

export default UIComponents;
