import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  HOTBAR_SIZE,
  MELEE_RANGE,
  PUNCH_DAMAGE,
  PlayerState,
  STICK_ITEM_ID,
  chebyshev,
  getItemDef,
  inSpireFloor,
  isSafe,
  isWeapon,
} from "@sim";
import { useFirstDayStore } from "../spacetime/stores/firstDayStore";
import { useGameActions } from "../spacetime/actions";
import {
  useInventoryRows,
  useMyPlayer,
  usePlayersByHex,
  useTick,
} from "../spacetime/hooks";
import { useToastStore } from "../spacetime/stores/toastStore";
import { isTyping } from "./keyboard";
import { PUNCH_ICON, isWieldedSlot, slotsFromRows } from "./itemUi";
import { useInventoryDrag } from "./useInventoryDrag";
import type { FrontierSnapshot } from "../../../shared/sim/frontier/snapshot";
import { REGIONS } from "../../../shared/sim/frontier/catalog";
import { foodHealing } from "../../../shared/sim/frontier/engine";

const QUICK_KEYS = Array.from({ length: HOTBAR_SIZE }, (_, i) => String(i + 1));

interface Props {
  /** False while a panel is open, so its keyboard controls cannot consume items. */
  quickKeysEnabled?: boolean;
  onOpenBag?: (slot: number) => void;
  frontier?: FrontierSnapshot;
}

/**
 * Bottom combat strip: health, opponent timing, the three quick slots
 * (inventory slots 0..HOTBAR_SIZE-1, keys 1-3) and Stop.
 */
