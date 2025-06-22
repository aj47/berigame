import React, { memo, useState } from "react";
import ChatBox from "./ChatBox";
import Inventory from "./Inventory";
import Modal from "./Modal";
import HealthBar from "./HealthBar";
import QuickUseBar from "./QuickUseBar";

const UIComponents = memo((props) => {
  const [showInventory, setShowInventory] = useState(false);
  return (
    <div className="ui-group">
      {/* <Modal /> */}
      <HealthBar />
      <QuickUseBar />
      <ChatBox />
      <Inventory
        setShowInventory={setShowInventory}
        showInventory={showInventory}
      />
    </div>
  );
});

export default UIComponents;
