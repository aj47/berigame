import type { Identity } from 'spacetimedb';
import { eventCell } from '../../../shared/sim/interest';
import type { Ctx } from './types';

export interface CombatEventInput {
  tick: number;
  kind: number;
  attacker: Identity;
  defender: Identity;
  damage?: number;
  itemId?: string;
  defenderHp?: number;
  /** Where it happened (shared/sim/interest.ts area subscriptions). Omitted = -1, -1: global. */
  x?: number;
  z?: number;
  /** The region of x, z (default Bramblewild): the cell is per region. */
  region?: string;
}

export function emitEvent(ctx: Ctx, e: CombatEventInput): void {
  ctx.db.combatEvent.insert({
    tick: e.tick,
    kind: e.kind,
    attacker: e.attacker,
    defender: e.defender,
    damage: e.damage ?? 0,
    itemId: e.itemId ?? '',
    defenderHp: e.defenderHp ?? 0,
    x: e.x ?? -1,
    z: e.z ?? -1,
    cell: eventCell(e.region, e.x ?? -1, e.z ?? -1),
  });
}
