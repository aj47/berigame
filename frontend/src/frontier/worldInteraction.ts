import type { Location } from '../../../shared/sim/frontier/catalog';

export const WORLD_INTERACTION = 'berigame-world-interaction';
export const PLAYER_ACTION = 'berigame-player-action';
export interface WorldInteraction { location: Location; perform: () => void; radius: number }

/** World props approach their location first; toolbar shortcuts still open directly. */
export function approachWorldInteraction(location: Location, perform: () => void, radius = 2) {
  window.dispatchEvent(new CustomEvent<WorldInteraction>(WORLD_INTERACTION, { detail: { location, perform, radius } }));
}
