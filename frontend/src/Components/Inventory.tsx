import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { HOTBAR_SIZE, INVENTORY_SIZE, PlayerState, getItemDef, isWeapon } from "@sim";
import { useGameActions } from "../spacetime/actions";
import { useInventoryRows, useMyPlayer } from "../spacetime/hooks";
import { isWieldedSlot, slotsFromRows } from "./itemUi";
import { useInventoryDrag } from "./useInventoryDrag";
import type { FrontierSnapshot } from "../../../shared/sim/frontier/snapshot";
import { foodHealing } from "../../../shared/sim/frontier/engine";

interface Props {
  open: boolean;
  onClose: () => void;
  onCraft?: () => void;
  onStorage?: () => void;
  frontier?: FrontierSnapshot;
  initialQuickSlot?: number | null;
}

/** Drag or tap to arrange items; the server owns swaps and stack quantities. */
const Inventory = memo(({ open, onClose, onCraft, onStorage, frontier, initialQuickSlot = null }: Props) => {
  const rows = useInventoryRows();
  const me = useMyPlayer();
  const { eatBerry, wieldItem, unwield, moveItem, dropItem, frontier: frontierAction } = useGameActions();
  const [selected, setSelected] = useState<number | null>(null);
  const [movingFrom, setMovingFrom] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false), session = useRef(0);
  const [assignTo, setAssignTo] = useState<number | null>(null);
  const [error, setError] = useState('');
  const slots = useMemo(() => slotsFromRows(rows), [rows]);
  const weapon: string = me?.weapon ?? "";
  const wielded = (index: number) => isWieldedSlot(slots, index, weapon, HOTBAR_SIZE);
  useEffect(() => {
    session.current++;
    setMovingFrom(null); setSelected(null); setError('');
    setAssignTo(open && initialQuickSlot !== null && initialQuickSlot >= 0 && initialQuickSlot < HOTBAR_SIZE ? initialQuickSlot : null);
  }, [open, initialQuickSlot]);
  useEffect(() => {
    if (movingFrom !== null && !slots[movingFrom]) setMovingFrom(null);
  }, [slots, movingFrom]);

  const run = async (action: () => Promise<unknown>, onSuccess?: () => void) => {
    if (busy.current) return;
    busy.current = true; setPending(true); setError('');
    const started = session.current;
    try {
      const success = await action();
      if (started !== session.current) return;
      if (success !== false) onSuccess?.();
      else setError('Could not update your bag. Try again.');
    } catch {
      if (started === session.current) setError('Could not update your bag. Try again.');
      return false;
    } finally { busy.current = false; setPending(false); }
  };
  const move = async (from: number, to: number) => {
    if (from === to || !slots[from]) return;
    return run(() => moveItem(from, to), () => {
      setSelected(to); setAssignTo(null); setMovingFrom(null);
    });
  };
  const drag = useInventoryDrag({
    slots, enabled: open && !pending && me?.state !== PlayerState.Dead,
    onMove: move,
    onStart: () => { setAssignTo(null); setMovingFrom(null); setSelected(null); setError(''); },
    onError: () => setError('Could not update your bag. Try again.'),
  });
  const locked = pending || drag.isMoving;

  if (!open) return null;
  const item = selected !== null ? slots[selected] : null;
  const def = item ? getItemDef(item.itemId) : undefined;
  const healing = foodHealing(def?.healthRestore ?? 0, frontier?.profile);
  const occupied = slots.filter(Boolean).length;
  const weaponSelected = !!item && isWeapon(item.itemId);
  const armourSelected = item?.itemId === 'padded_vest';
  const armourEquipped = armourSelected && (frontier?.profile.events.vest ?? 0) > 0;
  const selectedWielded = selected !== null && wielded(selected);
  const inQuickBar = selected !== null && selected < HOTBAR_SIZE;
  const selectSlot = (slot: number) => {
    if (busy.current) return;
    if (assignTo !== null) {
      if (slots[slot]) move(slot, assignTo);
      return;
    }
    if (movingFrom !== null) {
      if (slot !== movingFrom) move(movingFrom, slot);
      else setMovingFrom(null);
      return;
    }
    setSelected(slot); setError('');
  };
  const assignSelected = item && selected !== null && selected >= HOTBAR_SIZE && movingFrom === null;
  const quickLabel = (index: number) => {
    const target = slots[index];
    if (assignSelected) return `Put ${def?.name ?? item.itemId} in quick slot ${index + 1}${target ? target.itemId === item.itemId ? ', stack items' : `, swap with ${getItemDef(target.itemId)?.name ?? target.itemId}` : ''}`;
    return `Slot ${index + 1}: ${target ? `${getItemDef(target.itemId)?.name ?? target.itemId}, ${target.quantity}${wielded(index) ? ', wielded' : ''}` : 'empty'}${movingFrom !== null ? ', move here' : ''}`;
  };
  const selectQuick = (index: number) => {
    if (assignSelected) move(selected!, index);
    else if (movingFrom !== null) selectSlot(index);
    else if (slots[index]) { setSelected(index); setAssignTo(null); }
    else { setAssignTo(index); setSelected(null); }
  };

  return (
    <section className="game-panel inventory-panel" aria-label="Inventory">
      <header className="panel-heading">
        <div>
          <h2>
            Bag{" "}
            <small>
              {occupied}/{INVENTORY_SIZE}
            </small>
          </h2>
        </div>
        <div className="bag-heading-actions">
        {onStorage && <button className="bag-craft-link" onClick={onStorage}>Storage ↗</button>}
        {onCraft && <button className="bag-craft-link" onClick={onCraft}>Craft ↗</button>}
        <button
          className="close-button"
          onClick={onClose}
          aria-label="Close inventory"
        >
          ×
        </button>
        </div>
      </header>
      <div className={`bag-quick-slots ${assignSelected || movingFrom !== null ? 'is-assigning' : ''}`}>
        <div className="bag-quick-heading"><strong>Quick slots</strong><span>{assignSelected ? `Place ${def?.name}` : assignTo !== null ? `Choose an item for slot ${assignTo + 1}` : 'Drag to move or swap'}</span></div>
        <div className="bag-quick-row" aria-label="Assign quick slots">
          {slots.slice(0, HOTBAR_SIZE).map((slot, index) => {
            const definition = slot ? getItemDef(slot.itemId) : undefined;
            const fullStack = assignSelected && slot?.itemId === item.itemId && slot.quantity >= (def?.maxStack ?? 1);
            return <button {...drag.slotProps(index)} key={index} type="button" className={`inventory-slot quick ${slot ? 'filled' : ''} ${wielded(index) ? 'wielded' : ''} ${selected === index || assignTo === index ? 'selected' : ''} ${assignSelected || movingFrom !== null ? 'move-target' : ''}`} disabled={locked || Boolean(fullStack)} onClick={() => selectQuick(index)} aria-label={quickLabel(index)} aria-pressed={selected === index || assignTo === index} title={quickLabel(index)}>
              <span className="quick-slot-number" aria-hidden="true">{index + 1}</span>
              {slot ? <><img src={definition?.icon ?? '/berry.svg'} alt="" draggable={false}/><span className="qty">{slot.quantity}</span></> : <span className="empty-slot-mark" aria-hidden="true">+</span>}
              <span className="bag-quick-caption">{assignSelected ? fullStack ? 'Full' : !slot ? 'Put here' : slot.itemId === item.itemId ? 'Stack' : 'Swap' : slot ? definition?.name ?? slot.itemId : 'Add item'}</span>
            </button>;
          })}
        </div>
      </div>
      <div className="inventory-grid" aria-label="Inventory slots" data-inventory-scroll>
        {slots.slice(HOTBAR_SIZE).map((slot, offset) => {
          const index = offset + HOTBAR_SIZE;
          const definition = slot ? getItemDef(slot.itemId) : undefined;
          return (
            <button
              {...drag.slotProps(index)}
              key={index}
              className={`inventory-slot ${slot ? "filled" : ""} ${selected === index ? "selected" : ""} ${movingFrom !== null && movingFrom !== index ? "move-target" : ""}`}
              onClick={() => selectSlot(index)}
              disabled={locked}
              aria-pressed={selected === index}
              aria-label={`Slot ${index + 1}: ${slot ? `${definition?.name ?? slot.itemId}, ${slot.quantity}${wielded(index) ? ", wielded" : ""}` : "empty"}${movingFrom !== null ? ", move here" : ""}`}
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
        {error && <p className="bag-error" role="alert">{error}</p>}
        {assignTo !== null ? <div className="bag-assignment-hint"><p>Tap an item in your bag to put it in quick slot {assignTo + 1}.</p><button onClick={() => setAssignTo(null)} disabled={locked}>Cancel</button></div> : movingFrom !== null ? (
          <>
            <strong>Choose a destination slot</strong>
            <p>
              Matching items stack. Different items swap places. Slots 1–3
              are your quick bar.
            </p>
            <button onClick={() => setMovingFrom(null)}>Cancel move</button>
          </>
        ) : item ? (
          <>
            <div className="item-description">
              <strong>{def?.name ?? item.itemId}</strong>
              <span>
                {weaponSelected
                  ? `Weapon · ${def?.weaponDamage ?? 0} damage`
                  : armourSelected
                    ? `${armourEquipped ? 'Equipped' : 'Armour'} · +3 max HP`
                  : def?.healthRestore
                    ? `Restores ${healing} HP`
                    : "Crafting material"}{" "}
                · {item.quantity} held
                {selectedWielded ? " · wielded" : ""}
              </span>
            </div>
            <div className="item-actions">
              {weaponSelected ? (
                <button
                  className="primary-button"
                  disabled={locked}
                  title={
                    !selectedWielded && !inQuickBar
                      ? "Move it to quick slot 1, 2 or 3 to wield it"
                      : undefined
                  }
                  onClick={() => {
                    if (!inQuickBar) {
                      document.querySelector<HTMLButtonElement>('.bag-quick-row button:not(:disabled)')?.focus();
                      return;
                    }
                    void run(() => selectedWielded ? unwield() : wieldItem(selected!));
                  }}
                >
                  {selectedWielded ? "Unwield" : inQuickBar ? "Wield" : "Choose quick slot ↑"}
                </button>
              ) : armourSelected && frontier?.enabled ? (
                <button className="primary-button" disabled={locked}
                  onClick={() => void run(() => frontierAction({ action: 'equip', item: 'padded_vest', ...(armourEquipped ? { target: 'unequip' } : {}) }))}>
                  {armourEquipped ? 'Unequip' : 'Equip'}
                </button>
              ) : def?.healthRestore ? (
                <button
                  className="primary-button"
                  disabled={locked || !def?.healthRestore || (!!me && me.hp >= me.maxHp)}
                  title={me && me.hp >= me.maxHp ? "You're already at full health" : undefined}
                  onClick={() => void run(() => eatBerry(selected!))}
                >
                  Eat <span>+{healing}</span>
                </button>
              ) : null}
              <button
                disabled={locked}
                onClick={() => setMovingFrom(selected)}
              >
                Move
              </button>
              <button
                disabled={locked}
                onClick={() => void run(() => dropItem(selected!, 1))}
              >
                Drop 1
              </button>
            </div>
            <details className="bag-item-details"><summary>Item details</summary>
              {def?.description && <p>{def.description}</p>}
              <p>Anyone can pick up dropped items.</p>
              {(item.itemId === 'stick' || item.itemId === 'stone_club') && item.quantity === 1 && <p>Keep a spare: dropping your last {def?.name} can close its outward route.</p>}
            </details>
          </>
        ) : (
          <>
            <p>
              {occupied
                ? "Drag to arrange · Hold to drag on touch."
                : "Your bag is empty. Harvest a berry tree to fill it."}
            </p>
          </>
        )}

      </div>
      {drag.preview}
    </section>
  );
});

export default Inventory;
