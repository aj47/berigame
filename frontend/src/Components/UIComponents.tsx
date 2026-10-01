import React, { memo, useEffect, useRef, useState } from "react";
import ChatBox from "./ChatBox";
import Inventory from "./Inventory";
import CraftingPanel from "./CraftingPanel";
import AppearancePanel from "./AppearancePanel";
import CombatHud from "./CombatHud";
import { PUNCH_ICON } from "./itemUi";
import { isTyping } from "./keyboard";
import Toast from "./Toast";
import GoalChip from "./GoalChip";
import SettingsPanel from "./SettingsPanel";
import Minimap from "./Minimap";
import TickDebug from "./TickDebug";
import FriendsPanel, { FriendSync, InviteRedeemer } from "./FriendsPanel";
import TradeWindow from "./TradeWindow";
import AdventurePanel, { AdventureHud, DuelHud } from "./AdventurePanel";
import SkillsPanel from "./SkillsPanel";
import MilestoneBanner from "./MilestoneBanner";
import "./skills.css";
import "./responsiveHud.css";
import "./inventory.css";
import { PUNCH_DAMAGE, STICK_ITEM_ID, getItemDef } from "@sim";
import { useMyPlayer, usePlayers } from "../spacetime/hooks";

type Panel = "inventory" | "chat" | "help" | "appearance" | "settings" | "friends" | "skills" | "adventure" | "crafting" | "menu" | null;
const stick = getItemDef(STICK_ITEM_ID);
/** Name and online count: the only part of the HUD shell that follows player rows. */
const WorldHeader = memo(() => {
  const me = useMyPlayer();
  const players = usePlayers();
  return (
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
  );
});

