import React, { useEffect, useRef, useState } from 'react';
import { useQuickUseBarStore, useUserStateStore, useWebsocketStore, useInventoryStore, useChatStore } from '../store';
import QuickUseSlot from './QuickUseSlot';

const QuickUseBar: React.FC = () => {
  const quickUseBarRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Store states
  const { 
    isVisible, 
    position, 
    quickUseSlots, 
    setPosition, 
    setQuickUseSlot, 
    clearQuickUseSlot, 
    toggleVisibility,
    initializePosition 
  } = useQuickUseBarStore();
  
  const health = useUserStateStore((state) => state.health);
  const maxHealth = useUserStateStore((state) => state.maxHealth);
  const websocketConnection = useWebsocketStore((state) => state.websocketConnection);
  const items = useInventoryStore((state) => state.items);
  const focusedChat = useChatStore((state) => state.focusedChat);

  // Initialize position from localStorage on mount
  useEffect(() => {
    initializePosition();
  }, [initializePosition]);

  // Sync quick-use slots with inventory changes
  useEffect(() => {
    // Check if any quick-use slot items no longer exist in inventory
    quickUseSlots.forEach((slotItem, index) => {
      if (slotItem) {
        const stillExists = items.find(invItem => 
          invItem.id === slotItem.id && 
          invItem.type === slotItem.type && 
          invItem.subType === slotItem.subType
        );
        
        if (!stillExists) {
          clearQuickUseSlot(index);
        } else if (stillExists.quantity !== slotItem.quantity) {
          // Update quantity if it changed
          setQuickUseSlot(index, stillExists);
        }
      }
    });
  }, [items, quickUseSlots, clearQuickUseSlot, setQuickUseSlot]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (focusedChat) return; // Don't handle shortcuts when chat is focused
      
      // Toggle quick use bar visibility with 'Ctrl+H'
      if (e.key === 'h' && e.ctrlKey) {
        e.preventDefault();
        toggleVisibility();
        return;
      }
      
      // Quick use slots with number keys 1, 2, 3
      if (e.key >= '1' && e.key <= '3') {
        e.preventDefault();
        const slotIndex = parseInt(e.key) - 1;
        const item = quickUseSlots[slotIndex];
        if (item && item.type === 'berry') {
          consumeBerry(item);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleVisibility, focusedChat, quickUseSlots]);

  // Mouse and touch drag handlers
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.target === quickUseBarRef.current || (e.target as HTMLElement).classList.contains('quick-use-bar-header')) {
      setIsDragging(true);
      const rect = quickUseBarRef.current?.getBoundingClientRect();
      if (rect) {
        const clientX = e.clientX;
        const clientY = e.clientY;
        setDragOffset({
          x: clientX - rect.left,
          y: clientY - rect.top
        });
      }
      e.preventDefault(); // Prevent text selection
    }
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (isDragging) {
      const clientX = e.clientX;
      const clientY = e.clientY;
      const maxWidth = window.innerWidth - 200; // Account for component width
      const maxHeight = window.innerHeight - 80; // Account for component height
      
      const newX = Math.max(0, Math.min(maxWidth, clientX - dragOffset.x));
      const newY = Math.max(0, Math.min(maxHeight, clientY - dragOffset.y));
      setPosition({ x: newX, y: newY });
    }
  };

  const handlePointerUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', handlePointerUp);
      return () => {
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerUp);
      };
    }
  }, [isDragging, dragOffset]);

  // Berry consumption logic (reused from original HUD)
  const consumeBerry = (item: any) => {
    if (!item || item.type !== 'berry') return;

    if (health >= maxHealth) {
      console.log("Health is already full, cannot consume berry");
      return;
    }

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

  // Handle item drop on quick-use slot
  const handleSlotDrop = (slotIndex: number, item: any) => {
    // Check if item exists in inventory
    const inventoryItem = items.find(invItem => 
      invItem.type === item.type && 
      invItem.subType === item.subType &&
      invItem.id === item.id
    );
    
    if (inventoryItem) {
      setQuickUseSlot(slotIndex, inventoryItem);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  if (!isVisible) {
    return (
      <button
        className="quick-use-bar-toggle-button"
        onClick={toggleVisibility}
        style={{
          position: 'fixed',
          top: '50px',
          left: '10px',
          zIndex: 1000,
          padding: '6px 10px',
          background: 'rgba(0, 0, 0, 0.7)',
          color: 'white',
          border: '1px solid #555',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '11px',
          minHeight: '32px',
          minWidth: '60px'
        }}
        title="Show Quick Use Bar (Ctrl+H)"
      >
        Items
      </button>
    );
  }

  return (
    <div
      ref={quickUseBarRef}
      className="quick-use-bar-container"
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        zIndex: 1000,
        background: 'rgba(0, 0, 0, 0.8)',
        border: '2px solid #444',
        borderRadius: '8px',
        padding: '8px 12px',
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        pointerEvents: 'all',
        touchAction: 'none' // Prevent default touch behaviors
      }}
      onPointerDown={handlePointerDown}
    >
      {/* Header with close button */}
      <div 
        className="quick-use-bar-header" 
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '6px',
          color: 'white',
          fontSize: '11px',
          fontWeight: 'bold'
        }}
      >
        <span>Quick Use</span>
        <button
          onClick={toggleVisibility}
          style={{
            background: 'none',
            border: 'none',
            color: 'white',
            cursor: 'pointer',
            fontSize: '12px',
            padding: '2px 4px',
            minHeight: '20px',
            minWidth: '20px'
          }}
          title="Hide Quick Use Bar (Ctrl+H)"
        >
          ×
        </button>
      </div>

      {/* Quick Use Slots */}
      <div style={{
        display: 'flex',
        gap: '6px',
        marginBottom: '4px'
      }}>
        {quickUseSlots.map((item, index) => (
          <QuickUseSlot
            key={index}
            item={item}
            slotIndex={index}
            onItemUse={consumeBerry}
            onDrop={handleSlotDrop}
            onDragOver={handleDragOver}
          />
        ))}
      </div>

      {/* Instructions */}
      <div style={{
        color: '#aaa',
        fontSize: '8px',
        textAlign: 'center'
      }}>
        1,2,3 to use • Ctrl+H to toggle
      </div>
    </div>
  );
};

export default QuickUseBar;
