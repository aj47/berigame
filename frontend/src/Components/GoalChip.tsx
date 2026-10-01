import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Celebration, OnboardingTip } from "./OnboardingTip";
import {
  HOTBAR_SIZE,
  PlayerState,
  STICK_ITEM_ID,
  STONE_CLUB_ITEM_ID,
  areaOf,
  FIRST_DAY_DONE,
  firstDayGoal,
  getItemDef,
  type Goal,
  raidStatus,
} from "@sim";
import { useGameActions } from "../spacetime/actions";
import {
  useGiantRaid,
  useGiants,
  useInventoryRows,
  useNow,
  useMyIdentityHex,
  useMyPlayer,
  usePlayers,
  useTick,
  useTrees,
} from "../spacetime/hooks";
import { useFirstDayStore } from "../spacetime/stores/firstDayStore";
import { useToastStore } from "../spacetime/stores/toastStore";
import { slotsFromRows } from "./itemUi";
import { useLoadingStore } from "../store";

/** How long the stick-find banner stays up. */
export const FIND_BANNER_MS = 6000;
export const COAST_ARRIVAL_MESSAGE = "You pushed through to the Coast";
export const BOULDERS_ARRIVAL_MESSAGE = "You climbed into the Boulders. Something huge stirs…";
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
  if (goal.id === "reach-boulders" || goal.id === "face-giant") return getItemDef(STONE_CLUB_ITEM_ID)?.icon ?? "/items/stone_club.png";
  return "/items/blueberry.png";
}

/**
 * "The Giant wakes in 12:34" (or "Giant raid! 8:10 left"): its own component,
 * so only this line re-renders every second.
 */
export const RaidCountdown = ({ standalone }: { standalone?: boolean }) => {
  const raid = useGiantRaid();
  const now = useNow(1000);
  const status = raidStatus(raid, now);
  if (!status) return null;
  const cls = `raid-countdown ${status.awake ? "raid-live" : "raid-sleeping"}`;
  if (standalone)
    return (
      <div className={`raid-chip ${cls}`} role="timer" aria-live="off" data-testid="raid-countdown">
        <span aria-hidden="true">{status.awake ? "!" : "Zz"}</span> {status.label}
      </div>
    );
  return <small className={cls} role="timer" aria-live="off" data-testid="raid-countdown">{status.label}</small>;
};

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
  const giants = useGiants();
  const actions = useGameActions();
  const showToast = useToastStore((s) => s.show);
  const { done, seen, stickFoundAt, load, setDone, dismissFind, owner, tipped, markTipped } = useFirstDayStore();
  const { activeTip, celebrating, setActiveTip, setCelebrating } = useFirstDayStore();
  // Tips and the celebration wait for the loading screen to lift, or they would play unseen behind it.
  const worldShown = !(useLoadingStore as any)((s: any) => s.isLoading);
  const endTip = useCallback(() => setActiveTip(null), [setActiveTip]);
  const endCelebration = useCallback(() => setCelebrating(false), [setCelebrating]);
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
        ? firstDayGoal({ me, slots, trees, others, tick, canFight: true, done, seen, giant: giants[0] ?? null })
        : null,
    [me, slots, trees, others, tick, done, seen, giants],
  );

  useEffect(() => {
    // Only after this identity's remembered set has loaded, or a stale first render would overwrite it.
    if (result && owner === meHex) setDone(result.done);
  }, [result, setDone, owner, meHex]);

  // First Day celebration: only on the transition seen in this session, once per identity.
  const firstDayWas = useRef<boolean | null>(null);
  const loaded = !!meHex && owner === meHex;
  useEffect(() => {
    if (!loaded) {
      firstDayWas.current = null;
      return;
    }
    const has = done.includes(FIRST_DAY_DONE);
    if (firstDayWas.current === false && has && !tipped?.includes(FIRST_DAY_DONE)) {
      setCelebrating(true);
      markTipped(FIRST_DAY_DONE);
    }
    firstDayWas.current = has;
  }, [loaded, done, tipped, markTipped, setCelebrating]);

  // A short tip the first time each step appears; remembered with the done set.
  const goalId = result?.goal?.id;
  const tipAllowed = worldShown && loaded && visible && !!me && me.state !== PlayerState.Dead && !me.hostile && !celebrating;
  useEffect(() => {
    if (!tipAllowed || useFirstDayStore.getState().celebrating || !goalId || tipped?.includes(goalId)) return;
    setActiveTip(goalId);
    markTipped(goalId);
  }, [tipAllowed, goalId, tipped, markTipped, setActiveTip]);
  const tipGoal = worldShown && activeTip && result?.goal?.id === activeTip ? result.goal : null;

  // "You pushed through to the Coast", once per crossing out of the Grove.
  const lastArea = useRef<string | null>(null);
  const area = me ? areaOf(me) : null;
  useEffect(() => {
    if (!area || !me || me.state !== PlayerState.Alive) return;
    if (area === "coast" && lastArea.current && lastArea.current !== "coast" && lastArea.current !== "boulder-line" && lastArea.current !== "boulders")
      showToast(COAST_ARRIVAL_MESSAGE);
    if (area === "boulders" && lastArea.current && lastArea.current !== "boulders")
      showToast(BOULDERS_ARRIVAL_MESSAGE);
    lastArea.current = area;
  }, [area, me, showToast]);

  useEffect(() => {
    if (stickFoundAt === null) return;
    const left = FIND_BANNER_MS - (performance.now() - stickFoundAt);
    const timer = setTimeout(dismissFind, Math.max(0, left));
    return () => clearTimeout(timer);
  }, [stickFoundAt, dismissFind]);

  const party = celebrating && worldShown && <Celebration onDone={endCelebration} />;
  if (!me || me.state === PlayerState.Dead) return party || null;
  const banner = stickFoundAt !== null && (
    <div className="find-banner" role="status">
      <img src={getItemDef(STICK_ITEM_ID)?.icon} alt="" />
      <span>{STICK_FOUND_MESSAGE}</span>
    </div>
  );
  if (!visible || me.hostile || !result?.goal) return <>{banner}{party}{visible && <RaidCountdown standalone />}</>;
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
      else if (action.kind === "giant") await actions.attackGiant(action.giantId);
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
      {party}
      {tipGoal && <OnboardingTip goal={tipGoal} onDone={endTip} />}
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
          <RaidCountdown />
        </span>
      </button>
    </>
  );
};
export default GoalChip;
