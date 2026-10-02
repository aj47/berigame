import React, { useEffect, useState } from "react";
import { useFrontier } from "./useFrontier";
import { useInventoryRows, useMyPlayer, usePlayers } from "../spacetime/hooks";
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
import { exportRecovery, restoreRecovery } from "./recovery";
import "./frontier.css";
import type { FrontierRequest } from "./navigation";
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
const when = (n: number) => new Date(n).toLocaleString();
const tabs = [
  "Journal",
  "Land",
  "Build",
  "Craft",
  "Wildlife",
  "Skills",
  "Harbour",
  "Bag",
] as const;
const tabIcons: Record<(typeof tabs)[number], string> = {
  Journal: "📖",
  Land: "🏡",
  Build: "🔨",
  Craft: "🧰",
  Wildlife: "🐾",
  Skills: "✨",
  Harbour: "⛵",
  Bag: "🎒",
};
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
    plot = state.plots.find((p) => p.id === (selected || myPlot?.id)),
    myBoat = state.boats.find((b) => b.owner === id),
    aboard = state.boats.find((b) => b.crew.includes(id));
  const activeQuest = state.quests.find((q) => q.available && !q.complete),
    selectedContainer = state.containers.find((c) => c.id === storage),
    bag = inventory.filter((row) => row.owner.toHexString() === id);
  async function run(command: Command) {
    if (busy) return;
    setBusy(true);
    try {
      await actions.frontier(command);
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
  return (
    <>
      {region !== "bramblewild" && showGoal && !draft && activeQuest && (
        <button
          className="frontier-goal"
          onClick={() => {
            setTab("Journal");
            setOpen(true);
          }}
        >
          <small>NEXT QUEST</small>
          {activeQuest.title}
          <span>{activeQuest.text}</span>
        </button>
      )}
      {draft && (
        <div className="frontier-build-confirm">
          <strong>{PIECES[draft.piece]?.name}</strong>
          <span>{cost(PIECES[draft.piece].cost)}</span>
          <p>
            {draft.point
              ? `Place at ${draft.point.x}, ${draft.point.z}`
              : "Tap the ground to preview."}
          </p>
          <button
            onClick={() =>
              onDraft({ ...draft, rotation: (draft.rotation + 1) % 4 })
            }
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
          <header>
            <div>
              <div className="frontier-stats">
                <span>
                  <span aria-hidden="true">🪙</span> {profile.coins} coins
                </span>
                <span>
                  <span aria-hidden="true">♥</span> {me.hp} HP
                </span>
              </div>
              <h2>{tab}</h2>
            </div>
            <button
              aria-label="Close settlements"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </header>
          <nav aria-label="Settlement activities">
            {tabs.map((t) => (
              <button
                key={t}
                aria-pressed={tab === t}
                onClick={() => setTab(t)}
              >
                <span aria-hidden="true">{tabIcons[t]}</span>
                {t}
              </button>
            ))}
          </nav>
          <div className="frontier-content">
            {error && <p role="alert">{error}</p>}
            {region === "bramblewild" && (
              <article>
                <h3>Start your settlement</h3>
                <p>Find the Meadows sign beside the camp workshop.</p>
                <button onClick={() => void actions.setTarget(22, 18)}>
                  Walk to camp
                </button>
                {button(
                  "Enter the Meadows",
                  { action: "enter" },
                  Math.max(Math.abs(me.x - 22), Math.abs(me.z - 18)) > 4,
                )}
              </article>
            )}
            {tab === "Journal" && region !== "bramblewild" && (
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
                          {activeQuest.progress}/{activeQuest.amount} complete
                        </span>
                        <span>+{activeQuest.coins} coins</span>
                      </div>
                      <progress
                        aria-label={`${activeQuest.title} progress`}
                        value={activeQuest.progress}
                        max={activeQuest.amount}
                      />
                      {button("Finish quest", {
                        action: "quest",
                        id: activeQuest.id,
                      })}
                    </>
                  )}
                  <div className="frontier-controls">
                    {button("Meet the steward", {
                      action: "talk",
                      id: "steward",
                    })}
                    <button
                      onClick={() => void go(state.regions.settlement.spawn)}
                    >
                      Walk to town
                    </button>
                    {button("Return to Bramblewild", { action: "return" })}
                  </div>
                </article>
                <h3>Supply orders</h3>
                <p>10 coins each · up to 60 daily</p>
                {state.orders.map((o) => (
                  <article className="frontier-row" key={o.id}>
                    <strong>{cost(o.inputs)}</strong>
                    {button("Deliver · 10 coins", {
                      action: "order",
                      id: o.id,
                    })}
                  </article>
                ))}
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
                <article>
                  <h3>Your home</h3>
                  <p>Pay weekly tax to keep your plot protected.</p>
                  {!profile.recoveryReady && (
                    <>
                      <p className="frontier-hint">
                        Back up your character before claiming land.
                      </p>
                      <button
                        onClick={() =>
                          void exportRecovery().catch((e) =>
                            setError(e.message),
                          )
                        }
                      >
                        Export character recovery
                      </button>
                    </>
                  )}
                  <details>
                    <summary>Tax &amp; recovery</summary>
                    <p>
                      Unpaid plots have three days’ grace before a capture
                      challenge.
                    </p>
                    {profile.recoveryReady && (
                      <button
                        onClick={() =>
                          void exportRecovery().catch((e) =>
                            setError(e.message),
                          )
                        }
                      >
                        Replace recovery backup
                      </button>
                    )}
                    <label className="frontier-file">
                      Restore a character
                      <input
                        type="file"
                        accept="application/json"
                        onChange={(e) => {
                          if (e.target.files?.[0])
                            void restoreRecovery(e.target.files[0]).catch((e) =>
                              setError(e.message),
                            );
                        }}
                      />
                    </label>
                  </details>
                </article>
                <select
                  aria-label="Plot"
                  value={selected || myPlot?.id || ""}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">Choose a plot</option>
                  {state.plots.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id} · {p.claim?.owner === id ? "your home" : p.status}
                    </option>
                  ))}
                </select>
                {plot && (
                  <article>
                    <h3>{plot.id}</h3>
                    <div className="frontier-stats">
                      <span>{plot.status}</span>
                      <span>
                        {plot.claim
                          ? `${FRONTIER.sizes[plot.claim.tier]} × ${FRONTIER.sizes[plot.claim.tier]}`
                          : "8 × 8"}{" "}
                        tiles
                      </span>
                    </div>
                    <button
                      disabled={region !== plot.region}
                      onClick={() => void go(plot.marker)}
                    >
                      Walk to marker
                    </button>
                    {!plot.claim &&
                      button("Claim · 50 coins", {
                        action: "claim",
                        id: plot.id,
                      })}
                    {plot.claim && (
                      <>
                        <p>
                          Paid through {when(plot.claim.paidUntil)}
                          <br />
                          Grace ends{" "}
                          {when(plot.claim.paidUntil + FRONTIER.grace)}
                        </p>
                        {plot.claim.challenge && (
                          <p>
                            Capture opens {when(plot.claim.challenge.opens)}.
                            Pay overdue tax before capture to retain ownership.
                          </p>
                        )}
                        {button(
                          `Pay a week · ${FRONTIER.taxes[plot.claim.tier]} coins`,
                          {
                            action: "tax",
                            id: plot.id,
                            quantity: 1,
                          },
                        )}
                        {plot.claim.owner === id ? (
                          <>
                            {button(
                              "Expand plot",
                              { action: "upgrade", id: plot.id },
                              plot.claim.tier === 2,
                            )}
                            <details>
                              <summary>Share &amp; manage plot</summary>
                              {permissionEditor()}
                              {button("Abandon empty plot", {
                                action: "abandon",
                                id: plot.id,
                              })}
                            </details>
                          </>
                        ) : (
                          button(
                            "Announce capture challenge",
                            { action: "challenge", id: plot.id },
                            plot.status !== "vulnerable",
                          )
                        )}
                        {plot.claim.challenge && (
                          <>
                            <p className="frontier-hint">
                              Joining either side enables contest combat.
                            </p>
                            {button("Join defense", {
                              action: "join_contest",
                              id: plot.id,
                              target: "defend",
                            })}
                            {button("Join attackers", {
                              action: "join_contest",
                              id: plot.id,
                              target: "attack",
                            })}
                            <select
                              value={helper}
                              onChange={(e) => setHelper(e.target.value)}
                              aria-label="Invite attacker"
                            >
                              <option value="">Choose a helper</option>
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
                            {button(
                              "Invite attacker",
                              {
                                action: "invite_contest",
                                id: plot.id,
                                target: helper,
                              },
                              !helper,
                            )}
                          </>
                        )}
                      </>
                    )}
                  </article>
                )}
              </>
            )}
            {tab === "Build" && (
              <>
                {!myPlot ? (
                  <p>
                    Choose a plot in Land. You need ownership or building
                    access.
                  </p>
                ) : (
                  <p>Choose a piece, then tap the ground to preview.</p>
                )}
                <div className="frontier-grid">
                  {Object.entries(PIECES).map(([key, piece]) => (
                    <button
                      key={key}
                      disabled={!plot?.claim}
                      onClick={() => {
                        onDraft({ plot: plot!.id, piece: key, rotation: 0 });
                        setOpen(false);
                      }}
                    >
                      <strong>{piece.name}</strong>
                      <small>{cost(piece.cost)}</small>
                      {piece.level && <small>Building Lv. {piece.level}</small>}
                    </button>
                  ))}
                </div>
                <h3>Placed pieces</h3>
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
            {tab === "Craft" && (
              <>
                <details>
                  <summary>Gather nearby</summary>
                  {state.resources
                    .filter((n) => n.region === region)
                    .map((n) => (
                      <article className="frontier-row" key={n.id}>
                        <strong>
                          {getItemDef(n.item)?.name} · {n.x},{n.z}
                        </strong>
                        <button onClick={() => void go({ x: n.x - 1, z: n.z })}>
                          Walk here
                        </button>
                        {button("Gather", { action: "gather", id: n.id })}
                      </article>
                    ))}
                </details>
                <h3>Recipes</h3>
                {state.recipes.map((recipe) => (
                  <article className="frontier-recipe" key={recipe.id}>
                    <div>
                      <h3>
                        {getItemDef(recipe.output)?.name}{" "}
                        <small>×{recipe.quantity}</small>
                      </h3>
                      <p>{cost(recipe.inputs)}</p>
                      <small>
                        {recipe.station ?? "Craft by hand"}
                        {recipe.discipline !== undefined
                          ? ` · ${DISCIPLINES[recipe.discipline]} ${recipe.level}`
                          : ""}
                      </small>
                    </div>
                    {button("Craft", { action: "craft", id: recipe.id })}
                  </article>
                ))}
              </>
            )}
            {tab === "Wildlife" && (
              <>
                <details>
                  <summary>Nearby players &amp; combat</summary>
                  <p>
                    Both players must allow combat, or join opposing capture
                    teams. Town and paid homes are protected.
                  </p>
                  {players
                    .filter(
                      (p) =>
                        p.online &&
                        p.region === region &&
                        p.identity.toHexString() !== id &&
                        Math.max(Math.abs(p.x - me.x), Math.abs(p.z - me.z)) <
                          12,
                    )
                    .map((p) => (
                      <article key={p.identity.toHexString()}>
                        <strong>
                          {p.name} · {p.hp} HP
                        </strong>
                        {button("Attack", {
                          action: "attack",
                          id: p.identity.toHexString(),
                        })}
                      </article>
                    ))}
                </details>
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
                <p>Pick two disciplines for advanced abilities.</p>
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
            {tab === "Bag" && (
              <>
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
                <h3>Carrying</h3>
                {bag.length === 0 && (
                  <p className="frontier-hint">Your bag is empty.</p>
                )}
                {bag.map((row) => (
                  <article className="frontier-row" key={row.slot}>
                    <strong>
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
                    {(getItemDef(row.itemId)?.healthRestore ?? 0) > 0 &&
                      button("Eat", { action: "eat", item: row.itemId })}
                    {(!!getItemDef(row.itemId)?.weaponDamage ||
                      row.itemId === "padded_vest") &&
                      button("Equip", { action: "equip", item: row.itemId })}
                  </article>
                ))}
                {selectedContainer && <h3>Stored</h3>}
                {selectedContainer?.slots.map(
                  (slot, i) =>
                    slot && (
                      <article className="frontier-row" key={i}>
                        <strong>
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
