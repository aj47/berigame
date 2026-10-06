import { worldBlockedSet, type Tile } from '@sim';

/**
 * Mutable view state the Spire scene (inside the Canvas) shares with the DOM
 * layer and the overlay without React renders: the camera azimuth for the
 * step controls and the floor tile under the pointer for the safe-move hover.
 */
export const spireView: { azimuth: number; hover: Tile | null; hoverSeq: number; pillarGlow: number } = {
  azimuth: 0,
  hover: null,
  hoverSeq: 0,
  /** Bit i set: origin i's volley charges (the overlay writes it, the scene's pillars glow). */
  pillarGlow: 0,
};

export function setSpireHover(tile: Tile | null): void {
  const h = spireView.hover;
  if (h === tile || (h && tile && h.x === tile.x && h.z === tile.z)) return;
  spireView.hover = tile;
  spireView.hoverSeq++;
}

/**
 * The blocked set on the floor: no node can stand there, so the world's static
 * blockers (the dais among them) are the whole story. One stable instance, so
 * `spireSafety`'s per-set move cache is built once.
 */
export const SPIRE_BLOCKED: Set<number> = worldBlockedSet([]);
