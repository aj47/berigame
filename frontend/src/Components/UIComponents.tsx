import React, { memo, useState } from "react";
import ChatBox from "./ChatBox";
import Inventory from "./Inventory";

const UIComponents = memo((props) => {
const [showInventory, setShowInventory] = useState(false);
  return (
    <div className="ui-group">
      <ChatBox/>
      <Inventory setShowInventory={setShowInventory} showInventory={showInventory}/>
    </div>
  );
});

export default UIComponents;
