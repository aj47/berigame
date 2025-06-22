import React from 'react';
import { useInventoryStore, useUserStateStore, useWebsocketStore } from '../store';

interface QuickUseSlotProps {
  item: any;
  slotIndex: number;
  onItemUse: (item: any) => void;
  onDrop: (slotIndex: number, item: any) => void;
  onDragOver: (e: React.DragEvent) => void;
}

const QuickUseSlot: React.FC<QuickUseSlotProps> = ({ 
  item, 
  slotIndex, 
  onItemUse, 
  onDrop, 
  onDragOver 
}) => {
  const health = useUserStateStore((state) => state.health);
  const maxHealth = useUserStateStore((state) => state.maxHealth);
  const websocketConnection = useWebsocketStore((state) => state.websocketConnection);

  const handleClick = () => {
    if (item && item.type === 'berry') {
      onItemUse(item);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const draggedItem = JSON.parse(e.dataTransfer.getData('application/json'));
    if (draggedItem && draggedItem.type === 'berry') {
      onDrop(slotIndex, draggedItem);
    }
  };

  const canUseItem = item && item.type === 'berry' && health < maxHealth;

  return (
    <div
      className="quick-use-slot"
      onClick={handleClick}
      onDrop={handleDrop}
      onDragOver={onDragOver}
      style={{
        width: '40px',
        height: '40px',
        border: '2px solid #555',
        borderRadius: '6px',
        background: item 
          ? canUseItem 
            ? 'rgba(76, 175, 80, 0.3)' 
            : 'rgba(128, 128, 128, 0.3)'
          : 'rgba(255, 255, 255, 0.1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        cursor: canUseItem ? 'pointer' : item ? 'not-allowed' : 'default',
        opacity: canUseItem ? 1 : item ? 0.6 : 0.8,
        transition: 'all 0.2s ease',
      }}
      title={
        item 
          ? `${item.name} (${item.quantity || 1})${
              item.type === 'berry' 
                ? canUseItem 
                  ? ' - Click to use' 
                  : ' - Health full'
                : ''
            }`
          : `Quick slot ${slotIndex + 1} - Drag berry here`
      }
    >
      {item && (
        <>
          <img
            src={item.icon || "/berry.svg"}
            alt={item.name}
            style={{
              width: '24px',
              height: '24px',
              pointerEvents: 'none'
            }}
          />
          {(item.quantity || 1) > 1 && (
            <div style={{
              position: 'absolute',
              bottom: '2px',
              right: '2px',
              fontSize: '10px',
              color: 'white',
              background: 'rgba(0, 0, 0, 0.8)',
              borderRadius: '2px',
              padding: '1px 3px',
              minWidth: '12px',
              textAlign: 'center',
              pointerEvents: 'none'
            }}>
              {item.quantity || 1}
            </div>
          )}
        </>
      )}
      
      {/* Slot number indicator */}
      <div style={{
        position: 'absolute',
        top: '-8px',
        left: '-8px',
        width: '16px',
        height: '16px',
        background: 'rgba(0, 0, 0, 0.7)',
        color: 'white',
        fontSize: '10px',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none'
      }}>
        {slotIndex + 1}
      </div>
    </div>
  );
};

export default QuickUseSlot;
