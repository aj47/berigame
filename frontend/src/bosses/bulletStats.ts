/**
 * Production-safe bullet counter (FINAL_SPEC 7.5): BulletLayer stores how many
 * bullets it drew this frame per style; SpireHud mirrors `live` into the
 * `data-bullets` attribute that the live check reads. Plain numbers, no
 * allocation, available in production builds (unlike `window.__berigameFx`).
 */
export type BulletStyle = 'shard' | 'mote' | 'runner';

export const bulletStats: { live: number; byStyle: Record<BulletStyle, number> } = {
  live: 0,
  byStyle: { shard: 0, mote: 0, runner: 0 },
};

/** Record one style's drawn count and refresh the sum. */
export function setBulletCount(style: BulletStyle, count: number): void {
  const n = Math.max(0, Math.floor(count) || 0);
  const by = bulletStats.byStyle;
  if (by[style] === n) return;
  by[style] = n;
  bulletStats.live = by.shard + by.mote + by.runner;
}
