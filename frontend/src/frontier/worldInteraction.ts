import type { Location } from '../../../shared/sim/frontier/catalog';

export const WORLD_INTERACTION = 'berigame-world-interaction';
export const PLAYER_ACTION = 'berigame-player-action';
export interface WorldInteraction { location: Location; perform: () => void; radius: number }

/** Chosen world actions approach their location first; toolbar shortcuts still open directly. */
export function approachWorldInteraction(location: Location, perform: () => void, radius = 2) {
  window.dispatchEvent(new CustomEvent<WorldInteraction>(WORLD_INTERACTION, { detail: { location, perform, radius } }));
}

/** Island reducers walk you over themselves; from Meadows the client routes across first. */
export function performOnIsland(myRegion: string | undefined, at: { x: number; z: number }, perform: () => void, radius = 1) {
  if (myRegion && myRegion !== 'bramblewild') approachWorldInteraction({ region: 'bramblewild', x: at.x, z: at.z }, perform, radius);
  else perform();
}
