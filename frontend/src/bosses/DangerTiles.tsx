export interface DangerTilesProps {
  /** Tile keys (z * GRID_SIZE + x). */
  tiles: Iterable<number>;
  color: string;
  opacity: number;
  /** Diagonal stripes for colour-blind play. */
  stripes?: boolean;
}

/**
 * Flat instanced quads over danger tiles (capacity 289, y 0.03, no depth
 * write, never raycast): Spire overlay and Clatterhorn telegraphs.
 *
 * WP0 stub with the final props (owned by WP7).
 */
export default function DangerTiles(_props: DangerTilesProps): null {
  return null;
}
