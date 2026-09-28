import React, { memo, useEffect, useRef, useState } from "react";
import ChatBox from "./ChatBox";
import Inventory from "./Inventory";
import AppearancePanel from "./AppearancePanel";
import CombatHud from "./CombatHud";
import { PUNCH_ICON } from "./itemUi";
import { isTyping } from "./keyboard";
import Toast from "./Toast";
import GoalChip from "./GoalChip";
import TickDebug from "./TickDebug";
import { PUNCH_DAMAGE, STICK_ITEM_ID, getItemDef } from "@sim";
import { useMyPlayer, usePlayers } from "../spacetime/hooks";

type Panel = "inventory" | "chat" | "help" | "appearance" | null;
const stick = getItemDef(STICK_ITEM_ID);
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
        <a className="agent-entry-link" href="/agent" target="_blank" rel="noreferrer" aria-label="Open BeriGame's agent onboarding page in a new tab">
          Agent
        </a>
      </nav>
      <GoalChip visible={panel === null} />
      <Inventory open={panel === "inventory"} onClose={close} />
      <ChatBox open={panel === "chat"} onClose={close} />
      <AppearancePanel open={panel === "appearance"} onClose={close} />
      {panel === "help" && (
        <section className="game-panel help-panel" aria-label="How to play">
          <header className="panel-heading">
            <div>
              <span className="eyebrow">An adventurer’s field guide</span>
              <h2>Gather. Arm up. Hold your ground.</h2>
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
              Harvest, or tap the goal at the top left. If a tree is regrowing
              or taken, you wait beside it and pick it when it ripens. Tap a
              berry in your quick bar to eat it and heal.
            </li>
            <li>
              <strong>Find a sturdy stick.</strong> Harvests sometimes turn up
              a sturdy stick (about 1 in 4). A stick lets you push through the
              brambles. Keep it in quick slot 1, 2 or 3 and press its key to
              wield it: it hits twice as hard as a punch.
            </li>
            <li>
              <strong>Push through the brambles.</strong> A thorny hedge rings
              the Grove. You need a stick to push out to the Coast, but you can
              always walk back in without one. Dying drops your bag, stick
              included.
            </li>
            <li>
              <strong>Pick your fights.</strong> Select another adventurer and
              choose Attack. You approach and swing automatically in range.
              Nobody can fight in the sandy safe ring at the centre, and you
              are safe for a moment after respawning, and as a newcomer until
              you find a stick, attack, or 3 minutes pass.
            </li>
          </ol>
          <div
            className="weapon-guide"
            aria-label={`Punch deals ${PUNCH_DAMAGE} damage. A wielded stick deals ${stick?.weaponDamage ?? 0} damage.`}
          >
            <div>
              <img src={PUNCH_ICON} alt="" />
              <strong>Punch</strong>
              <span>{PUNCH_DAMAGE} damage · always ready</span>
            </div>
            <div>
              <img src={stick?.icon} alt="" />
              <strong>{stick?.name ?? "Stick"}</strong>
              <span>{stick?.weaponDamage ?? 0} damage · found while harvesting</span>
            </div>
          </div>
          <p>
            <strong>Need space?</strong> Choose a new ground tile to move, or
            use Stop to cancel your current action. Everyone starts with the
            same abilities.
          </p>
          <p className="fine-print">
            Keyboard shortcuts are optional: 1 / 2 / 3 use your quick slots
            (berries there are eaten, a stick is wielded or put away), Esc
            stops, I opens your bag, Enter opens chat. Every action also has an
            on-screen control.
          </p>
          <a className="agent-help-link" href="/agent" target="_blank" rel="noreferrer">
            Open the agent-ready game page ↗
          </a>
        </section>
      )}
      <CombatHud quickKeysEnabled={panel !== "appearance"} />
      <Toast />
      {import.meta.env.DEV && <TickDebug />}
    </div>
  );
});
export default UIComponents;
