import React, { memo, useEffect, useState } from "react";

const Inventory = memo((props) => {
  const [showInventory, setShowInventory] = useState(false);

  const keyDownHandler = (e) => {
    if (e.keyCode === 73) {
      console.log(showInventory, "showInventory");
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
        <div style={{ width: 50, height: 50, backgroundColor: "red" }}>+++</div>
      )}
    </>
  );
});

export default Inventory;
