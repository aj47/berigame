import React, { memo, useEffect, useState } from "react";
import { useChatStore, useInventoryStore, useUserStateStore, useWebsocketStore } from "../store";

type InventoryProps = {
  setShowInventory: React.Dispatch<React.SetStateAction<boolean>>;
  showInventory: boolean;
};

const Inventory = memo((props: InventoryProps) => {
  const [showInventory, setShowInventory] = useState(false);
  const focusedChat = useChatStore((state) => state.focusedChat);
  const items = useInventoryStore((state) => state.items);

  const health = useUserStateStore((state) => state.health);
  const maxHealth = useUserStateStore((state) => state.maxHealth);
  const websocketConnection = useWebsocketStore((state) => state.websocketConnection);


  const keyDownHandler = (e) => {
    if (e.keyCode === 73 && !focusedChat) {
      setShowInventory(!showInventory);
    }
  };

  const consumeBerry = (item) => {
    if (!item || item.type !== 'berry') return;

    // Check if player can benefit from healing
    if (health >= maxHealth) {
      console.log("Health is already full, cannot consume berry");
      return;
    }

    // Send consumption request to backend
    if (websocketConnection && websocketConnection.readyState === WebSocket.OPEN) {
      const payload = {
        action: "consumeBerry",
        chatRoomId: "CHATROOM#913a9780-ff43-11eb-aa45-277d189232f4",
        berryType: item.subType,
        itemId: item.id
      };
      websocketConnection.send(JSON.stringify(payload));
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
            maxWidth: "300px",
            maxHeight: "400px",
            padding: "10px",
            background: "rgba(0, 0, 0, 0.8)",
            border: "1px solid #333",
            borderRadius: "8px",
            pointerEvents: 'all'
          }}
        >
          {Array(28)
            .fill(0)
            .map((_, i) => {
              const item = items[i];
              return (
                <div
                  key={i}
                  draggable={item && item.type === 'berry'}
                  onDragStart={(e) => {
                    if (item && item.type === 'berry') {
                      e.dataTransfer.setData('application/json', JSON.stringify(item));
                    }
                  }}
                  style={{
                    width: "40px",
                    height: "40px",
                    border: "1px solid #555",
                    borderRadius: "4px",
                    background: item ? "rgba(76, 175, 80, 0.2)" : "rgba(255, 255, 255, 0.1)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    position: "relative",
                    cursor: item ? (item.type === 'berry' ? "grab" : "pointer") : "default",
                  }}
                  title={item ? `${item.name} (${item.quantity || 1})${item.type === 'berry' ? ' - Click to eat or drag to HUD' : ''}` : "Empty slot"}
                  onClick={() => item && item.type === 'berry' && consumeBerry(item)}
                >
                  {item && (
                    <>
                      <img
                        src={item.icon || "/berry.svg"}
                        alt={item.name}
                        style={{
                          width: "24px",
                          height: "24px"
                        }}
                      />
                      {(item.quantity || 1) > 1 && (
                        <div style={{
                          position: "absolute",
                          bottom: "2px",
                          right: "2px",
                          fontSize: "10px",
                          color: "white",
                          background: "rgba(0, 0, 0, 0.7)",
                          borderRadius: "2px",
                          padding: "1px 3px",
                          minWidth: "12px",
                          textAlign: "center"
                        }}>
                          {item.quantity || 1}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
        </div>
      )}
    </>
  );
});

export default Inventory;
