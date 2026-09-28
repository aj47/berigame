import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  HOTBAR_SIZE,
  MELEE_RANGE,
  PUNCH_DAMAGE,
  PlayerState,
  chebyshev,
  getItemDef,
  isWeapon,
} from "@sim";
import { useGameActions } from "../spacetime/actions";
import {
  useInventoryRows,
  useMyPlayer,
  usePlayersByHex,
  useTick,
} from "../spacetime/hooks";
import { useToastStore } from "../spacetime/stores/toastStore";
import { isTyping } from "./keyboard";
import { PUNCH_ICON, slotsFromRows, wieldedSlotIndex } from "./itemUi";

const QUICK_KEYS = Array.from({ length: HOTBAR_SIZE }, (_, i) => String(i + 1));

interface Props {
  /** False while a panel that should not trigger items (Appearance) is open. */
  quickKeysEnabled?: boolean;
}

/**
 * Bottom combat strip: health, opponent timing, the three quick slots
 * (inventory slots 0..HOTBAR_SIZE-1, keys 1-3) and Stop.
 */
const CombatHud = ({ quickKeysEnabled = true }: Props) => {
  const me = useMyPlayer();
  const players = usePlayersByHex();
  const tick = useTick();
  const rows = useInventoryRows();
  const { eatBerry, wieldItem, unwield, cancel } = useGameActions();
  const showToast = useToastStore((s) => s.show);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const slots = useMemo(() => slotsFromRows(rows, HOTBAR_SIZE), [rows]);

  const dead = !!me && me.state === PlayerState.Dead;
  const weapon: string = me?.weapon ?? "";
  const wieldedIndex = wieldedSlotIndex(slots, weapon, HOTBAR_SIZE);

  const run = async (action: () => Promise<unknown>) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      await action();
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const activate = (index: number) => {
    const slot = slots[index];
    if (!me || !slot || dead || pendingRef.current) return;
    if (isWeapon(slot.itemId)) {
      void run(() => (weapon === slot.itemId ? unwield() : wieldItem(index)));
      return;
    }
    const def = getItemDef(slot.itemId);
    if (!def?.healthRestore) return;
    // A mis-pressed key mid-fight would waste the berry and delay the next swing.
    if (me.hp >= me.maxHp) {
      showToast("You're already at full health");
      return;
    }
    void run(() => eatBerry(index));
  };

  // Latest values for the window listener, which is registered once.
  const latest = useRef({ activate, cancel, quickKeysEnabled });
  latest.current = { activate, cancel, quickKeysEnabled };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.repeat || e.ctrlKey || e.metaKey || e.altKey)
        return;
      const index = QUICK_KEYS.indexOf(e.key);
      if (index >= 0) {
        if (!latest.current.quickKeysEnabled) return;
        // Claim the digit so the panel shortcuts in UIComponents ignore it.
        e.preventDefault();
        latest.current.activate(index);
      } else if (e.key === "Escape") latest.current.cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!me) return null;
  const hp = Math.max(0, Math.min(100, (me.hp / Math.max(1, me.maxHp)) * 100));
  const target = me.combatTarget
    ? players.get(me.combatTarget.toHexString())
    : undefined;
  const hostile = me.hostile && !dead;
  const targetAvailable =
    target && target.online && target.state !== PlayerState.Dead;
  const inRange = targetAvailable && chebyshev(me, target) <= MELEE_RANGE;
  const recovery = Math.max(0, me.nextSwingTick - tick);
  const timing = !targetAvailable
    ? "Target unavailable"
    : !inRange
      ? "Moving into range"
      : recovery > 0
        ? `Recovery · ${recovery} ${recovery === 1 ? "tick" : "ticks"}`
        : "Swing ready";

  const weaponDef = weapon ? getItemDef(weapon) : undefined;
  const weaponName = weaponDef?.name ?? "Punch";
  const weaponDamage = weaponDef?.weaponDamage || PUNCH_DAMAGE;
  const weaponChip = (
    <span
      className={`weapon-chip ${weaponDef ? "armed" : ""} ${hostile ? "compact" : ""}`}
      title={`${weaponDef ? "Wielding" : "Fighting with"} ${weaponName} · ${weaponDamage} damage per swing`}
    >
      <img src={weaponDef?.icon ?? PUNCH_ICON} alt="" draggable={false} />
      <span className="weapon-chip-label">
        {weaponName} · {weaponDamage} dmg
      </span>
    </span>
  );

  return (
    <section className="combat-hud" aria-label="Combat controls">
      <div className="hud-topline">
        <div
          className="hud-health"
          role="meter"
          aria-label="Health"
          aria-valuenow={me.hp}
          aria-valuemin={0}
          aria-valuemax={me.maxHp}
        >
          <div
            className={`hud-health-fill ${hp < 30 ? "low" : ""}`}
            style={{ width: `${hp}%` }}
          />
          <span>
            HP{" "}
            <strong>
              {me.hp} / {me.maxHp}
            </strong>
          </span>
        </div>
        {dead ? (
          <span className="hud-status">Respawning…</span>
        ) : hostile ? (
          <>
            <div
              className="hud-opponent"
              title={`${target?.name ?? "Opponent"} — ${timing}`}
            >
              <strong>{target?.name ?? "Opponent"}</strong>
              <span>{timing}</span>
            </div>
            {weaponChip}
          </>
        ) : (
          weaponChip
        )}
      </div>
      <div className="hotbar">
        {slots.map((slot, index) => {
          const def = slot ? getItemDef(slot.itemId) : undefined;
          const weaponSlot = !!slot && isWeapon(slot.itemId);
          const food = !!def?.healthRestore;
          const wielded = index === wieldedIndex;
          const name = slot ? (def?.name ?? slot.itemId) : "";
          const hint = !slot
            ? "Empty"
            : weaponSlot
              ? wielded
                ? "Wielded"
                : "Wield"
              : food
                ? `Eat +${def!.healthRestore}`
                : "—";
          const title = !slot
            ? "Empty — move a berry or stick here from your bag"
            : weaponSlot
              ? wielded
                ? `Put away ${name} and punch`
                : `Wield ${name} (${def?.weaponDamage} damage)`
              : food
                ? `Eat ${name} (+${def!.healthRestore} HP)`
                : name;
          return (
            <button
              key={index}
              data-slot={index}
              className={`hotbar-slot ${slot ? "filled" : "empty"} ${wielded ? "active" : ""}`}
              disabled={dead || pending || !slot || (!weaponSlot && !food)}
              aria-pressed={wielded}
              aria-label={`Quick slot ${index + 1}: ${slot ? `${name}${wielded ? ", wielded" : ""}` : "empty"}`}
              title={title}
              onClick={() => activate(index)}
            >
              {slot ? (
                <img
                  className="hotbar-icon"
                  src={def?.icon ?? "/berry.svg"}
                  alt=""
                  draggable={false}
                />
              ) : (
                <span className="hotbar-icon hotbar-empty-mark" aria-hidden="true">
                  ·
                </span>
              )}
              <span className="hotbar-copy">
                <span className="hotbar-name">{slot ? name : `Slot ${index + 1}`}</span>
                <span className="hotbar-hint">{hint}</span>
              </span>
              {slot && slot.quantity > 1 && (
                <span className="hotbar-qty">{slot.quantity}</span>
              )}
              <kbd>{index + 1}</kbd>
            </button>
          );
        })}
        <button
          className="stop-button"
          onClick={() => cancel()}
          aria-label="Stop moving, attacking, or harvesting"
        >
          <span aria-hidden="true">■</span>
          <span>Stop</span>
          <kbd>Esc</kbd>
        </button>
      </div>
      <p className="hud-hint">
        {hostile
          ? "Eat or wield from your quick slots between swings."
          : weaponDef
            ? `${weaponName} wielded. Press its key again to punch instead.`
            : "Punching. Harvest berry trees to find a stick."}
      </p>
    </section>
  );
};
export default CombatHud;
