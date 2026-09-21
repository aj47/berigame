import React, { memo, useEffect, useRef, useState } from "react";
import ChatBox from "./ChatBox";
import Inventory from "./Inventory";
import AppearancePanel from "./AppearancePanel";
import StanceHud, { isTyping, STANCE_IMAGES } from "./StanceHud";
import Toast from "./Toast";
import GatherShortcut from "./GatherShortcut";
import TickDebug from "./TickDebug";
import { Stance } from "@sim";
import { useMyPlayer, usePlayers } from "../spacetime/hooks";

type Panel = "inventory" | "chat" | "help" | "appearance" | null;
const UIComponents = memo(() => {
  const [panel, setPanel] = useState<Panel>(null);
  const toolbar = useRef<HTMLElement>(null);
  const me = useMyPlayer();
  const players = usePlayers();
  const toggle = (next: Panel) =>
    setPanel((current) => (current === next ? null : next));
  const close = () => {
    const previous = panel;
    setPanel(null);
    toolbar.current
      ?.querySelector<HTMLButtonElement>(`[data-panel="${previous}"]`)
      ?.focus();
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target)) {
        if (event.key === "Escape") (event.target as HTMLElement).blur();
        return;
      }
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey
      )
        return;
      if (event.key.toLowerCase() === "i") toggle("inventory");
      else if (event.key === "Enter") {
        // Preserve native activation for keyboard-focused controls.
        if (
          event.target instanceof Element &&
          event.target.closest(
            "button, a[href], summary, [role=button], [role=link]",
          )
        )
          return;
        event.preventDefault();
        setPanel("chat");
      } else if (event.key === "?" || event.key.toLowerCase() === "h")
        toggle("help");
      else if (event.key === "Escape") setPanel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="ui-group">
      <div className="world-header">
        <img src="/items/blueberry.png" alt="" />
        <div>
          <strong>BeriGame</strong>
          <span>
            {me?.name ?? "The first island"} ·{" "}
            {players.filter((player) => player.online).length} online
          </span>
        </div>
      </div>
      <nav className="game-toolbar" aria-label="Game panels" ref={toolbar}>
        <button
          data-panel="inventory"
          aria-expanded={panel === "inventory"}
          onClick={() => toggle("inventory")}
        >
          Bag <kbd>I</kbd>
        </button>
        <button
          data-panel="chat"
          aria-expanded={panel === "chat"}
          onClick={() => toggle("chat")}
        >
          Chat <kbd>↵</kbd>
        </button>
        <button
          data-panel="appearance"
          aria-expanded={panel === "appearance"}
          onClick={() => toggle("appearance")}
        >
          Style
        </button>
        <button
          data-panel="help"
          aria-expanded={panel === "help"}
          onClick={() => toggle("help")}
        >
          Help <kbd>?</kbd>
        </button>
      </nav>
      <GatherShortcut
        visible={panel === null}
        solo={players.filter((player) => player.online).length <= 1}
      />
      <Inventory open={panel === "inventory"} onClose={close} />
      <ChatBox open={panel === "chat"} onClose={close} />
      <AppearancePanel open={panel === "appearance"} onClose={close} />
      {panel === "help" && (
        <section className="game-panel help-panel" aria-label="How to play">
          <header className="panel-heading">
            <div>
              <span className="eyebrow">An adventurer’s field guide</span>
              <h2>Small moves. Smart reads.</h2>
            </div>
            <button
              className="close-button"
              onClick={close}
              aria-label="Close help"
            >
              ×
            </button>
          </header>
          <button
            className="reset-view-button"
            onClick={() =>
              window.dispatchEvent(new Event("berigame-camera-reset"))
            }
          >
            Reset view
          </button>
          <ol className="help-steps">
            <li>
              <strong>Find your footing.</strong> Tap or click the ground to
              move. Drag to look around; pinch or scroll to zoom.
            </li>
            <li>
              <strong>Gather supplies.</strong> Select a berry tree and choose
              Harvest, or use the Gather shortcut to find a ripe tree. Open your
              bag, select a berry, then Eat to heal.
            </li>
            <li>
              <strong>Read your opponent.</strong> Select another adventurer and
              choose Attack. You approach and attack automatically in range.
            </li>
            <li>
              <strong>Choose your answer.</strong> Change stance during the
              fight. Matching stances clash; the winning stance gains the upper
              hand.
            </li>
          </ol>
          <div
            className="rps-guide"
            aria-label="Strike beats Grab. Grab beats Guard. Guard beats Strike."
          >
            {[Stance.Strike, Stance.Grab, Stance.Guard].map((stance, index) => (
              <div key={stance}>
                <img src={STANCE_IMAGES[stance]} alt="" />
                <strong>{["Strike", "Grab", "Guard"][index]}</strong>
                <span>beats {["Grab", "Guard", "Strike"][index]}</span>
              </div>
            ))}
          </div>
          <p>
            <strong>Need space?</strong> Choose a new ground tile to move, or
            use Stop to cancel your current action. Everyone starts with the
            same abilities.
          </p>
          <p className="fine-print">
            Keyboard shortcuts are optional: 1 / 2 / 3 choose a stance, Esc
            stops, I opens your bag, Enter opens chat. Every action also has an
            on-screen control.
          </p>
        </section>
      )}
      <StanceHud />
      <Toast />
      {import.meta.env.DEV && <TickDebug />}
    </div>
  );
});
export default UIComponents;
