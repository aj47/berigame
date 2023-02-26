import React, { memo, useEffect, useState } from "react";
import { useChatStore } from "../store";

const Inventory = memo((props) => {
  const [showInventory, setShowInventory] = useState(false);
  const focusedChat = useChatStore((state) => state.focusedChat);
  const keyDownHandler = (e) => {
    if (e.keyCode === 73 && !focusedChat) {
      setShowInventory(!showInventory);
    }
  };

  useEffect(() => {
    window.addEventListener("keydown", keyDownHandler, false);
    return () => {
      window.removeEventListener("keydown", keyDownHandler);
    };
  }, [showInventory, focusedChat]);
  
  return (
    <>
      {showInventory && (
        <div className="inventory ui-window">+++</div>
      )}
    </>
  );
});

export default Inventory;
