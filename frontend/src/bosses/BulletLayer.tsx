import type { BulletStyle } from './bulletStats';

/** Packed bullets ([F, ox, oz, dx, dz, q] per bullet, shared/sim/bullets.ts) and the box they may be drawn in. */
export interface BulletSource { bullets: Int32Array; boxX0: number; boxZ0: number; boxX1: number; boxZ1: number }

export interface BulletLayerProps {
  /** Read every frame (no React render per tick); null draws nothing. */
  source: () => BulletSource | null;
  /** 'spire' draws q = 2 bullets as shards and q = 1 as motes; 'runner' draws Clatterhorn's beetling swarm. */
  palette: 'spire' | 'runner';
}

/**
 * Instanced bullets on the avatar timeline, interpolated between the integer
 * half-step tiles that collide (FINAL_SPEC 7.5). Allocation-free per frame.
 *
 * WP0 stub with the final props (owned by WP7).
 */
export default function BulletLayer(_props: BulletLayerProps): null {
  return null;
}
export type { BulletStyle };
