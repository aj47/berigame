import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { INVENTORY_SIZE, getItemDef, type Slot } from '@sim';
import { useGameActions } from '../spacetime/actions';
import { useInventoryRows } from '../spacetime/hooks';
import { useChatStore, useInventoryUiStore } from '../store';

const DRAG_THRESHOLD_MS = 200; // hold this long before a drag starts; shorter is a click (eat)

const Inventory = memo(() => {
  const [showInventory, setShowInventory] = useState(false);
  const mouseDownTimeRef = useRef<number | null>(null);
  const focusedChat = useChatStore((s) => s.focusedChat);
  const rows = useInventoryRows();
  const { draggedFromSlot, dragOverSlot, setDraggedFromSlot, setDragOverSlot, clearDragState } = useInventoryUiStore();
  const { eatBerry, moveItem, dropItem } = useGameActions();

  const slots = useMemo<Slot[]>(() => {
    const out: Slot[] = Array(INVENTORY_SIZE).fill(null);
    for (const r of rows) if (r.slot < INVENTORY_SIZE) out[r.slot] = { itemId: r.itemId, quantity: r.quantity };
    return out;
  }, [rows]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'i' && !focusedChat) setShowInventory((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusedChat]);

  const dropOutside = (fromSlot: number) => {
    const item = slots[fromSlot];
    if (item) dropItem(fromSlot, item.quantity);
  };

  const handleClick = (e: React.MouseEvent, slotIndex: number) => {
    const item = slots[slotIndex];
    if (!item || !mouseDownTimeRef.current) return;
    const held = Date.now() - mouseDownTimeRef.current;
    mouseDownTimeRef.current = null;
    if (held >= DRAG_THRESHOLD_MS) return;
    e.stopPropagation();
    const def = getItemDef(item.itemId);
    if (def && def.healthRestore > 0) eatBerry(slotIndex);
  };

  const handleDragStart = (e: React.DragEvent, slotIndex: number) => {
    const held = mouseDownTimeRef.current ? Date.now() - mouseDownTimeRef.current : 0;
    if (held < DRAG_THRESHOLD_MS) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
    setDraggedFromSlot(slotIndex);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    if (draggedFromSlot !== null) {
      const inventoryElement = (e.currentTarget as HTMLElement).closest('.inventory');
      if (inventoryElement) {
        const rect = inventoryElement.getBoundingClientRect();
        const outside = e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
        if (outside) dropOutside(draggedFromSlot);
      }
    }
    clearDragState();
    mouseDownTimeRef.current = null;
  };

  const handleDrop = (e: React.DragEvent, toSlot: number) => {
    e.preventDefault();
    if (draggedFromSlot !== null && draggedFromSlot !== toSlot) moveItem(draggedFromSlot, toSlot);
    clearDragState();
  };

  return (
    <>
      <button className="ui-element" onClick={() => setShowInventory(!showInventory)}>
        {!showInventory ? 'Inventory' : 'Close Inventory'}
      </button>
      {showInventory && (
        <div className="inventory ui-element">
          {slots.map((item, i) => {
            const def = item ? getItemDef(item.itemId) : undefined;
            const isDragOver = dragOverSlot === i;
            const isDragging = draggedFromSlot === i;
            return (
              <div
                key={i}
                className={`inventory-slot ${isDragOver ? 'over' : ''} ${item ? 'filled' : ''} ${isDragging ? 'dragging' : ''}`}
                draggable={!!item}
                onMouseDown={() => { if (item) mouseDownTimeRef.current = Date.now(); }}
                onClick={(e) => handleClick(e, i)}
                onDragStart={(e) => handleDragStart(e, i)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverSlot(i); }}
                onDragLeave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDragOverSlot(null); }}
                onDrop={(e) => handleDrop(e, i)}
                title={item ? `${def?.name ?? item.itemId} (${item.quantity}) - click to eat, hold to drag, drag outside to drop` : 'Empty slot'}
              >
                {item && (
                  <>
                    <img src={def?.icon ?? '/berry.svg'} alt={def?.name ?? item.itemId} draggable={false} />
                    {item.quantity > 1 && <div className="qty">{item.quantity}</div>}
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