const UIComponents = memo(() => {
  const [panel, setPanel] = useState<Panel>(null);
  const [quickSlotTarget, setQuickSlotTarget] = useState<number | null>(null);
  const toolbar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const toggle = (next: Panel) => {
    if (next === 'inventory') setQuickSlotTarget(null);
    setPanel((current) => (current === next ? null : next));
  };
  const openBag = (slot?: number) => { setQuickSlotTarget(slot ?? null); setPanel('inventory'); };
  const close = () => {
    const previous = panel === "friends" ? "chat" : panel;
    setPanel(null);
    // Secondary controls disappear with the compact menu; return to its trigger.
    const secondary = ["menu", "skills", "appearance", "crafting", "help", "settings"].includes(previous ?? "");
    const target = secondary && menuButton.current?.getClientRects().length
      ? menuButton.current
      : toolbar.current?.querySelector<HTMLButtonElement>(`[data-panel="${previous}"]`);
    target?.focus();
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (panel !== 'menu') return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !toolbar.current?.contains(event.target)) setPanel(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [panel]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('[data-character-creator]')) return;
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
      else if (event.key.toLowerCase() === "o") toggle("settings");
      else if (event.key.toLowerCase() === "k") toggle("skills");
      else if (event.key.toLowerCase() === "c") toggle("crafting");
      else if (event.key === "Escape") closeRef.current();
    };
    const openAdventure = () => setPanel("adventure");
    window.addEventListener("berigame-adventure", openAdventure);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("berigame-adventure", openAdventure); };
  }, []);
  return (
    <div className="ui-group" data-panel-open={panel !== null}>
      <WorldHeader />
      <nav className="game-toolbar" aria-label="Game panels" ref={toolbar}>
        <button data-panel="adventure" aria-expanded={panel === "adventure"} onClick={() => toggle("adventure")}>Adventure</button>
        <button
          data-panel="inventory"
          aria-expanded={panel === "inventory"}
          onClick={() => toggle("inventory")}
        >
          Bag <kbd>I</kbd>
        </button>
        <button
          data-panel="chat"
          aria-expanded={panel === "chat" || panel === "friends"}
          onClick={() => setPanel((current) => (current === "chat" || current === "friends" ? null : "chat"))}
        >
          Chat <kbd>↵</kbd>
        </button>
        <button
          className="toolbar-menu-toggle"
          data-panel="menu"
          ref={menuButton}
          aria-expanded={panel === "menu"}
          aria-controls="game-menu"
          data-active={["menu", "skills", "appearance", "crafting", "help", "settings"].includes(panel ?? "")}
          onClick={() => toggle("menu")}
        >
          <span aria-hidden="true">☰</span> Menu
        </button>
        <div id="game-menu" className={`toolbar-secondary ${panel === "menu" ? "is-open" : ""}`} hidden={panel !== 'menu'} role="group" aria-label="More game panels">
          <button data-panel="crafting" onClick={() => toggle('crafting')}>Craft <kbd>C</kbd></button>
          <button
            data-panel="skills"
            aria-expanded={panel === "appearance" || panel === "skills"}
            onClick={() => setPanel((current) => (current === "appearance" || current === "skills" ? null : "skills"))}
          >
            Skills
          </button>
          <button data-panel="appearance" aria-expanded={panel === "appearance"} onClick={() => toggle("appearance")}>Character</button>
          <button
            data-panel="help"
            aria-expanded={panel === "help"}
            onClick={() => toggle("help")}
          >
            Help <kbd>?</kbd>
          </button>
          <button
            data-panel="settings"
            aria-expanded={panel === "settings"}
            aria-label="Settings (O)"
            onClick={() => toggle("settings")}
          >
            <span aria-hidden="true" className="toolbar-gear">⚙</span>
            <span className="toolbar-label">Settings</span> <kbd>O</kbd>
          </button>
          <a className="agent-entry-link" href="/agent" target="_blank" rel="noreferrer" aria-label="Open BeriGame's agent onboarding page in a new tab">
            Agent
          </a>
        </div>
      </nav>
      <AdventurePanel open={panel === "adventure"} onClose={close} />
      <div className="world-objectives">
        <GoalChip visible={panel === null} />
        <DuelHud />
        <AdventureHud visible={panel === null} />
      </div>
      <Inventory open={panel === "inventory"} onClose={close} onCraft={() => setPanel('crafting')} initialQuickSlot={quickSlotTarget} />
      <CraftingPanel open={panel === 'crafting'} onClose={close} />
      {/* Friends and invites live behind Chat (no new toolbar button). */}
      <ChatBox open={panel === "chat"} onClose={close} onOpenFriends={() => setPanel("friends")} />
      <FriendsPanel open={panel === "friends"} onClose={close} onOpenChat={() => setPanel("chat")} />
      <AppearancePanel open={panel === "appearance"} onClose={close} onSkills={() => setPanel("skills")} />
      <SkillsPanel open={panel === "skills"} onClose={close} onStyle={() => setPanel("appearance")} />
      <SettingsPanel open={panel === "settings"} onClose={close} />
      <Minimap hidden={panel !== null} />
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
              move, or hold your finger down to keep walking toward it. Drag to
              look around; pinch or scroll to zoom. Press and hold anything to
              see what you can do with it.
            </li>
            <li>
              <strong>Gather supplies.</strong> Select a berry tree and choose
              Harvest, or tap the goal at the top left. If a tree is regrowing
              or taken, you wait beside it and pick it when it ripens. Tap a
              berry in your quick bar to eat it and heal.
            </li>
            <li>
              <strong>Find a sturdy stick.</strong> Reach Foraging level 2 (four berry harvests) to receive
              your first stick. Later harvests have a 25% chance to find extras. A stick lets you push through the
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
              <strong>Make a stone club.</strong> On the Coast, gather
              driftwood from the piles past each path and flint from the tide
              rocks in the corners. With 1 driftwood and 2 flint, tap the goal
              (or open Craft from Menu) for a stone club: it hits for 8.
            </li>
            <li>
              <strong>Grow your skills.</strong> Picking berries trains
              Foraging, gathering on the Coast trains Beachcombing and making
              things trains Crafting (Skills, or K). Levels unlock
              recipes, keepsakes to wear and slightly faster harvests — never
              damage or health.
            </li>
            <li>
              <strong>Tend your garden.</strong> Tap a soil plot on the garden
              terrace just north-west of the safe ring and plant a berry. It
              grows while you are away (greenberry 2 h, goldberry 8 h) and gives
              back more; ripe berries wait for you.
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
            stops, I opens your bag, K opens your skills, C opens crafting, Enter opens chat, O opens settings. Every action also has an
            on-screen control.
          </p>
          <a className="agent-help-link" href="/agent" target="_blank" rel="noreferrer">
            Open the agent-ready game page ↗
          </a>
        </section>
      )}
      <CombatHud quickKeysEnabled={panel === null} onOpenBag={openBag} />
      <TradeWindow />
      <InviteRedeemer />
      <FriendSync />
      <Toast />
      <MilestoneBanner />
      {import.meta.env.DEV && <TickDebug />}
    </div>
  );
});
export default UIComponents;
