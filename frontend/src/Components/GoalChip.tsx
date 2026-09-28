import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  HOTBAR_SIZE,
  PlayerState,
  STICK_ITEM_ID,
  STONE_CLUB_ITEM_ID,
  areaOf,
  firstDayGoal,
  getItemDef,
  type Goal,
} from "@sim";
import { useGameActions } from "../spacetime/actions";
import {
  useInventoryRows,
  useMyIdentityHex,
  useMyPlayer,
  usePlayers,
  useTick,
  useTrees,
} from "../spacetime/hooks";
import { useFirstDayStore } from "../spacetime/stores/firstDayStore";
import { useToastStore } from "../spacetime/stores/toastStore";
import { slotsFromRows } from "./itemUi";

/** How long the stick-find banner stays up. */
export const FIND_BANNER_MS = 6000;
export const COAST_ARRIVAL_MESSAGE = "You pushed through to the Coast";
export const STICK_FOUND_MESSAGE =
  "You found a sturdy stick! Tap it to wield — hits twice as hard";

function goalIcon(goal: Goal, trees: ReturnType<typeof useTrees>): string {
  if (goal.id === "make-club" || goal.id === "wield-club")
    return getItemDef(STONE_CLUB_ITEM_ID)?.icon ?? "/items/stone_club.png";
  if (goal.id === "wield-stick" || goal.id === "reach-coast")
    return getItemDef(STICK_ITEM_ID)?.icon ?? "/items/stick.png";
  if (goal.action?.kind === "harvest") {
    const tree = trees.find((t) => t.id === (goal.action as { treeId: number }).treeId);
    if (tree) return getItemDef(tree.itemId)?.icon ?? "/items/blueberry.png";
  }
  if (goal.id === "find-stick") return getItemDef(STICK_ITEM_ID)?.icon ?? "/items/stick.png";
  if (goal.id === "gather-coast") return getItemDef("flint")?.icon ?? "/items/flint.png";
  return "/items/blueberry.png";
}

/**
 * The one-line "First Day" goal: what to do next, and a tap that does it.
 * Replaces the old Gather shortcut. It never starts a task on its own.
 */
const GoalChip = ({ visible }: { visible: boolean }) => {
  const me = useMyPlayer();
  const meHex = useMyIdentityHex();
  const players = usePlayers();
  const trees = useTrees();
  const tick = useTick();
  const rows = useInventoryRows();
  const actions = useGameActions();
  const showToast = useToastStore((s) => s.show);
  const { done, seen, stickFoundAt, load, setDone, dismissFind } = useFirstDayStore();
  const [pending, setPending] = useState(false);

  useEffect(() => load(meHex), [meHex, load]);

  const slots = useMemo(() => slotsFromRows(rows), [rows]);
  const others = useMemo(
    () => players.filter((p) => p !== me),
    [players, me],
  );
  const result = useMemo(
    () =>
      me
        ? firstDayGoal({ me, slots, trees, others, tick, canFight: true, done, seen })
        : null,
    [me, slots, trees, others, tick, done, seen],
  );

  useEffect(() => {
    if (result) setDone(result.done);
  }, [result, setDone]);

  // "You pushed through to the Coast", once per crossing out of the Grove.
  const lastArea = useRef<string | null>(null);
  const area = me ? areaOf(me) : null;
  useEffect(() => {
    if (!area || !me || me.state !== PlayerState.Alive) return;
    if (area === "coast" && lastArea.current && lastArea.current !== "coast")
      showToast(COAST_ARRIVAL_MESSAGE);
    lastArea.current = area;
  }, [area, me, showToast]);

  useEffect(() => {
    if (stickFoundAt === null) return;
    const left = FIND_BANNER_MS - (performance.now() - stickFoundAt);
    const timer = setTimeout(dismissFind, Math.max(0, left));
    return () => clearTimeout(timer);
  }, [stickFoundAt, dismissFind]);

  if (!me || me.state === PlayerState.Dead) return null;
  const banner = stickFoundAt !== null && (
    <div className="find-banner" role="status">
      <img src={getItemDef(STICK_ITEM_ID)?.icon} alt="" />
      <span>{STICK_FOUND_MESSAGE}</span>
    </div>
  );
  if (!visible || me.hostile || !result?.goal) return banner || null;
  const goal = result.goal;
  const action = goal.action;

  const run = async () => {
    if (!action || pending) return;
    setPending(true);
    try {
      if (action.kind === "harvest") await actions.startHarvest(action.treeId);
      else if (action.kind === "eat") await actions.eatBerry(action.slot);
      else if (action.kind === "wield") await actions.wieldItem(action.slot);
      else if (action.kind === "move") await actions.setTarget(action.x, action.z);
      else if (action.kind === "craft") {
        if (await actions.craft(action.recipe))
          showToast(`You made a ${(getItemDef(action.recipe)?.name ?? "thing").toLowerCase()}!`);
      }
    } finally {
      setPending(false);
    }
  };

  const keyHint =
    action && (action.kind === "eat" || action.kind === "wield") && action.slot < HOTBAR_SIZE
      ? ` (key ${action.slot + 1})`
      : "";
  return (
    <>
      {banner}
      <button
        className={`goal-chip ${action ? "" : "busy"}`}
        data-goal={goal.id}
        disabled={!action || pending}
        onClick={() => void run()}
        aria-label={`${goal.text}${keyHint}. ${goal.hint}`}
      >
        <img src={goalIcon(goal, trees)} alt="" />
        <span>
          <strong>{goal.text}</strong>
          <small>{goal.hint}</small>
        </span>
      </button>
    </>
  );
};
export default GoalChip;
