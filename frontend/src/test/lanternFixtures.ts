import { LANTERN_SPAWNS, SpireMemberState, SpireOutcome, SpireStage, lanternEmptySlots, lanternFreshFight } from '@sim';
import { useBossStore } from '../bosses/bossStore';
import { identity } from './spireFixtures';

/** Lanternmaw rows for DOM tests, written through the real bossStore setters. */
export { identity };

export function lanternRun(over: Record<string, unknown> = {}): any {
  return {
    id: 11n, leader: identity('me'), stage: SpireStage.Active, outcome: SpireOutcome.None, rules: 2, partySize: 2,
    createdTick: 50, startTick: 105, endTick: 705, phase: 1, clearTicks: 0, ...over,
  };
}

export function lanternMember(hex: string, over: Record<string, unknown> = {}): any {
  return { identity: identity(hex), runId: 11n, slot: 0, state: SpireMemberState.In, joinedTick: 50, awaySinceTick: 0, awayCount: 0, meals: 0, ...over };
}

/** A fresh fight row (first den pattern published at the start tick 105), with overrides. */
export function lanternFight(over: Record<string, unknown> = {}): any {
  return { runId: 11n, ...lanternFreshFight(4242, 2, 105, [LANTERN_SPAWNS[0], LANTERN_SPAWNS[1]], 1780), ...lanternEmptySlots(), ...over };
}

/** Seed the store: you ('me') and a teammate ('ada') in lantern run 11 with a fight row. */
export function seedLantern(run: Record<string, unknown> = {}, members: Record<string, Record<string, unknown>> = {}, fight: Record<string, unknown> | null = {}) {
  const s = useBossStore.getState();
  s.reset();
  s.setMe('me');
  s.setRow('lanternRun', lanternRun(run));
  s.setRow('lanternMember', lanternMember('me', { slot: 0, ...members.me }));
  s.setRow('lanternMember', lanternMember('ada', { slot: 1, ...members.ada }));
  if (fight) s.setRow('lanternFight', lanternFight(fight));
}
