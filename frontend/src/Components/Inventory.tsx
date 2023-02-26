import React, { memo, useEffect, useState } from "react";

const Inventory = memo((props) => {
  const [showInventory, setShowInventory] = useState(false);

  const keyDownHandler = (e) => {
    if (e.keyCode === 73) {
      setShowInventory(!showInventory);
    }
  };

  useEffect(() => {
    window.addEventListener("keydown", keyDownHandler, false);
    return () => {
      window.removeEventListener("keydown", keyDownHandler);
    };
  }, [showInventory]);
  
  return (
    <>
      {showInventory && (
        <div className="inventory ui-window">+++</div>
      )}
    </>
  );
});

export default Inventory;
