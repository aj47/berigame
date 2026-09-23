import React, { memo, useEffect, useMemo, useState } from "react";
import { INVENTORY_SIZE, getItemDef, type Slot } from "@sim";
import { useGameActions } from "../spacetime/actions";
import { useInventoryRows } from "../spacetime/hooks";

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Every inventory operation has the same explicit tap/click flow. */
const Inventory = memo(({ open, onClose }: Props) => {
  const rows = useInventoryRows();
  const { eatBerry, moveItem, dropItem } = useGameActions();
  const [selected, setSelected] = useState<number | null>(null);
  const [movingFrom, setMovingFrom] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const slots = useMemo<Slot[]>(() => {
    const out: Slot[] = Array(INVENTORY_SIZE).fill(null);
    for (const row of rows)
      if (row.slot < INVENTORY_SIZE)
        out[row.slot] = { itemId: row.itemId, quantity: row.quantity };
    return out;
  }, [rows]);
  useEffect(() => {
    if (!open) setMovingFrom(null);
  }, [open]);
  useEffect(() => {
    if (movingFrom !== null && !slots[movingFrom]) setMovingFrom(null);
  }, [slots, movingFrom]);

  if (!open) return null;
  const item = selected !== null ? slots[selected] : null;
  const def = item ? getItemDef(item.itemId) : undefined;
  const occupied = slots.filter(Boolean).length;
  const run = async (action: () => Promise<unknown>) => {
    if (pending) return;
    setPending(true);
    try {
      await action();
    } finally {
      setPending(false);
    }
  };
  const selectSlot = (slot: number) => {
    if (movingFrom !== null) {
      if (slot !== movingFrom) void run(() => moveItem(movingFrom, slot));
      setMovingFrom(null);
    }
    setSelected(slot);
  };

  return (
    <section className="game-panel inventory-panel" aria-label="Inventory">
      <header className="panel-heading">
        <div>
          <span className="eyebrow">Your supplies</span>
          <h2>
            Inventory{" "}
            <small>
              {occupied}/{INVENTORY_SIZE}
            </small>
          </h2>
        </div>
        <button
          className="close-button"
          onClick={onClose}
          aria-label="Close inventory"
        >
          ×
        </button>
      </header>
      <div className="inventory-grid" aria-label="Inventory slots">
        {slots.map((slot, index) => {
          const definition = slot ? getItemDef(slot.itemId) : undefined;
          return (
            <button
              key={index}
              className={`inventory-slot ${slot ? "filled" : ""} ${selected === index ? "selected" : ""} ${movingFrom !== null && movingFrom !== index ? "move-target" : ""}`}
              onClick={() => selectSlot(index)}
              disabled={pending}
              aria-pressed={selected === index}
              aria-label={`Slot ${index + 1}: ${slot ? `${definition?.name ?? slot.itemId}, ${slot.quantity}` : "empty"}${movingFrom !== null ? ", move here" : ""}`}
            >
              {slot ? (
                <>
                  <img
                    src={definition?.icon ?? "/berry.svg"}
                    alt=""
                    draggable={false}
                  />
                  <span className="qty">{slot.quantity}</span>
                </>
              ) : (
                <span className="empty-slot-mark" aria-hidden="true">
                  ·
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="item-inspector" aria-live="polite">
        {movingFrom !== null ? (
          <>
            <strong>Choose a destination slot</strong>
            <p>Matching berries stack. Different items swap places.</p>
            <button onClick={() => setMovingFrom(null)}>Cancel move</button>
          </>
        ) : item ? (
          <>
            <div className="item-description">
              <strong>{def?.name ?? item.itemId}</strong>
              <span>
                {def?.healthRestore
                  ? `Restores ${def.healthRestore} HP`
                  : "Inventory item"}{" "}
                · {item.quantity} held
              </span>
            </div>
            <div className="item-actions">
              <button
                className="primary-button"
                disabled={pending || !def?.healthRestore}
                onClick={() => void run(() => eatBerry(selected!))}
              >
                Eat <span>+{def?.healthRestore ?? 0}</span>
              </button>
              <button
                disabled={pending}
                onClick={() => setMovingFrom(selected)}
              >
                Move
              </button>
              <button
                disabled={pending}
                onClick={() => void run(() => dropItem(selected!, 1))}
              >
                Drop 1
              </button>
            </div>
            <p className="fine-print">
              Anyone can pick up dropped items.
            </p>
          </>
        ) : (
          <p>
            {occupied
              ? "Select a berry to eat, move, or drop it."
              : "Your bag is empty. Tap a berry tree and choose Harvest to gather food."}
          </p>
        )}
      </div>
    </section>
  );
});

export default Inventory;
