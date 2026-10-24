import { routeAim, type RouteCache, type Tile } from '../../../shared/sim';
import { instanceState } from './activePlayers';
import { hex } from './players';
import type { Ctx, PlayerRow } from './types';

/**
 * Walkers' planned routes between ticks (shared/sim/pathfinding.ts routePath),
 * by identity hex. Only a speed-up: a missing or stale entry is searched
 * afresh with the same result length, so a module restart changes nothing a
 * player can see.
 */
export const ROUTES: RouteCache = new Map();

/**
 * Keep the route a reducer just searched to validate a walk (setTarget), so the
 * tick's first step reuses it instead of searching the same route again.
 * Stored only against the tick's own blocked set (lib/blocked.ts), with the
 * walker's keys, exactly as the tick would key it; the tick still checks the
 * walker stands at its start and the next steps are legal.
 */
export function seedRoute(ctx: Ctx, p: PlayerRow, goal: Tile, path: Tile[], keys: { stick: boolean; club: boolean }, blocked: Set<number>): void {
  const cached = instanceState(ctx).blocked;
  if (!cached || cached.set !== blocked || !path.length) return;
  ROUTES.set(hex(p.identity), {
    aim: routeAim(goal), ruleKey: `${+keys.stick}${+keys.club}`, version: cached.version, origin: { x: p.x, z: p.z }, path,
  });
}