const CombatHud = ({ quickKeysEnabled = true, onOpenBag, frontier }: Props) => {
  const me = useMyPlayer();
  const players = usePlayersByHex();
  const tick = useTick();
  const rows = useInventoryRows();
  const { eatBerry, wieldItem, unwield, cancel, moveItem, dropItem, frontier: frontierAction } = useGameActions();
  const showToast = useToastStore((s) => s.show);
  const sparkle = useFirstDayStore((s) => s.stickFoundAt !== null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const slots = useMemo(() => slotsFromRows(rows), [rows]);

  const dead = !!me && me.state === PlayerState.Dead;
  const weapon: string = me?.weapon ?? "";
  const wielded = (index: number) => isWieldedSlot(slots, index, weapon, HOTBAR_SIZE);
  const vestEquipped = (frontier?.profile.events.vest ?? 0) > 0 && slots.some(slot => slot?.itemId === 'padded_vest');

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

  const drag = useInventoryDrag({
    slots, enabled: !dead && !pending && !!me,
    onMove: async (from, to) => run(() => moveItem(from, to)),
    onDrop: async (from, quantity) => run(() => dropItem(from, quantity)),
    onError: () => showToast('Could not move that item. Try again.'),
  });

  const activate = (index: number) => {
    const slot = slots[index];
    if (!me || !slot || dead || pendingRef.current || drag.isDragging || drag.isMoving) return;
    if (isWeapon(slot.itemId)) {
      void run(() => (wielded(index) ? unwield() : wieldItem(index)));
      return;
    }
    if (slot.itemId === 'padded_vest' && frontier?.enabled) {
      void run(() => frontierAction({ action: 'equip', item: slot.itemId, ...(vestEquipped ? { target: 'unequip' } : {}) }));
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
  const inBramblewild = !me.region || me.region === 'bramblewild';
  const protectedFromPlayers = (me.region === 'settlement' && chebyshev(me, REGIONS.settlement.spawn) <= 4)
    || !!frontier?.plots.some(plot => plot.region === me.region && plot.status === 'protected'
      && me.x >= plot.x && me.x < plot.x + 16 && me.z >= plot.z && me.z < plot.z + 16);
  const safe = !dead && (inBramblewild ? isSafe(me, tick) : protectedFromPlayers);
  const hp =Math.max(0, Math.min(100, (me.hp / Math.max(1, me.maxHp)) * 100));
  const target = me.combatTarget
    ? players.get(me.combatTarget.toHexString())
    : undefined;
  const hostile = me.hostile && !dead;
  // No PvP on the Spire floor: the opponent block steps aside for the Spire HUD.
  const onFloor = inBramblewild && inSpireFloor(me);
  const targetAvailable =
    target && target.online && target.state !== PlayerState.Dead
      && (target.region || 'bramblewild') === (me.region || 'bramblewild');
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
      title={`${weaponDef ? "Wielding" : "Fighting with"} ${weaponName} · ${weaponDamage} ${inBramblewild ? '' : 'base '}damage per swing`}
    >
      <img src={weaponDef?.icon ?? PUNCH_ICON} alt="" draggable={false} />
      <span className="weapon-chip-label">
        {weaponName} · {weaponDamage} {inBramblewild ? '' : 'base '}dmg
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
            {safe && (
              <em className="safe-badge" title={inBramblewild ? 'Nobody can hit you here or right now' : 'Protected from player combat here'}>
                {inBramblewild ? 'Safe' : 'PvP safe'}
              </em>
            )}
            <strong>
              {me.hp} / {me.maxHp}
            </strong>
          </span>
        </div>
        {dead ? (
          <span className="hud-status">Respawning…</span>
        ) : hostile && !onFloor ? (
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
        {slots.slice(0, HOTBAR_SIZE).map((slot, index) => {
          const def = slot ? getItemDef(slot.itemId) : undefined;
          const weaponSlot = !!slot && isWeapon(slot.itemId);
          const armourSlot = slot?.itemId === 'padded_vest' && !!frontier?.enabled;
          const food = !!def?.healthRestore;
          const healing = foodHealing(def?.healthRestore ?? 0, frontier?.profile);
          const inHand = armourSlot ? vestEquipped : wielded(index);
          const name = slot ? (def?.name ?? slot.itemId) : "";
          const hint = !slot
            ? "Empty"
            : weaponSlot
              ? inHand
                ? "Wielded"
                : "Wield"
              : armourSlot
                ? inHand ? 'Equipped' : 'Equip'
              : food
                ? `Eat +${healing}`
                : "Move";
          const title = !slot
            ? "Choose an item from your bag for this quick slot"
            : weaponSlot
              ? inHand
                ? `Put away ${name} and punch`
                : `Wield ${name} (${def?.weaponDamage} damage)`
              : armourSlot
                ? inHand ? `Unequip ${name}` : `Equip ${name} (+3 max HP)`
              : food
                ? `Eat ${name} (+${healing} HP)`
                : `Arrange ${name} in your bag`;
          return (
            <button
              {...drag.slotProps(index)}
              key={index}
              data-slot={index}
              className={`hotbar-slot ${slot ? "filled" : "empty"} ${inHand ? "active" : ""} ${pending ? "busy" : ""} ${sparkle && slot?.itemId === STICK_ITEM_ID ? "sparkle" : ""}`}
              // Only unusable slots are disabled: disabling the focused button while a
              // request is in flight would drop keyboard focus. pendingRef blocks re-entry.
              disabled={dead || (!slot && !onOpenBag)}
              aria-busy={pending || undefined}
              // Only a weapon is an on/off toggle; eating is a one-shot action.
              aria-pressed={weaponSlot || armourSlot ? inHand : undefined}
              aria-label={`Quick slot ${index + 1}: ${slot ? `${name}${inHand ? armourSlot ? ', equipped' : ', wielded' : ""}` : "empty"}`}
              aria-describedby={slot ? `hotbar-hint-${index}` : undefined}
              title={title}
              onClick={() => (!slot || (!weaponSlot && !armourSlot && !food)) && onOpenBag ? onOpenBag(index) : activate(index)}
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
                <span className="hotbar-name">{slot ? name : onOpenBag ? "Add item" : `Slot ${index + 1}`}</span>
                <span className="hotbar-hint" id={`hotbar-hint-${index}`}>{hint}</span>
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
            : !inBramblewild
              ? 'Drag food or a weapon into quick slots. Keys 1–3 use them.'
            : slots.some(slot => slot?.itemId === STICK_ITEM_ID)
              ? slots.slice(0, HOTBAR_SIZE).some(slot => slot?.itemId === STICK_ITEM_ID)
                ? "Punching. Tap your stick in the quick bar to wield it."
                : "Punching. Move your stick from the bag to a quick slot to wield it."
              : "Punching. Harvest berries to find a sturdy stick."}
      </p>
      {drag.preview}
    </section>
  );
};
export default CombatHud;
