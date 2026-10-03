import { agentUrl } from '../site/siteUrls';
import React, { memo, useEffect, useRef, useState } from "react";
import ChatBox from "./ChatBox";
import Inventory from "./Inventory";
import CraftingPanel from "./CraftingPanel";
import AppearancePanel from "./AppearancePanel";
import CombatHud from "./CombatHud";
import HelpPanel from "./HelpPanel";
import { isTyping } from "./keyboard";
import Toast from "./Toast";
import GoalChip from "./GoalChip";
import SettingsPanel from "./SettingsPanel";
import Minimap from "./Minimap";
import TickDebug from "./TickDebug";
import FriendsPanel, { FriendSync, InviteRedeemer } from "./FriendsPanel";
import TradeWindow from "./TradeWindow";
import AdventurePanel, { AdventureHud, DuelHud } from "./AdventurePanel";
import { ADVENTURE_EVENT, ADVENTURE_VIEWS, type AdventureView } from "./adventureNavigation";
import SkillsPanel from "./SkillsPanel";
import MilestoneBanner from "./MilestoneBanner";
import "./skills.css";
import "./responsiveHud.css";
import "./inventory.css";
import { useMyPlayer, usePlayers } from "../spacetime/hooks";
import { useSettingsStore } from "../spacetime/stores/settingsStore";

import FrontierPanel, { type BuildDraft } from "../frontier/FrontierPanel";
import { FRONTIER_EVENT, type FrontierRequest } from "../frontier/navigation";

type Panel = "settlement" | "inventory" | "chat" | "help" | "appearance" | "settings" | "friends" | "skills" | "adventure" | "crafting" | "menu" | null;
/** Name and online count: the only part of the HUD shell that follows player rows. */
const WorldHeader = memo(({ coins }: { coins?: number }) => {
  const me = useMyPlayer();
  const players = usePlayers();
  return (
      <div className="world-header">
        <img src="/items/blueberry.png" alt="" />
        <div>
          <strong>BeriGame</strong>
          <span>
            {me?.name ?? "The first island"}{me?.region === "settlement" ? " · Meadows" : ""} ·{" "}
            {players.filter((player) => player.online).length} online
          </span>
          {coins !== undefined && <span>{coins} coins · {me?.hp} HP</span>}
        </div>
      </div>
  );
});

