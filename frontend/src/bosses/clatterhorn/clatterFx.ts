/**
 * Clatterhorn FX: consumes new bossStore entries (YouHit and Hurt notices,
 * swing cues, flips, drums, defeats and rewards) into damage numbers, swing
 * animations, knockback, sounds, toasts and world lines
 * (`useGiantStore.getState().addSystemLine`, `floatOnPlayer`).
 *
 * WP0 stub (owned by WP8): BossSync starts it once per connection.
 */

/** Start consuming the store; returns the unsubscribe. */
export function startClatterFx(): () => void {
  return () => {};
}
