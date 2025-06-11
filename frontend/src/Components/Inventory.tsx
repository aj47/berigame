import React, { memo, useEffect, useState } from "react";
import {
  useChatStore,
  useInventoryStore,
  useEquipmentStore,
  ItemType,
  EquipmentSlot
} from "../store";

type InventoryProps = {
  setShowInventory: React.Dispatch<React.SetStateAction<boolean>>;
  showInventory: boolean;
};

const Inventory = memo((props: InventoryProps) => {
  const [showInventory, setShowInventory] = useState(false);
  const focusedChat = useChatStore((state) => state.focusedChat);

  // Inventory and equipment stores
  const items = useInventoryStore((state) => state.items);
  const equipItem = useEquipmentStore((state) => state.equipItem);
  const unequipItem = useEquipmentStore((state) => state.unequipItem);
  const isItemEquipped = useEquipmentStore((state) => state.isItemEquipped);
  const keyDownHandler = (e) => {
    if (e.keyCode === 73 && !focusedChat) {
      setShowInventory(!showInventory);
    }
  };

  const handleItemClick = (item) => {
    if (item.type === ItemType.SWORD) {
      if (isItemEquipped(item.id)) {
        // Unequip the sword
        unequipItem(EquipmentSlot.WEAPON);
        console.log("Sword unequipped");
      } else {
        // Equip the sword
        equipItem(EquipmentSlot.WEAPON, item.id);
        console.log("Sword equipped");
      }
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
      <button className="ui-element"
        onClick={() => {
          setShowInventory(!showInventory);
        }}
      >
        {!showInventory ? "Inventory" : "Close Inventory"}
      </button>
      {showInventory && (
        <div
          className="inventory ui-element"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gridTemplateRows: "repeat(7, 1fr)",
            gap: "10px",
          }}
        >
          {/* Render actual inventory items */}
          {items.map((item, index) => (
            <div
              key={item.id}
              className="inventory-item"
              onClick={() => handleItemClick(item)}
              style={{
                width: "30px",
                height: "30px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: isItemEquipped(item.id) ? "#4CAF50" : "#333",
                border: isItemEquipped(item.id) ? "2px solid #8BC34A" : "1px solid #666",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "16px",
                color: "white",
                position: "relative",
              pointerEvents: "all",
              }}
              title={`${item.name}${isItemEquipped(item.id) ? " (Equipped)" : ""}`}
            >
              {item.icon}
              {isItemEquipped(item.id) && (
                <div
                  style={{
                    position: "absolute",
                    top: "-2px",
                    right: "-2px",
                    width: "8px",
                    height: "8px",
                    backgroundColor: "#4CAF50",
                    borderRadius: "50%",
                    border: "1px solid white",
                  }}
                />
              )}
            </div>
          ))}

          {/* Fill remaining slots with empty placeholders */}
          {Array(28 - items.length)
            .fill(0)
            .map((_, i) => (
              <div
                key={`empty-${i}`}
                style={{
                  width: "30px",
                  height: "30px",
                  backgroundColor: "#222",
                  border: "1px solid #444",
                  borderRadius: "4px",
                }}
              />
            ))}
        </div>
      )}
    </>
  );
});

export default Inventory;
