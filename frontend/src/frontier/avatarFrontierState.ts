import type { FrontierSnapshot } from '../../../shared/sim/frontier/snapshot';

/** The public land/building state avatars need for collision and combat protection. */
type AvatarFrontierState = Pick<FrontierSnapshot, 'buildings' | 'plots'>;
const snapshots = new WeakMap<AvatarFrontierState, AvatarFrontierState>();
let previous: { key: string; state: AvatarFrontierState } | undefined;

/**
 * useFrontier also changes for clocks, wildlife, coins, and resources. Keep those
 * updates from rendering every avatar. Compare once per shared snapshot, not once per avatar.
 */
export function avatarFrontierState(source: AvatarFrontierState): AvatarFrontierState {
  const cached = snapshots.get(source);
  if (cached) return cached;
  const state = { buildings: source.buildings, plots: source.plots };
  const key = JSON.stringify(state);
  if (previous?.key !== key) previous = { key, state };
  snapshots.set(source, previous.state);
  return previous.state;
}
