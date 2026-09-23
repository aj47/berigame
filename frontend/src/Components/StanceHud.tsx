import React, { useEffect } from "react";
import {
  FIGHT_STATE_NAMES,
  STANCE_NAMES,
  Stance,
  PlayerState,
  MELEE_RANGE,
  chebyshev,
} from "@sim";
import { useGameActions } from "../spacetime/actions";
import { useMyPlayer, usePlayersByHex, useTick } from "../spacetime/hooks";

export const STANCE_IMAGES: Record<number, string> = {
  [Stance.Strike]: "/ui/stance-strike.png",
  [Stance.Grab]: "/ui/stance-grab.png",
  [Stance.Guard]: "/ui/stance-guard.png",
};
const ORDER = [Stance.Strike, Stance.Grab, Stance.Guard] as const;
const BEATS = {
  [Stance.Strike]: "Grab",
  [Stance.Grab]: "Guard",
  [Stance.Guard]: "Strike",
};
export const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

const StanceHud = () => {
  const me = useMyPlayer();
  const players = usePlayersByHex();
  const tick = useTick();
  const { setStance, cancel } = useGameActions();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.repeat || e.ctrlKey || e.metaKey || e.altKey)
        return;
      if (["1", "2", "3"].includes(e.key)) {
        e.preventDefault();
        setStance(ORDER[Number(e.key) - 1]);
      } else if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setStance, cancel]);
  if (!me) return null;
  const state = FIGHT_STATE_NAMES[me.fightState] ?? "Neutral";
  const hp = Math.max(0, Math.min(100, (me.hp / Math.max(1, me.maxHp)) * 100));
  const dead = me.state === PlayerState.Dead;
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
  return (
    <section className="stance-hud" aria-label="Combat controls">
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
        {hostile ? (
          <div
            className="hud-opponent"
            title={`${target?.name ?? "Opponent"} — ${timing}`}
          >
            <strong>{target?.name ?? "Opponent"}</strong>
            <span>{timing}</span>
          </div>
        ) : (
          dead ? <span className="fight-state">Respawning…</span> :
          <span className={`fight-state-indicator ${state.toLowerCase()}`} role="img" aria-label={state} title={state} />
        )}
      </div>
      <div className="combat-buttons">
        {ORDER.map((stance, index) => (
          <button
            key={stance}
            className={`stance-button ${me.stance === stance ? "active" : ""}`}
            disabled={dead}
            aria-pressed={me.stance === stance}
            onClick={() => setStance(stance)}
            title={`${STANCE_NAMES[stance]} beats ${BEATS[stance]}`}
          >
            <img
              className="stance-icon"
              src={STANCE_IMAGES[stance]}
              alt=""
              draggable={false}
            />
            <span className="stance-button-copy">
              <span className="stance-name">{STANCE_NAMES[stance]}</span>
              <span className="stance-beats">beats {BEATS[stance]}</span>
            </span>
            <kbd>{index + 1}</kbd>
          </button>
        ))}
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
          ? "Read their stance before your next swing."
          : "Read their stance. Move into range. Pick your moment."}
      </p>
    </section>
  );
};
export default StanceHud;
