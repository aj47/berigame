import React, { memo, useEffect, useState } from "react";
import { useChatStore } from "../store";
// import kickImage from '../../public/kick.png'; // replace with the actual path to kick.png

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
        <div className="inventory ui-window" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gridTemplateRows: 'repeat(7, 1fr)', gap: '10px' }}>
          {Array(28).fill(0).map((_, i) => (
            <img key={i} src="../../public/kick.png" alt="kick" style={{ width: '30px', height: '30px' }} />
          ))}
        </div>
      )}
    </>
  );
});

export default Inventory;
