import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { getItemDef, type Slot } from '@sim';

type Drag = { owner: string; from: number; to: number | null; item: NonNullable<Slot>; x: number; y: number; allowed: boolean };
const useDragState = create<{ drag: Drag | null; moving: boolean }>(() => ({ drag: null, moving: false }));
const THRESHOLD = 7;
const HOLD_MS = 250;

function canMove(slots: readonly Slot[], from: number, to: number) {
  const item = slots[from], target = slots[to];
  return from !== to && !!item && to >= 0 && to < slots.length &&
    (!target || item.itemId !== target.itemId || target.quantity < (getItemDef(item.itemId)?.maxStack ?? 1));
}

/** Shared drop targets let the bag and HUD exchange items using the same server move. */
export function useInventoryDrag({ slots, enabled, onMove, onStart, onError }: {
  slots: readonly Slot[];
  enabled: boolean;
  onMove: (from: number, to: number) => Promise<unknown>;
  onStart?: () => void;
  onError?: () => void;
}) {
  const owner = useId();
  const { drag, moving } = useDragState();
  const latest = useRef({ slots, enabled, onMove, onStart, onError });
  latest.current = { slots, enabled, onMove, onStart, onError };
  const gesture = useRef<{
    pointer: number; from: number; item: NonNullable<Slot>; element: HTMLElement;
    x: number; y: number; startX: number; startY: number; previousY: number;
    touch: boolean; scrolling: boolean; active: boolean; grid: HTMLElement | null;
    timer?: ReturnType<typeof setTimeout>; frame?: number;
  } | null>(null);
  const suppressClick = useRef(false);

  const reset = () => {
    const current = gesture.current;
    gesture.current = null;
    if (current) {
      clearTimeout(current.timer);
      if (current.frame !== undefined) cancelAnimationFrame(current.frame);
      if (current.element.hasPointerCapture?.(current.pointer)) current.element.releasePointerCapture(current.pointer);
    }
    if (useDragState.getState().drag?.owner === owner) useDragState.setState({ drag: null });
  };
  const sameSource = () => {
    const current = gesture.current, item = current && latest.current.slots[current.from];
    return !!current && !!item && item.itemId === current.item.itemId && item.quantity === current.item.quantity;
  };
  const update = () => {
    const current = gesture.current;
    if (!current?.active) return;
    const target = document.elementFromPoint(current.x, current.y)?.closest<HTMLElement>('[data-inventory-slot]');
    const to = target?.dataset.inventoryDropEnabled === 'true' ? Number(target.dataset.inventorySlot) : null;
    useDragState.setState({ drag: { owner, from: current.from, item: current.item, x: current.x, y: current.y,
      to, allowed: to !== null && canMove(latest.current.slots, current.from, to) } });
  };
  const autoScroll = () => {
    const current = gesture.current;
    if (!current?.active) return;
    const grid = document.querySelector<HTMLElement>('[data-inventory-scroll]');
    if (grid) {
      const rect = grid.getBoundingClientRect();
      if (current.x >= rect.left && current.x <= rect.right && current.y >= rect.top && current.y <= rect.bottom) {
        const edge = Math.min(28, rect.height / 3);
        const amount = current.y < rect.top + edge ? -6 * (1 - (current.y - rect.top) / edge)
          : current.y > rect.bottom - edge ? 6 * (1 - (rect.bottom - current.y) / edge) : 0;
        if (amount) { grid.scrollTop += amount; update(); }
      }
    }
    current.frame = requestAnimationFrame(autoScroll);
  };
  const activate = () => {
    const current = gesture.current;
    if (!current || !latest.current.enabled || !sameSource()) { reset(); return; }
    clearTimeout(current.timer);
    current.active = true;
    suppressClick.current = true;
    latest.current.onStart?.();
    update();
    current.frame = requestAnimationFrame(autoScroll);
  };

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointer) return;
      current.x = event.clientX; current.y = event.clientY;
      const distance = Math.hypot(current.x - current.startX, current.y - current.startY);
      if (current.scrolling) {
        if (current.grid) current.grid.scrollTop += current.previousY - current.y;
      } else if (current.active) {
        event.preventDefault(); update();
      } else if (distance >= THRESHOLD) {
        if (current.touch && current.grid) {
          // A swipe scrolls; holding first picks up an item for touch dragging.
          clearTimeout(current.timer); current.scrolling = true; suppressClick.current = true;
          current.grid.scrollTop += current.previousY - current.y;
        } else activate();
      }
      current.previousY = current.y;
    };
    const finish = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointer) return;
      const wasActive = current.active;
      if (wasActive) { current.x = event.clientX; current.y = event.clientY; update(); }
      const drop = useDragState.getState().drag;
      const valid = wasActive && sameSource() && latest.current.enabled && drop?.owner === owner && drop.allowed && drop.to !== null;
      reset();
      if (valid && drop) {
        useDragState.setState({ moving: true });
        void Promise.resolve().then(() => latest.current.onMove(drop.from, drop.to!))
          .catch(() => latest.current.onError?.())
          .finally(() => useDragState.setState({ moving: false }));
      }
    };
    const cancel = () => { if (gesture.current?.active) suppressClick.current = true; reset(); };
    const cancelPointer = (event: PointerEvent) => { if (gesture.current?.pointer === event.pointerId) cancel(); };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) {
        event.preventDefault(); event.stopImmediatePropagation(); cancel();
      }
    };
    const click = (event: MouseEvent) => {
      if (suppressClick.current && event.detail !== 0) {
        suppressClick.current = false; event.preventDefault(); event.stopImmediatePropagation();
      }
    };
    const pointerDown = (event: PointerEvent) => {
      if (gesture.current && event.pointerId !== gesture.current.pointer) cancel();
      else suppressClick.current = false;
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancelPointer);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key, true);
    window.addEventListener('click', click, true);
    window.addEventListener('pointerdown', pointerDown, true);
    return () => {
      reset();
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancelPointer); window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key, true); window.removeEventListener('click', click, true);
      window.removeEventListener('pointerdown', pointerDown, true);
    };
  }, []);
  useEffect(() => {
    if (gesture.current && (!enabled || !sameSource())) reset();
  }, [enabled, slots]);

  const slotProps = (index: number) => ({
    'data-inventory-slot': index,
    'data-inventory-drop-enabled': enabled && !moving ? 'true' : 'false',
    'data-drag-source': drag?.from === index || undefined,
    'data-drop-target': drag?.to === index ? drag.allowed ? 'allowed' : 'blocked' : undefined,
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      const item = latest.current.slots[index];
      if (!latest.current.enabled || useDragState.getState().moving || useDragState.getState().drag || !item || event.button !== 0 || event.isPrimary === false) return;
      reset();
      gesture.current = { pointer: event.pointerId, from: index, item: { ...item }, element: event.currentTarget,
        x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, previousY: event.clientY,
        touch: event.pointerType === 'touch', scrolling: false, active: false,
        grid: event.currentTarget.closest<HTMLElement>('[data-inventory-scroll]') };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      if (event.pointerType === 'touch') gesture.current.timer = setTimeout(activate, HOLD_MS);
    },
    onLostPointerCapture: () => { if (gesture.current) reset(); },
    onContextMenu: (event: React.MouseEvent) => { if (gesture.current || drag) event.preventDefault(); },
    onDragStart: (event: React.DragEvent) => event.preventDefault(),
  });
  const target = drag?.to !== null && drag ? slots[drag.to] : null;
  const dropHint = drag ? !drag.allowed ? 'Move to another slot' : !target ? 'Move here' : target.itemId === drag.item.itemId ? 'Stack items' : `Swap with ${getItemDef(target.itemId)?.name ?? 'item'}` : '';
  const preview = drag?.owner === owner && createPortal(<div className="inventory-drag-preview" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
    <img src={getItemDef(drag.item.itemId)?.icon ?? '/berry.svg'} alt="" /><strong>{drag.item.quantity}</strong><span>{dropHint}</span>
  </div>, document.body);
  return { slotProps, preview, isDragging: !!drag, isMoving: moving, dropHint };
}
