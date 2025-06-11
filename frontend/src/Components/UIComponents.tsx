import React, { memo, useState } from "react";
import ChatBox from "./ChatBox";
import Inventory from "./Inventory";
import Modal from "./Modal";
import SkillsUI from "./SkillsUI";

const UIComponents = memo((props) => {
  const [showInventory, setShowInventory] = useState(false);
  return (
    <div className="ui-group">
      {/* <Modal /> */}
      <ChatBox />
      <Inventory
        setShowInventory={setShowInventory}
        showInventory={showInventory}
      />
      <SkillsUI />
    </div>
  );
});

export default UIComponents;
