import React, { useEffect, useRef, useState } from "react";
import { useFrontier } from "./useFrontier";
import { useInventoryRows, useMyPlayer, usePlayers, useNow } from "../spacetime/hooks";
import { useGameActions } from "../spacetime/actions";
import { getItemDef, levelForXp } from "@sim";
import {
  DISCIPLINE_PERKS,
  DISCIPLINES,
  FRONTIER,
  PIECES,
  PORTS,
  type Point,
} from "../../../shared/sim/frontier/catalog";
import type { Command } from "../../../shared/sim/frontier/engine";
import "./frontier.css";
import type { FrontierRequest } from "./navigation";
import { useSettingsStore } from "../spacetime/stores/settingsStore";
import HideGuidanceButton from "../Components/HideGuidanceButton";
import { deadlineLabel, defaultPlot, missingMaterials, plotName, unlockHint } from "./panelModel";
import { wikiUrl } from "../site/siteUrls";
import { isHomeRegion } from "../../../shared/sim/frontier/homeMap";
import { renewalPrice } from "../../../shared/sim/frontier/model";
import { BUILDING_SIDES } from "../../../shared/sim/frontier/building";
import { previewIssue } from "./preview";
export type BuildDraft = {
  plot: string;
  moving?: string;
  valid?: boolean;
  reason?: string;
  piece: string;
  rotation: number;
  point?: Point;
};
const cost = (items: Record<string, number>) =>
  Object.entries(items)
    .map(([k, v]) => `${v} ${getItemDef(k)?.name ?? k}`)
    .join(" · ");
