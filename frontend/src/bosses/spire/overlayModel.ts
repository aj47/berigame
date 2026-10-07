import {
  BULLET_STRIDE, SPIRE_ORIGINS, SPIRE_RULES_VERSION, bulletTileAt, chebyshev, spireDangerTiles, spireHitsMove, spireMiddle,
  spireSafetyCached, spireStandable, tileKey, type SpireFightLike, type SpireSafety, type Tile,
} from '@sim';

/**
 * Pure model of the Spire danger overlay (FINAL_SPEC 7.5), all on the server
 * timeline: recomputed when `tickClock.tick` changes to τ, never per frame.
 */

/** Exact stationary danger of the next two ticks: red at τ+1, amber at τ+2 (standable floor only). */
export function overlayDanger(bullets: Int32Array, tau: number): { red: Set<number>; amber: Set<number> } {
  return { red: spireDangerTiles(bullets, tau + 1), amber: spireDangerTiles(bullets, tau + 2) };
}

/** Origin index of a bullet's origin (0 centre, 1-8 pillars), or -1. */
function originIndex(x: number, z: number): number {
  for (let i = 0; i < SPIRE_ORIGINS.length; i++) if (SPIRE_ORIGINS[i].x === x && SPIRE_ORIGINS[i].z === z) return i;
  return -1;
}

const T0 = { x: 0, z: 0 };

/**
 * Charge telegraphs for volleys firing in (τ, τ+3]: rings and fans (from the centre or a pillar) show
 * their first 3 ray tiles on the floor and light their pillar; walls and sheets show the entering edge
 * row (one tile per lane), so the gap is left dark.
 */
export function chargeTelegraph(bullets: Int32Array, tau: number): { tiles: Set<number>; pillars: Set<number>; fireTicks: Set<number> } {
  const tiles = new Set<number>(), pillars = new Set<number>(), fireTicks = new Set<number>();
  const n = Math.floor(bullets.length / BULLET_STRIDE);
  for (let i = 0; i < n; i++) {
    const o = i * BULLET_STRIDE, F = bullets[o];
    if (F <= tau || F > tau + 3) continue;
    fireTicks.add(F);
    // Wall and sheet lanes travel one tile per step along an axis (direction (0, 1) and its turns); rings
    // and fans use the 16 directions or an aimed turn, whose larger component is at least 2.
    const wall = Math.max(Math.abs(bullets[o + 3]), Math.abs(bullets[o + 4])) === 1;
    const origin = wall ? -1 : originIndex(bullets[o + 1], bullets[o + 2]);
    if (origin > 0) pillars.add(origin);
    const want = wall ? 1 : 3;
    let got = 0, last = -1;
    for (let h = 0; h <= 36 && got < want; h++) {
      if (!bulletTileAt(bullets, i, h, T0)) break;
      const key = tileKey(T0);
      if (key === last) continue;
      last = key;
      if (spireStandable(T0)) { tiles.add(key); got++; }
      else if (got > 0) break;
    }
  }
  return { tiles, pillars, fireTicks };
}

/** Green dots: every winning, hit-free destination of your next move (the moves agents receive). */
export function assistDots(safety: SpireSafety | null, tau: number, me: Tile): Set<number> {
  const out = new Set<number>();
  if (!safety || tau < safety.from) return out;
  for (const m of safety.movesFrom(tau, me)) if (!m.hit && m.winning) out.add(tileKey(m.end));
  return out;
}

export type HoverKind = 'safe' | 'risky' | 'hit';
export interface HoverVerdict { tile: Tile; kind: HoverKind; half: 0 | 1 | 2; damage: number }

/**
 * The safe-move hover for a floor tile within Chebyshev 2 of your true tile: the swept move you would
 * make in τ+1 (with its canonical middle), so it catches the swap, crossing and diagonal-slip cases the
 * stationary overlay cannot draw. green = hit-free and winning, amber = hit-free but not winning,
 * red = hit (with the damage).
 */
export function hoverVerdict(
  bullets: Int32Array, tau: number, me: Tile, tile: Tile, safety: SpireSafety | null, blocked: Set<number>, damage: number,
): HoverVerdict | null {
  if (!spireStandable(tile) || !spireStandable(me) || chebyshev(me, tile) > 2) return null;
  const mid = spireMiddle(me, tile, blocked);
  const half = spireHitsMove(bullets, tau + 1, me, mid, tile);
  if (half) return { tile, kind: 'hit', half, damage };
  const winning = !safety || tau + 1 < safety.from ? true : safety.winning(tau + 1, tile);
  return { tile, kind: winning ? 'safe' : 'risky', half: 0, damage: 0 };
}

/**
 * The fight's safety table, shared with /danger through WP3's `spireSafetyCached` (built once per pattern rotation,
 * from the intro so the first pattern's winning tiles are known). `_bullets` is the same `spireFightBullets(fight)`
 * the cache builds from; it stays in the signature so callers keep their memo dependency.
 */
export function fightSafety(runKey: string, fight: SpireFightLike, _bullets: Int32Array, blocked: Set<number>): SpireSafety {
  return spireSafetyCached(runKey, fight, SPIRE_RULES_VERSION, blocked);
}
