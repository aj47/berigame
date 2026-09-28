import type { Identity } from 'spacetimedb';
import type { Ctx } from './types';

export interface CombatEventInput {
  tick: number;
  kind: number;
  attacker: Identity;
  defender: Identity;
  damage?: number;
  itemId?: string;
  defenderHp?: number;
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
  });
}
