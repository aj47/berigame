import { PlayerState, inGrace, inSafeRing } from '@sim';
import { regionalPvPProblem } from '../../../shared/sim/frontier/combat';
import type { FrontierSnapshot } from '../../../shared/sim/frontier/snapshot';
import type { Player } from '../module_bindings/types';

/** Public, live combat restrictions; private access grants remain server-checked. */
export function playerAttackProblem(me: Player | undefined | null, target: Player, frontier: Pick<FrontierSnapshot, 'plots'> | undefined, tick: number, now = Date.now()): string | null {
  if (!me || me.state !== PlayerState.Alive) return 'Wait until you respawn to attack.';
  if (me.identity.toHexString() === target.identity.toHexString()) return 'You cannot attack yourself.';
  if (!target.online || target.state !== PlayerState.Alive) return 'This player is no longer available.';
  const region = me.region || 'bramblewild';
  if (region !== (target.region || 'bramblewild')) return 'This player is in another district.';
  if (region === 'sea') return 'Disembark before fighting.';
  if (region === 'bramblewild') {
    if (inSafeRing(me) || inSafeRing(target)) return 'No fighting in the safe ring.';
    if (inGrace(target, tick)) return 'This player is temporarily protected after respawning.';
    return null;
  }
  const actor = (p: Player) => ({ id: p.identity.toHexString(), region: (p.region || 'bramblewild') as any, x: p.x, z: p.z, online: p.online, alive: p.state === PlayerState.Alive });
  return regionalPvPProblem(actor(me), actor(target), frontier?.plots.flatMap(plot => plot.claim ? [plot.claim] : []) ?? [], now);
}