const when = (n: number) => new Date(n).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const tabTitles: Record<FrontierRequest["tab"], string> = {
  Journal: "Quests", Land: "Your land", Build: "Build", Craft: "Craft",
  Wildlife: "Wildlife", Skills: "Disciplines", Harbour: "Sailing", Bag: "Bag", Storage: "Storage & trade",
};
const primaryTabs = ["Journal", "Land", "Craft"] as const;
const moreTabs = ["Wildlife", "Skills", "Harbour", "Bag", "Storage"] as const;
export default function FrontierPanel({
  draft,
  onDraft,
  open,
  setOpen,
  request,
  showGoal,
  onTab,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  request: FrontierRequest & { id: number };
  showGoal: boolean;
  onTab: (tab: FrontierRequest["tab"]) => void;
  draft: BuildDraft | null;
  onDraft: (d: BuildDraft | null) => void;
}) {
  const state = useFrontier(),
    me = useMyPlayer(),
    inventory = useInventoryRows(),
    players = usePlayers(),
    actions = useGameActions();
  const showGuidance = useSettingsStore(s => s.showGuidance);
  const now = useNow(60_000);
  const ordersRef = useRef<HTMLDetailsElement>(null);
  const tab = request.tab,
    setTab = onTab;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(""),
    [helper, setHelper] = useState(""),
    [mask, setMask] = useState(1),
    [choice, setChoice] = useState<number[]>([]),
    [storage, setStorage] = useState(""),
    [quantity, setQuantity] = useState(1);
  useEffect(() => {
    if (request.plot) setSelected(request.plot);
  }, [request]);
  if (!state.enabled || !me) return null;
  const id = me.identity.toHexString(),
    region = me.region || "bramblewild",
    profile = state.profile,
    myPlot = state.plots.find((p) => p.claim?.owner === id),
    plot = defaultPlot(state.plots, { ...me, region }, id, selected),
    myBoat = state.boats.find((b) => b.owner === id),
    aboard = state.boats.find((b) => b.crew.includes(id));
  const activeQuest = state.quests.find((q) => q.available && !q.complete),
    selectedContainer = state.containers.find((c) => c.id === storage),
    bag = inventory.filter((row) => row.owner.toHexString() === id);
  const canBuild = !!plot?.claim && (plot.claim.owner === id || !!((plot.claim.permissions[id] ?? 0) & 1));
  const plotRegion = isHomeRegion(region) ? "settlement" : region;
  const visiblePlots = state.plots.filter(p => p.region === plotRegion);
  const canWalkTo = (destination: string) => destination === region || (isHomeRegion(destination) && isHomeRegion(region));
  const walkTo = (point: Point, destination = region) => isHomeRegion(destination) && isHomeRegion(region)
    ? run({ action: "walk", id: destination, ...point })
    : destination === region ? go(point) : undefined;
  const claimPrice = FRONTIER.deed + FRONTIER.taxes[0];
  const claimUnlocked = profile.quests.includes("tools");
  const materialHint = (inputs: Record<string, number>) => {
    const missing = missingMaterials(inputs, bag);
    return Object.keys(missing).length ? `Need ${cost(missing)}` : "";
  };
  const materials = (inputs: Record<string, number>) => <span className="frontier-materials">
    {Object.entries(inputs).map(([item, required]) => {
      const held = bag.reduce((total, row) => total + (row.itemId === item ? row.quantity : 0), 0);
      return <small key={item} data-enough={held >= required} title={`${held} held, ${required} needed`}>
        {getItemDef(item)?.name ?? item} · {held}/{required}
      </small>;
    })}
  </span>;
  const questReady = !!activeQuest && (activeQuest.handIn
    ? !materialHint(activeQuest.handIn) && (activeQuest.id !== "cinder" || profile.discoveries.includes("cinder"))
    : activeQuest.progress >= activeQuest.amount);
  const atSteward = region === "settlement" && Math.max(Math.abs(me.x - 31), Math.abs(me.z - 64)) <= 4;
  const questDestination = isHomeRegion(region) ? { ...state.regions.settlement.spawn, region: "settlement" } : PORTS.find(port => port.region === region);
  const atQuestGiver = atSteward
    || PORTS.some(port => port.region === region && Math.max(Math.abs(me.x - port.x), Math.abs(me.z - port.z)) <= 4);
  const pieces = Object.entries(PIECES);
  const pieceHint = (piece: typeof PIECES[string]) => unlockHint(profile, piece) || materialHint(piece.cost);
  const shelterPieces = new Set(['floor', 'wall', 'door', 'roof']);
  const visiblePieces = pieces.filter(([key, piece]) => shelterPieces.has(key) || !pieceHint(piece));
  const laterPieces = pieces.filter(([key, piece]) => !shelterPieces.has(key) && !!pieceHint(piece));
  async function run(command: Command) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await actions.frontier(command);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const go = (point: Point) =>
    region === "bramblewild"
      ? actions.setTarget(point.x, point.z)
      : run({ action: "move", ...point });
  const button = (label: string, command: Command, disabled = false) => (
    <button disabled={busy || disabled} onClick={() => void run(command)}>
      {label}
    </button>
  );
  const permissionEditor = (boat = false) => (
    <div className="frontier-controls">
      <select
        aria-label="Trusted character"
        value={helper}
        onChange={(e) => setHelper(e.target.value)}
      >
        <option value="">Choose a character</option>
        {players
          .filter((p) => p.identity.toHexString() !== id)
          .map((p) => (
            <option
              key={p.identity.toHexString()}
              value={p.identity.toHexString()}
            >
              {p.name}
            </option>
          ))}
      </select>
      <select
        aria-label="Permission"
        value={mask}
        onChange={(e) => setMask(Number(e.target.value))}
      >
        <option value={0}>Revoke access</option>
        <option value={1}>{boat ? "Board" : "Build"}</option>
        <option value={boat ? 3 : 2}>
          {boat ? "Board and pilot" : "Storage"}
        </option>
        <option value={boat ? 5 : 4}>
          {boat ? "Board and cargo" : "Pay upkeep"}
        </option>
        <option value={7}>All permissions</option>
      </select>
      {button(
        "Save access",
        {
          action: boat ? "boat_permit" : "permit",
          id: boat ? myBoat?.id : plot?.id,
          target: helper,
          permissions: mask,
        },
        !helper,
      )}
    </div>
  );
  const renderPiece = ([key, piece]: typeof pieces[number]) => (
    <button key={key} disabled={!canBuild || !!pieceHint(piece)} onClick={() => {
      onDraft({ plot: plot!.id, piece: key, rotation: 0 });
      setOpen(false);
    }}>
      <strong>{piece.name}</strong>
      {materials(piece.cost)}
      {unlockHint(profile, piece) && <small>{unlockHint(profile, piece)}</small>}
    </button>
  );
  return (
    <>
      {region !== "bramblewild" && showGoal && showGuidance && !draft && activeQuest && (
        <div className="frontier-goal">
        <button
          className="frontier-goal-action"
          onClick={() => {
            setTab("Journal");
            setOpen(true);
          }}
        >
          <small>NEXT QUEST</small>
          {activeQuest.title}
          <span>{activeQuest.text}</span>
        </button>
        <HideGuidanceButton />
        </div>
      )}
      {draft && (
        <div className="frontier-build-confirm">
          <strong>{PIECES[draft.piece]?.name}</strong>
          {draft.moving ? <span>Moving this piece uses no materials.</span> : materials(PIECES[draft.piece].cost)}
          <p>
            {draft.point
              ? `Place at ${draft.point.x}, ${draft.point.z}${PIECES[draft.piece]?.edge ? ` · ${BUILDING_SIDES[draft.rotation]} side` : ''}`
              : "Tap the ground to preview."}
          </p>
          <button
            onClick={() => {
              const next = { ...draft, rotation: (draft.rotation + 1) % 4 };
              const reason = previewIssue(state, next, players);
              onDraft({ ...next, valid: !reason, reason });
            }}
          >
            Rotate ↻
          </button>
          <button
            disabled={!draft.point || draft.valid === false || busy}
            onClick={async () => {
              if (
                draft.point &&
                (await actions.frontier({
                  action: draft.moving ? "move_building" : "build",
                  id: draft.moving ?? draft.plot,
                  item: draft.piece,
                  ...draft.point,
                  rotation: draft.rotation,
                }))
              )
                onDraft(null);
            }}
          >
            {draft.moving ? "Move here" : "Build here"}
          </button>
          {draft.reason && <p role="status">{draft.reason}</p>}
          <button onClick={() => onDraft(null)}>Cancel</button>
        </div>
      )}
      {open && (
        <section className="frontier-panel game-panel" aria-label="Settlements">
          <header className="panel-heading">
            <h2>{tabTitles[tab]}</h2>
            <span className="frontier-balance">{profile.coins} coins</span>
            <button className="close-button" aria-label="Close settlements" onClick={() => setOpen(false)}>×</button>
          </header>
          <nav aria-label="Settlement activities">
            {primaryTabs.map(t => (
              <button key={t} aria-pressed={tab === t || (t === "Land" && tab === "Build")} onClick={() => setTab(t)}>
                {tabTitles[t]}
              </button>
            ))}
            <select aria-label="More activities" value={moreTabs.includes(tab as typeof moreTabs[number]) ? tab : ""}
              onChange={e => { if (e.target.value) setTab(e.target.value as FrontierRequest["tab"]); }}>
              <option value="" disabled>More…</option>
              {moreTabs.map(t => <option key={t} value={t}>{tabTitles[t]}</option>)}
            </select>
          </nav>
          <div className="frontier-content" key={tab}>
            {error && <p role="alert">{error}</p>}
            {region === "bramblewild" && tab === "Journal" && (
              <article>
                <h3>Meet your neighbours</h3>
                <p>Follow the east harbour trail to the Meadows. The steward will help you earn your first home.</p>
                {button("Walk to Meadows town", { action: "enter" })}
              </article>
            )}
            {tab === "Journal" && (
              <>
                <article className="frontier-feature">
                  <small>NEXT QUEST</small>
                  <h3>
                    {activeQuest?.title ?? "The islands are yours to explore"}
                  </h3>
                  <p>
                    {activeQuest?.text ??
                      "Build, trade, tame creatures and keep your land funded."}
                  </p>
                  {activeQuest && (
                    <>
                      <div className="frontier-stats">
                        <span>
                          {activeQuest.handIn ? cost(activeQuest.handIn) : `${activeQuest.progress}/${activeQuest.amount} complete`}
                        </span>
                        <span>+{activeQuest.coins} coins</span>
                      </div>
                      <progress
                        aria-label={`${activeQuest.title} progress`}
                        value={activeQuest.handIn ? (questReady ? activeQuest.amount : 0) : activeQuest.progress}
                        max={activeQuest.amount}
                      />
                      {questReady && <>
                        {!atQuestGiver && (questDestination ? <button onClick={() => void walkTo(questDestination, questDestination.region)}>{isHomeRegion(region) ? "Return to the steward" : "Walk to the port"}</button> : <p className="frontier-hint">Dock at a port to finish this quest.</p>)}
                        {button(activeQuest.handIn ? `Deliver · ${activeQuest.coins} coins` : activeQuest.coins ? `Collect ${activeQuest.coins} coins` : "Complete quest", { action: "quest", id: activeQuest.id }, !atQuestGiver)}
                      </>}
                    </>
                  )}
                  {activeQuest && !questReady && (
                    <div className="frontier-controls">
                      {activeQuest.id === "steward" ? <>
                        {atSteward ? button("Talk to the steward", { action: "talk", id: "steward" }) : <button disabled={!isHomeRegion(region)} onClick={() => void walkTo(state.regions.settlement.spawn, "settlement")}>Walk to the steward</button>}
                      </> : activeQuest.id === "order" ? <button onClick={() => { if (ordersRef.current) { ordersRef.current.open = true; ordersRef.current.querySelector("summary")?.focus(); } }}>View supply orders</button>
                        : activeQuest.id === "shipwright" ? <button onClick={() => setTab("Harbour")}>Visit the shipwright</button>
                        : <button onClick={() => setTab(
                        ["deed", "upkeep"].includes(activeQuest.id) ? "Land" : ["shelter", "stable"].includes(activeQuest.id) ? "Build" : ["observe", "tame"].includes(activeQuest.id) ? "Wildlife" : "Craft"
                      )}>{["deed", "upkeep"].includes(activeQuest.id) ? "Find your home" : ["shelter", "stable"].includes(activeQuest.id) ? "Choose a building piece" : ["observe", "tame"].includes(activeQuest.id) ? "Find wildlife" : "Open workshop"}</button>}
                    </div>
                  )}
                </article>
                <details ref={ordersRef}>
                  <summary>Earn coins · supply orders</summary>
                  <p className="frontier-hint">Deliver to the steward. 10 coins each, up to 60 daily.</p>
                  {state.orders.map(o => <article className="frontier-row" key={o.id}>
                    <strong>{cost(o.inputs)}</strong>
                    {button("Deliver · 10 coins", { action: "order", id: o.id }, !!materialHint(o.inputs))}
                  </article>)}
                </details>
                <details>
                  <summary>
                    All quests · {state.quests.filter((q) => q.complete).length}
                    /{state.quests.length}
                  </summary>
                  {state.quests.map((q) => (
                    <p key={q.id}>
                      {q.complete ? "✓" : q.available ? "→" : "○"} {q.title}
                    </p>
                  ))}
                </details>
                {profile.notes.length > 0 && (
                  <details>
                    <summary>
                      Notices · {Math.min(profile.notes.length, 5)}
                    </summary>
                    {profile.notes.slice(-5).map((n, i) => (
                      <p key={i}>{n}</p>
                    ))}
                  </details>
                )}
              </>
            )}
            {tab === "Land" && (
              <>
                {plot ? <article className="frontier-feature">
                  <small>{plot.claim?.owner === id ? "YOUR HOME" : !plot.claim ? "AVAILABLE LAND" : "HOMESTEAD"}</small>
                  <h3>{plotName(plot)}</h3>
                  <p className="frontier-hint">{plot.claim ? FRONTIER.sizes[plot.claim.tier] : 8} × {plot.claim ? FRONTIER.sizes[plot.claim.tier] : 8} tiles · {plot.claim?.owner === id ? "Yours to build on" : plot.status}</p>
                  <div className="frontier-controls">
                    <button disabled={!canWalkTo(plot.region)} onClick={() => void walkTo(plot.marker, plot.region)}>Walk to plot</button>
                    {canBuild && <button onClick={() => setTab("Build")}>Build on this plot</button>}
                  </div>
                  {!plot.claim && <>
                    <p><strong>{claimPrice} coins</strong> · includes your first week</p>
                    {myPlot ? <p className="frontier-hint">You already have a home. You can own one plot at a time.</p>
                      : !claimUnlocked ? <>
                        <p className="frontier-hint">Complete the steward’s first three quests to earn your deed.</p>
                        <button onClick={() => setTab("Journal")}>Continue quests</button>
                      </> : profile.coins < claimPrice ? <>
                        <p className="frontier-hint">Earn {claimPrice - profile.coins} more coins to claim this plot.</p>
                        <button onClick={() => setTab("Journal")}>Earn coins</button>
                      </> : button(`Claim · ${claimPrice} coins`, { action: "claim", id: plot.id })}
                    <details><summary>How ownership works</summary>
                      <p>After the first week, upkeep costs {FRONTIER.taxes[0]} coins per week. Unpaid plots have three days’ grace before another player can challenge ownership.</p>
                    </details>
                  </>}
                  {plot.claim && <>
                    {plot.claim.owner === id || !!((plot.claim.permissions[id] ?? 0) & 4) ? <>
                      <p>Upkeep paid through {deadlineLabel(plot.claim.paidUntil, now)}.</p>
                      {button(`Pay a week · ${renewalPrice(plot.claim, now, 1)} coins`, { action: "tax", id: plot.id, quantity: 1 }, profile.coins < renewalPrice(plot.claim, now, 1))}
                      {profile.coins < renewalPrice(plot.claim, now, 1) && <p className="frontier-hint">Need {renewalPrice(plot.claim, now, 1) - profile.coins} more coins. <button onClick={() => { setTab("Journal"); requestAnimationFrame(() => { if (ordersRef.current) ordersRef.current.open = true; }); }}>View supply orders</button></p>}
                    </> : <p className="frontier-hint">Owned by {players.find(p => p.identity.toHexString() === plot.claim!.owner)?.name ?? "another neighbour"}.</p>}
                    {plot.claim.challenge && <p role="status">Ownership is being challenged. Capture opens {when(plot.claim.challenge.opens)}. Pay overdue upkeep before capture to keep your home.</p>}
                    <details><summary>Manage plot</summary>
                      <p className="frontier-hint">{plot.status} · Grace ends {when(plot.claim.paidUntil + FRONTIER.grace)}.</p>
                      {plot.claim.owner === id ? <>
                        {button(plot.claim.tier === 2 ? "Fully expanded" : `Expand · from ${FRONTIER.upgradeCoins[plot.claim.tier]} coins`, { action: "upgrade", id: plot.id }, plot.claim.tier === 2)}
                        {plot.claim.tier < 2 && <p className="frontier-hint">Also needs {plot.claim.tier === 0 ? "10 planks and 10 stone" : "20 planks and 20 bricks"}. Prepaid upkeep is adjusted for the larger plot.</p>}
                        <h4>Give someone access</h4>
                        {permissionEditor()}
                        {button("Abandon empty plot", { action: "abandon", id: plot.id })}
                      </> : button("Announce capture challenge", { action: "challenge", id: plot.id }, plot.status !== "vulnerable")}
                      {plot.claim.challenge && <>
                        <p className="frontier-hint">Joining either side enables contest combat.</p>
                        {button("Join defense", { action: "join_contest", id: plot.id, target: "defend" })}
                        {button("Join attackers", { action: "join_contest", id: plot.id, target: "attack" })}
                        <select value={helper} onChange={e => setHelper(e.target.value)} aria-label="Invite attacker">
                          <option value="">Choose a helper</option>
                          {players.filter(p => p.identity.toHexString() !== id).map(p => <option key={p.identity.toHexString()} value={p.identity.toHexString()}>{p.name}</option>)}
                        </select>
                        {button("Invite attacker", { action: "invite_contest", id: plot.id, target: helper }, !helper)}
                      </>}
                    </details>
                  </>}
                </article> : <p>Land becomes available when you reach an island.</p>}
                <details>
                  <summary>Browse other plots</summary>
                  <label>Choose a plot nearby
                    <select aria-label="Plot" value={visiblePlots.some(p => p.id === plot?.id) ? plot!.id : ""} onChange={e => { setSelected(e.target.value); }}>
                      <option value="" disabled>Choose a plot</option>
                      {visiblePlots.map(p => <option key={p.id} value={p.id}>{plotName(p)} · {p.claim?.owner === id ? "your home" : p.status}</option>)}
                    </select>
                  </label>
                  {myPlot && myPlot.id !== plot?.id && <button onClick={() => setSelected(myPlot.id)}>Show my home</button>}
                </details>

              </>
            )}
            {tab === "Build" && (
              <>
                <div className="frontier-subnav"><button onClick={() => setTab("Land")}>← Your land</button>{plot && <span>{plotName(plot)}</span>}</div>
                {!canBuild ? <article>
                  <h3>Start with a place of your own</h3>
                  <p>Claim a plot, or ask a neighbour for building access.</p>
                  <button onClick={() => setTab("Land")}>Find a plot</button>
                </article> : <>
                  <p>Choose a piece, then tap your plot to place it. Walls, doors and fences snap to the nearest tile side; rotate to choose another side.</p>
                  <p className="frontier-hint">Materials show what you have / what you need.</p>
                  <div className="frontier-grid">{visiblePieces.map(renderPiece)}</div>
                  {!pieces.some(([, piece]) => !pieceHint(piece)) && <article>
                    <h3>Gather building materials</h3>
                    <p>Gather timber for floors and walls, plus fibre for a thatched roof.</p>
                    <button onClick={() => setTab("Craft")}>Find materials</button>
                  </article>}
                  {laterPieces.length > 0 && <details><summary>More building pieces · {laterPieces.length}</summary><div className="frontier-grid">{laterPieces.map(renderPiece)}</div></details>}
                </>}
                {state.buildings.some(b => b.claim === plot?.id) && <h3>Placed pieces</h3>}
                {state.buildings
                  .filter((b) => b.claim === plot?.id)
                  .map((b) => (
                    <article key={b.id}>
                      <strong>
                        {PIECES[b.piece].name} · {b.x},{b.z}
                      </strong>
                      <button
                        onClick={() => {
                          onDraft({
                            plot: b.claim,
                            piece: b.piece,
                            moving: b.id,
                            rotation: b.rotation,
                          });
                          setOpen(false);
                        }}
                      >
                        Move
                      </button>
                      {button("Dismantle · 75% materials", {
                        action: "dismantle",
                        id: b.id,
                      })}
                      {b.piece === "planter" && (
                        <>
                          {button("Plant carrot seed", {
                            action: "plant",
                            id: b.id,
                          })}
                          {button("Harvest", {
                            action: "harvest_crop",
                            id: b.id,
                          })}
                        </>
                      )}
                    </article>
                  ))}
              </>
            )}
            {tab === "Wildlife" && (
              <>
                {state.creatures
                  .filter((c) => c.region === region || c.owner === id)
                  .map((c) => (
                    <article key={c.id}>
                      <h3>
                        {state.species.find((s) => s.id === c.species)?.name}
                        {c.owner === id ? " · your companion" : ""}
                      </h3>
                      <p>
                        {state.species.find((s) => s.id === c.species)?.hint}
                      </p>
                      <small>
                        {c.region} · {c.x},{c.z}
                      </small>
                      <div className="frontier-controls">
                        <button
                          disabled={c.region !== region}
                          onClick={() => void go(c)}
                        >
                          Approach
                        </button>
                        {button("Observe", { action: "observe", id: c.id })}
                        {!c.owner &&
                          c.species !== "bristleback" &&
                          button("Offer feed", { action: "tame", id: c.id })}
                        {c.owner === id && (
                          <>
                            {button("Train", { action: "train", id: c.id })}
                            {button("Call companion", {
                              action: "companion",
                              id: c.id,
                            })}
                            {button("Use ability", { action: "ability" })}
                          </>
                        )}
                        {c.species === "bristleback" &&
                          button("Attack", { action: "attack", id: c.id })}
                      </div>
                    </article>
                  ))}
              </>
            )}
            {tab === "Skills" && (
              <>
                <p>Choose two active disciplines to use their perks. All five keep earning XP.</p>
                <details><summary>How disciplines relate to skills</summary>
                  <p>Skills &amp; techniques tracks island gathering and camp abilities. Disciplines track Meadows activities and can improve combat, crafting and companions.</p>
                  <p>Your existing skill and adventure XP gives disciplines a starting boost the first time you use a Meadows activity. After that, their XP grows separately.</p>
                  <a href={wikiUrl('frontier-disciplines')} target="_blank" rel="noreferrer">Discipline guide ↗</a>
                </details>
                {DISCIPLINES.map((name, i) => (
                  <article key={name}>
                    <div className="frontier-row">
                      <div>
                        <h3>{name}</h3>
                        <div className="frontier-stats">
                          <span>Lv. {levelForXp(profile.xp[i])}</span>
                          <span>{profile.xp[i]} XP</span>
                          {profile.active.includes(i) && (
                            <span className="frontier-active">Active</span>
                          )}
                        </div>
                      </div>
                      <button
                        aria-pressed={choice.includes(i)}
                        onClick={() =>
                          setChoice(
                            choice.includes(i)
                              ? choice.filter((n) => n !== i)
                              : choice.length < 2
                                ? [...choice, i]
                                : choice,
                          )
                        }
                      >
                        {choice.includes(i) ? "Selected" : "Select"}
                      </button>
                    </div>
                    <details>
                      <summary>Abilities</summary>
                      <ul>
                        {DISCIPLINE_PERKS[i].map((perk) => (
                          <li key={perk}>{perk}</li>
                        ))}
                      </ul>
                    </details>
                  </article>
                ))}
                {button(
                  profile.active.length
                    ? "Activate pair · 20 coins"
                    : "Activate pair · free",
                  { action: "specialize", disciplines: choice },
                  choice.length !== 2,
                )}
                <p>
                  {choice.length}/2 selected · Change in town, once per 24
                  hours.
                </p>
                {button("Survey a region cache", { action: "survey" })}
                {button("Brace against creatures", { action: "brace" })}
              </>
            )}
            {tab === "Harbour" && (
              <>
                <article>
                  <h3>Your first skiff</h3>
                  <p>Assemble at Driftwood Harbour (46,29).</p>
                  <div className="frontier-stats">
                    <span>1 hull + 1 sail</span>
                    <span>4 crew</span>
                    <span>12 cargo slots</span>
                  </div>
                  {region === "bramblewild" && (
                    <button onClick={() => void actions.setTarget(46, 29)}>
                      Walk to harbour
                    </button>
                  )}
                  {button("Meet shipwright", {
                    action: "talk",
                    id: "shipwright",
                  })}
                  {button("Assemble skiff", { action: "boat" })}
                </article>
                {state.boats
                  .filter((b) => b.owner === id || b.region === region)
                  .map((b) => (
                    <article key={b.id}>
                      <h3>{b.id}</h3>
                      <p>
                        {b.crew.length}/4 aboard · {b.region}
                      </p>
                      {button("Board", { action: "board", id: b.id })}
                      {b.owner === id && (
                        <details>
                          <summary>Crew permissions</summary>
                          {permissionEditor(true)}
                        </details>
                      )}
                    </article>
                  ))}
                {aboard && (
                  <article>
                    <h3>Aboard {aboard.id}</h3>
                    {button("Take helm", { action: "pilot" })}
                    {button("Disembark", { action: "disembark" })}
                    <p>Pick a port or tap the sea to steer.</p>
                    {PORTS.map((port) => (
                      <div key={port.region}>
                        <strong>{state.regions[port.region].name}</strong>
                        {button("Sail", {
                          action: "sail",
                          ...port.sea,
                        })}
                        {button("Dock", { action: "dock", id: port.region })}
                      </div>
                    ))}
                  </article>
                )}
              </>
            )}
            {tab === "Storage" && (
              <>
                <button onClick={() => setTab("Bag")}>Open bag</button>
                <p className="frontier-hint">Arrange, eat and equip items from your bag. Use this panel to move supplies into storage or trade.</p>
                <details>
                  <summary>Trade nearby</summary>
                  {players
                    .filter(
                      (p) =>
                        p.online &&
                        p.region === region &&
                        p.identity.toHexString() !== id,
                    )
                    .map((p) => (
                      <button
                        key={p.identity.toHexString()}
                        onClick={() => void actions.requestTrade(p.identity)}
                      >
                        Trade with {p.name}
                      </button>
                    ))}
                </details>
                <div className="frontier-storage">
                  <label>
                    Storage
                    <select
                      aria-label="Storage"
                      value={storage}
                      onChange={(e) => setStorage(e.target.value)}
                    >
                      <option value="">Choose storage</option>
                      <option value={`vault-${id}`}>
                        Personal vault · town
                      </option>
                      {state.containers
                        .filter((c) => c.id !== `vault-${id}`)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.id}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Quantity
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={quantity}
                      onChange={(e) =>
                        setQuantity(
                          Math.max(
                            1,
                            Math.min(99, Number(e.target.value) || 1),
                          ),
                        )
                      }
                    />
                  </label>
                </div>
                {state.drops.some((d) => d.region === region) && (
                  <details>
                    <summary>Dropped bags</summary>
                    {state.drops
                      .filter((d) => d.region === region)
                      .map((d) => (
                        <article key={d.id}>
                          <span>
                            {d.x},{d.z}
                          </span>
                          <button onClick={() => void go(d)}>Walk here</button>
                          {button("Pick up", {
                            action: "pickup_bag",
                            id: d.id,
                          })}
                        </article>
                      ))}
                  </details>
                )}
                <h3>Deposit from your bag</h3>
                {bag.length === 0 && (
                  <p className="frontier-hint">Your bag is empty.</p>
                )}
                {bag.map((row) => (
                  <article className="frontier-row" key={row.slot}>
                    <strong className="storage-item-label">
                      <img src={getItemDef(row.itemId)?.icon} alt="" />
                      {row.quantity}{" "}
                      {getItemDef(row.itemId)?.name ?? row.itemId}
                    </strong>
                    {button(
                      "Deposit",
                      {
                        action: "container",
                        id: storage,
                        item: row.itemId,
                        quantity,
                        target: "deposit",
                      },
                      !storage,
                    )}
                  </article>
                ))}
                {selectedContainer && <h3>Stored</h3>}
                {selectedContainer?.slots.map(
                  (slot, i) =>
                    slot && (
                      <article className="frontier-row" key={i}>
                        <strong className="storage-item-label">
                          <img src={getItemDef(slot.itemId)?.icon} alt="" />
                          {slot.quantity}{" "}
                          {getItemDef(slot.itemId)?.name ?? slot.itemId}
                        </strong>
                        {button("Withdraw", {
                          action: "container",
                          id: storage,
                          item: slot.itemId,
                          quantity,
                          target: "withdraw",
                        })}
                      </article>
                    ),
                )}
              </>
            )}
          </div>
        </section>
      )}
    </>
  );
}
