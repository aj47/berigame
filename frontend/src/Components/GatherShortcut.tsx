import React, { useState } from "react";
import { chebyshev, getItemDef, Pending, PlayerState } from "@sim";
import { useGameActions } from "../spacetime/actions";
import {
  useInventoryRows,
  useMyPlayer,
  useTick,
  useTrees,
} from "../spacetime/hooks";
import type { Tree } from "../module_bindings/types";

export function nearestAvailableTree(
  trees: readonly Tree[],
  position: { x: number; z: number },
  tick: number,
): Tree | undefined {
  return trees
    .filter((tree) => !tree.harvester && tree.cooldownUntilTick <= tick)
    .sort(
      (a, b) => chebyshev(position, a) - chebyshev(position, b) || a.id - b.id,
    )[0];
}

/** A discoverable, explicit shortcut; it never starts a task on its own. */
const GatherShortcut = ({
  visible,
  solo,
}: {
  visible: boolean;
  solo: boolean;
}) => {
  const me = useMyPlayer();
  const trees = useTrees();
  const tick = useTick();
  const inventory = useInventoryRows();
  const { startHarvest } = useGameActions();
  const [pending, setPending] = useState(false);
  if (
    !visible ||
    !me ||
    me.state === PlayerState.Dead ||
    me.hostile ||
    (!solo && inventory.length > 0)
  )
    return null;
  const tree = nearestAvailableTree(trees, me, tick);
  const gathering = me.harvestEndTick > tick;
  const approaching = me.pending === Pending.Harvest;
  const item = tree ? getItemDef(tree.itemId) : undefined;
  const busy = pending || gathering || approaching;
  const gather = async () => {
    if (!tree || busy) return;
    setPending(true);
    try {
      await startHarvest(tree.id);
    } finally {
      setPending(false);
    }
  };
  return (
    <button
      className="gather-shortcut"
      disabled={!tree || busy}
      onClick={() => void gather()}
    >
      <img src={item?.icon ?? "/items/blueberry.png"} alt="" />
      <span>
        <strong>
          {gathering
            ? "Gathering berries…"
            : approaching
              ? "Walking to tree…"
              : tree
                ? `Gather ${item?.name ?? "berries"}`
                : "No trees ready"}
        </strong>
        <small>
          {busy
            ? "Use Stop to cancel"
            : tree
              ? "Walk to the nearest ripe tree"
              : "Try again after a harvest or regrowth"}
        </small>
      </span>
    </button>
  );
};
export default GatherShortcut;
