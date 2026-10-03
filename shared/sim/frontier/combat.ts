import { REGIONS, type Location } from './catalog';
import { claimStatus, plotFor, type Claim } from './model';
import { distance } from './regions';

export type RegionalCombatant = Location & {
  id: string;
  online: boolean;
  alive: boolean;
  /** Omit when the caller cannot see admission capabilities. */
  combat?: boolean;
};

/** Shared public protection rules; approach distance and swing recovery are separate. */
export function regionalPvPProblem(a: RegionalCombatant, target: RegionalCombatant | undefined, claims: Claim[], now: number): string | null {
  if (target?.id === a.id) return 'You cannot attack yourself';
  if (!a.online || !a.alive || !target?.online || !target.alive) return 'That player is unavailable';
  if (a.region !== target.region) return 'That player is in another region';
  const contest = claims.some(c => c.challenge && now >= c.challenge.opens && now < c.challenge.closes
    && ((c.challenge.attackers.includes(a.id) && c.challenge.defenders.includes(target.id))
      || (c.challenge.defenders.includes(a.id) && c.challenge.attackers.includes(target.id)))
    && a.region === plotFor(c).region && distance(a, plotFor(c).marker) <= 6 && distance(target, plotFor(c).marker) <= 6);
  if (!contest) {
    if ([a, target].some(who => who.region === 'settlement' && distance(who, REGIONS.settlement.spawn) <= 4)) return 'No fighting in Meadows town';
    if (a.combat === false || target.combat === false) return 'Combat is not enabled for both players';
  }
  if (claims.some(c => claimStatus(c, now) === 'protected' && [a, target].some(who => {
    const plot = plotFor(c);
    return who.region === plot.region && who.x >= plot.x && who.x < plot.x + 16 && who.z >= plot.z && who.z < plot.z + 16;
  }))) return 'Paid homes are protected from player combat';
  return null;
}
