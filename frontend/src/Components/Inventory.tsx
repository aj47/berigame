import React, { memo, useEffect, useMemo, useState } from "react";
import { HOTBAR_SIZE, INVENTORY_SIZE, getCosmetic, getItemDef, hasCosmetic, isWeapon, levelForXp, recipeStatus } from "@sim";
import { useGameActions } from "../spacetime/actions";
import { useInventoryRows, useMyCosmetics, useMyPlayer, useMySkills } from "../spacetime/hooks";
import { isWieldedSlot, slotsFromRows } from "./itemUi";

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Every inventory operation has the same explicit tap/click flow. */
const Inventory = memo(({ open, onClose }: Props) => {
  const rows = useInventoryRows();
  const me = useMyPlayer();
  const { eatBerry, wieldItem, unwield, moveItem, dropItem, craft } = useGameActions();
  const [selected, setSelected] = useState<number | null>(null);
  const [movingFrom, setMovingFrom] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const slots = useMemo(() => slotsFromRows(rows), [rows]);
  const skills = useMySkills();
  const cosmetics = useMyCosmetics();
  const craftingLevel = levelForXp(skills?.craftingXp ?? 0);
  const weapon: string = me?.weapon ?? "";
  const wielded = (index: number) => isWieldedSlot(slots, index, weapon, HOTBAR_SIZE);
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
  const weaponSelected = !!item && isWeapon(item.itemId);
  const selectedWielded = selected !== null && wielded(selected);
  const inQuickBar = selected !== null && selected < HOTBAR_SIZE;
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
              className={`inventory-slot ${slot ? "filled" : ""} ${index < HOTBAR_SIZE ? "quick" : ""} ${wielded(index) ? "wielded" : ""} ${selected === index ? "selected" : ""} ${movingFrom !== null && movingFrom !== index ? "move-target" : ""}`}
              onClick={() => selectSlot(index)}
              disabled={pending}
              aria-pressed={selected === index}
              aria-label={`Slot ${index + 1}: ${slot ? `${definition?.name ?? slot.itemId}, ${slot.quantity}${wielded(index) ? ", wielded" : ""}` : "empty"}${movingFrom !== null ? ", move here" : ""}`}
            >
              {index < HOTBAR_SIZE && (
                <span className="quick-slot-number" aria-hidden="true">
                  {index + 1}
                </span>
              )}
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
            <p>
              Matching berries stack. Different items swap places. Slots 1–3
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
                  : def?.healthRestore
                    ? `Restores ${def.healthRestore} HP`
                    : "Inventory item"}{" "}
                · {item.quantity} held
                {selectedWielded ? " · wielded" : ""}
              </span>
            </div>
            <div className="item-actions">
              {weaponSelected ? (
                <button
                  className="primary-button"
                  disabled={pending || (!selectedWielded && !inQuickBar)}
                  title={
                    !selectedWielded && !inQuickBar
                      ? "Move it to quick slot 1, 2 or 3 to wield it"
                      : undefined
                  }
                  onClick={() =>
                    void run(() =>
                      selectedWielded ? unwield() : wieldItem(selected!),
                    )
                  }
                >
                  {selectedWielded ? "Unwield" : "Wield"}
                </button>
              ) : (
                <button
                  className="primary-button"
                  disabled={pending || !def?.healthRestore || (!!me && me.hp >= me.maxHp)}
                  title={me && me.hp >= me.maxHp ? "You're already at full health" : undefined}
                  onClick={() => void run(() => eatBerry(selected!))}
                >
                  Eat <span>+{def?.healthRestore ?? 0}</span>
                </button>
              )}
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
              {weaponSelected && !inQuickBar
                ? "Move it to quick slot 1, 2 or 3 to wield it. "
                : ""}
              Anyone can pick up dropped items.
            </p>
          </>
        ) : (
          <>
            <p>
              {occupied
                ? "Select an item to eat, wield, move, or drop it."
                : "Your bag is empty. Tap a berry tree and choose Harvest to gather food — sometimes you'll find a stick too."}
            </p>
            <p className="fine-print">
              Slots 1–3 are your quick bar — move a stick there to wield it.
            </p>
          </>
        )}
        <div className="recipe-list" aria-label={`Recipes · Crafting level ${craftingLevel}`}>
          <span className="eyebrow">Make · Crafting Lv {craftingLevel}</span>
          {recipeStatus(slots, craftingLevel).map((r) => {
            const owned = r.cosmetic !== null && hasCosmetic(cosmetics?.unlocked ?? 0, r.cosmetic);
            const icon = r.output ? getItemDef(r.output.itemId)?.icon : `/items/${r.id}.png`;
            return (
              <div className={`recipe-row ${r.locked ? "locked" : ""}`} key={r.id} data-recipe-row={r.id}>
                <button
                  type="button"
                  data-recipe={r.id}
                  disabled={pending || !r.canCraft || owned}
                  title={r.locked ? `Needs Crafting level ${r.level}` : undefined}
                  onClick={() => void run(() => craft(r.id))}
                >
                  <img src={icon} alt="" /> {r.locked ? `Lv ${r.level}` : "Make"} {r.name}
                </button>
                <span className="fine-print">
                  {r.inputs.map((i) => `${i.quantity} ${i.name}`).join(" + ")}
                  {r.output && getItemDef(r.output.itemId)?.weaponDamage ? ` → ${getItemDef(r.output.itemId)!.weaponDamage} damage` : ""}
                  {r.output && getItemDef(r.output.itemId)?.healthRestore ? ` → heals ${getItemDef(r.output.itemId)!.healthRestore}` : ""}
                  {r.cosmetic !== null ? ` → ${getCosmetic(r.cosmetic)?.name} (keepsake)` : ""}
                  {r.locked ? ` — needs Crafting level ${r.level}` : owned ? " — already yours" : r.canCraft ? ` · +${r.xp} Crafting XP` : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
});

export default Inventory;
