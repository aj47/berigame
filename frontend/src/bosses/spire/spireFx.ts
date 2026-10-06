/**
 * Spire FX: consumes new bossStore entries (Star, Hurt, KnockedOut, Reward,
 * Keepsake and RunResult notices, SpireRunStart and SpireClear events) into
 * hit flashes, damage numbers, sounds, toasts and world lines
 * (`useGiantStore.getState().addSystemLine`).
 *
 * WP0 stub (owned by WP7): BossSync starts it once per connection.
 */

/** Start consuming the store; returns the unsubscribe. */
export function startSpireFx(): () => void {
  return () => {};
}
