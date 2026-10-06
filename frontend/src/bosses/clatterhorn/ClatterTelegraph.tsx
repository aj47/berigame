import type { ClatterhornRow } from '../bossStore';

export interface ClatterTelegraphProps {
  row: ClatterhornRow;
  /** The world tick the row belongs to. */
  tick: number;
}

/**
 * Lane, spin ring and drum plumes from `clatterTelegraph(row)` through
 * DangerTiles, back-dated fill, end-cap icon, the spin's safe eye, the bait
 * reticle, and the swarm's free lines (FINAL_SPEC 7.2).
 *
 * WP0 stub with the final props (owned by WP8).
 */
export default function ClatterTelegraph(_props: ClatterTelegraphProps): null {
  return null;
}