const UIComponents = memo(({ frontierEnabled = false, frontierCoins = 0, draft = null, onDraft = () => {} }: {
  frontierEnabled?: boolean; frontierCoins?: number; draft?: BuildDraft | null; onDraft?: (draft: BuildDraft | null) => void;
}) => {
  const me = useMyPlayer();
  const oneClickAttack = useSettingsStore(s => s.oneClickAttack);
  const inFrontier = !!me?.region && me.region !== 'bramblewild';
  const regionRef = useRef(inFrontier);
  regionRef.current = inFrontier;
  const [frontierRequest, setFrontierRequest] = useState<FrontierRequest & { id: number }>({ tab: 'Journal', id: 0 });
  const openFrontier = (request: FrontierRequest = { tab: 'Journal' }) => {
    setFrontierRequest(current => ({ ...request, id: current.id + 1 }));
    setPanel('settlement');
  };
  const [panel, setPanel] = useState<Panel>(null);
  const frontierPanelRef = useRef({ panel, tab: frontierRequest.tab });
  frontierPanelRef.current = { panel, tab: frontierRequest.tab };
  const [adventureRequest, setAdventureRequest] = useState({ view: 'hub' as AdventureView, id: 0 });
  useEffect(() => { if (panel !== null) onDraft(null); }, [panel]);
  const [quickSlotTarget, setQuickSlotTarget] = useState<number | null>(null);
  const [friendsRequest, setFriendsRequest] = useState({ id: 0, adding: false, search: '', playerHex: '' });
  const openFriends = (adding = false, search = '', playerHex = '') => {
    setFriendsRequest(previous => ({ id: previous.id + 1, adding, search, playerHex }));
    setPanel('friends');
  };
  const toolbar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const toggle = (next: Panel) => {
    if (regionRef.current && ['adventure', 'inventory', 'crafting', 'skills'].includes(next ?? '')) {
      const tab = next === 'inventory' ? 'Bag' : next === 'crafting' ? 'Craft' : next === 'skills' ? 'Skills' : 'Journal';
      if (frontierPanelRef.current.panel === "settlement" && frontierPanelRef.current.tab === tab) setPanel(null);
      else openFrontier({ tab });
      return;
    }
    if (next === 'inventory') setQuickSlotTarget(null);
    if (next === 'adventure') setAdventureRequest(current => ({ view: 'hub', id: current.id + 1 }));
    setPanel((current) => (current === next ? null : next));
  };
  const openBag = (slot?: number) => { setQuickSlotTarget(slot ?? null); setPanel('inventory'); };
  const close = () => {
    const previous = panel === "friends" ? "chat" : panel === "settlement" ? "adventure" : panel;
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
    const openAdventure = (event: Event) => {
      const requested = (event as CustomEvent<{ view?: AdventureView }>).detail?.view;
      const view = requested && ADVENTURE_VIEWS.includes(requested) ? requested : 'hub';
      setAdventureRequest(current => ({ view, id: current.id + 1 }));
      setPanel("adventure");
    };
    const openSettlements = (event: Event) => openFrontier((event as CustomEvent<FrontierRequest>).detail);
    window.addEventListener(FRONTIER_EVENT, openSettlements);
    window.addEventListener(ADVENTURE_EVENT, openAdventure);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener(FRONTIER_EVENT, openSettlements); window.removeEventListener("keydown", onKey); window.removeEventListener(ADVENTURE_EVENT, openAdventure); };
  }, []);
  return (
    <div className="ui-group" data-panel-open={panel !== null}>
      <WorldHeader coins={inFrontier ? frontierCoins : undefined} />
      <nav className="game-toolbar" aria-label="Game panels" ref={toolbar}>
        <button data-panel="adventure" aria-expanded={panel === "adventure" || (panel === "settlement" && frontierRequest.tab !== "Bag")} onClick={() => toggle("adventure")}>{inFrontier ? "Meadows" : "Adventure"}</button>
        <button
          data-panel="inventory"
          aria-expanded={panel === "inventory" || (panel === "settlement" && frontierRequest.tab === "Bag")}
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
          className="attack-mode-toggle"
          aria-label="One-click attack"
          aria-pressed={oneClickAttack}
          title="Click an attackable target to walk up and attack. Hold for options."
          onClick={() => useSettingsStore.getState().set({ oneClickAttack: !oneClickAttack })}
        >
          <span>1-click<span className="attack-mode-long-label"> attack</span></span>
          <span className="attack-mode-state">{oneClickAttack ? 'On' : 'Off'}</span>
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
          {frontierEnabled && <button onClick={() => openFrontier()}>Settlements</button>}
          <button data-panel="crafting" onClick={() => toggle('crafting')}>Craft <kbd>C</kbd></button>
          <button
            data-panel="skills"
            aria-expanded={panel === "appearance" || panel === "skills"}
            onClick={() => toggle("skills")}
          >
            {inFrontier ? 'Disciplines' : 'Skills & techniques'}
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
          <a className="agent-entry-link" href={agentUrl()} target="_blank" rel="noreferrer" aria-label="Open BeriGame's agent onboarding page in a new tab">
            Agent
          </a>
        </div>
      </nav>
      {frontierEnabled && <FrontierPanel draft={draft} onDraft={onDraft} open={panel === "settlement"} setOpen={open => setPanel(open ? "settlement" : null)} request={frontierRequest} onTab={tab => setFrontierRequest(current => ({ ...current, tab }))} showGoal={panel === null} />}
      <AdventurePanel onSettlements={frontierEnabled ? () => openFrontier() : undefined} key={adventureRequest.id} open={panel === "adventure"} initialView={adventureRequest.view} onClose={close} />
      {!inFrontier && <div className="world-objectives">
        <GoalChip visible={panel === null} />
        <DuelHud />
        <AdventureHud visible={panel === null} />
      </div>}
      <Inventory open={panel === "inventory"} onClose={close} onCraft={() => setPanel('crafting')} initialQuickSlot={quickSlotTarget} />
      <CraftingPanel open={panel === 'crafting'} onClose={close} />
      {/* Friends and invites live behind Chat (no new toolbar button). */}
      <ChatBox open={panel === "chat"} onClose={close} onOpenFriends={openFriends} />
      <FriendsPanel key={`friends-${friendsRequest.id}`} open={panel === "friends"} initialAdding={friendsRequest.adding} initialSearch={friendsRequest.search} initialPlayerHex={friendsRequest.playerHex} onClose={close} onOpenChat={() => setPanel("chat")} />
      <AppearancePanel open={panel === "appearance"} onClose={close} onSkills={() => setPanel("skills")} />
      <SkillsPanel open={panel === "skills"} onClose={close} onStyle={() => setPanel("appearance")} />
      <SettingsPanel open={panel === "settings"} onClose={close} recoveryEnabled={frontierEnabled} />
      {(!inFrontier || me?.region === "settlement") && <Minimap hidden={panel !== null} />}
      {panel === "help" && <HelpPanel onClose={close} />}
      {!inFrontier && <CombatHud quickKeysEnabled={panel === null} onOpenBag={openBag} />}
      <TradeWindow />
      <InviteRedeemer />
      <FriendSync />
      <Toast />
      {!inFrontier && <MilestoneBanner />}
      {import.meta.env.DEV && <TickDebug />}
    </div>
  );
});
export default UIComponents;
