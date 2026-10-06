/**
 * Production-safe bullet counter (FINAL_SPEC 7.5): BulletLayer stores how many
 * bullets it drew this frame per style; SpireHud mirrors `live` into the
 * `data-bullets` attribute that the live check reads.
 *
 * WP0 stub (owned by WP7 afterwards).
 */
export type BulletStyle = 'shard' | 'mote' | 'runner';

export const bulletStats: { live: number; byStyle: Record<BulletStyle, number> } = {
  live: 0,
  byStyle: { shard: 0, mote: 0, runner: 0 },
};

/** Record one style's drawn count and refresh the sum. */
export function setBulletCount(style: BulletStyle, count: number): void {
  void style; void count;
  throw new Error('not implemented: setBulletCount');
}
