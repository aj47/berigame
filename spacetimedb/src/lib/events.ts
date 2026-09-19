import type { Identity } from 'spacetimedb';
import type { Ctx } from './types';

export interface CombatEventInput {
  tick: number;
  kind: number;
  attacker: Identity;
  defender: Identity;
  damage?: number;
  attackerStance?: number;
  defenderStance?: number;
  attackerState?: number;
  defenderState?: number;
  defenderHp?: number;
}

export function emitEvent(ctx: Ctx, e: CombatEventInput): void {
  ctx.db.combatEvent.insert({
    tick: e.tick,
    kind: e.kind,
    attacker: e.attacker,
    defender: e.defender,
    damage: e.damage ?? 0,
    attackerStance: e.attackerStance ?? 0,
    defenderStance: e.defenderStance ?? 0,
    attackerState: e.attackerState ?? 0,
    defenderState: e.defenderState ?? 0,
    defenderHp: e.defenderHp ?? 0,
  });
}
