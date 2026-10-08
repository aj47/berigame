import { useMemo } from "react";
import { create } from "zustand";
import {
  useFrontierObjects,
  useFrontierViews,
  useMyIdentityHex,
} from "../spacetime/hooks";
import { avatarFrontierState } from "./avatarFrontierState";
import { frontierSnapshot, type FrontierSnapshot } from "../../../shared/sim/frontier/snapshot";

const emptySnapshot = frontierSnapshot([], [], "", 0);
const useFrontierStore = create<{ snapshot: FrontierSnapshot }>(() => ({ snapshot: emptySnapshot }));

/**
 * Parse the frontier tables once per row change (not per 600ms tick) and publish
 * the snapshot. Claim status is a wall-clock view of that snapshot; UI that
 * must expire on time (Land, CombatHud) should call `claimStatus` with `Date.now()`.
 */
export function FrontierSync() {
  const objects = useFrontierObjects(),
    views = useFrontierViews(),
    id = useMyIdentityHex();
  const snapshot = useMemo(
    () => frontierSnapshot(objects, views, id ?? "", Date.now()),
    [objects, views, id],
  );
  if (useFrontierStore.getState().snapshot !== snapshot) useFrontierStore.setState({ snapshot });
  return null;
}

/** Full snapshot. Re-renders when public/private frontier rows change, not on the world tick. */
export function useFrontier(): FrontierSnapshot {
  return useFrontierStore((s) => s.snapshot);
}

/** Expansion flag only: wildlife or coin updates must not rebuild the Canvas. */
export function useFrontierEnabled(): boolean {
  return useFrontierStore((s) => s.snapshot.enabled);
}

/** Your coin total, for the world header. */
export function useFrontierCoins(): number {
  return useFrontierStore((s) => s.snapshot.profile.coins);
}

/** Buildings and plots, interned while protection and collision stay the same. */
export function useAvatarFrontier() {
  return useFrontierStore((s) => avatarFrontierState(s.snapshot));
}
