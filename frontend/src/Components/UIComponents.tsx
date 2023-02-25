import React, { memo } from "react";
import ChatBox from "./ChatBox";
import Inventory from "./Inventory";

const UIComponents = memo((props) => {
  return (
    <>
      <ChatBox setChatMessageSent={() => {}} />
      <Inventory />
    </>
  );
});

export default UIComponents;
