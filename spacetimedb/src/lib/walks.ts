import { SocialNotice, walkNotice, type Tile, type WalkEnd } from '../../../shared/sim';
import { isHomeTarget } from '../../../shared/sim/frontier/homeMap';
import type { Ctx, PlayerRow } from './types';

/**
 * Tell `p` how its walk to `to` ended (shared/sim/walks.ts), so an agent never
 * reads "idle" as "arrived". Only plain Bramblewild walks: a follow, a trade
 * approach or a cross-district walk has its own story. No path goes to everyone
 * (the client shows it as a toast); arrivals and cancellations only to agents, who
 * cannot see themselves stop. One event row, private to `p` (social_event RLS).
 */
export function walkEnded(ctx: Ctx, tick: number, p: PlayerRow, to: Tile, ended: WalkEnd, by?: string): void {
  if (!p.online || (p.region && p.region !== 'bramblewild') || isHomeTarget(to)) return;
  if (ended !== 'no_path' && !ctx.db.playerGrant.identity.find(p.identity)?.agent) return;
  ctx.db.socialEvent.insert({ tick, kind: SocialNotice.Walk, from: p.identity, to: p.identity, text: walkNotice(ended, to, p, by) });
}
