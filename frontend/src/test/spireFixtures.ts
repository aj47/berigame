import { SPIRE_NONE, SpireMemberState, SpireMode, SpireOutcome, SpireStage } from '@sim';
import { useBossStore } from '../bosses/bossStore';

/** Spire rows for DOM tests, written through the real bossStore setters. */
export const identity = (hex: string) => ({ toHexString: () => hex, __identity__: hex });

export function spireRun(over: Record<string, unknown> = {}): any {
  return {
    id: 7n, leader: identity('me'), stage: SpireStage.Active, outcome: SpireOutcome.None, mode: SpireMode.Normal, isPublic: true,
    rules: 1, partySize: 2, createdTick: 50, queuedTick: 0, startTick: 105, endTick: 705, phase: 1, clearTicks: 0, ...over,
  };
}

export function spireMember(hex: string, over: Record<string, unknown> = {}): any {
  return {
    identity: identity(hex), runId: 7n, slot: 0, state: SpireMemberState.In, joinedTick: 50, awaySinceTick: 0, awayCount: 0,
    downUntilTick: 0, reviveSinceTick: 0, meals: 0, ...over,
  };
}

export function spireFight(over: Record<string, unknown> = {}): any {
  return {
    runId: 7n, hp: 1830, maxHp: 2400, phase: 2, seed: 99, patternCount: 3,
    curKind: 3, curStart: 140, curSeed: 4, curAimX: 74, curAimZ: 66,
    prevKind: SPIRE_NONE, prevStart: 0, prevSeed: 0, prevAimX: 0, prevAimZ: 0, starWave: 3, starMask: 0b1,
    hitTick0: 0, hitTick1: 0, hitTick2: 0, hitTick3: 0, hits0: 2, hits1: 0, hits2: 0, hits3: 0,
    stars0: 5, stars1: 4, stars2: 0, stars3: 0, dmg0: 120, dmg1: 90, dmg2: 0, dmg3: 0, downs0: 0, downs1: 0, downs2: 0, downs3: 0,
    ...over,
  };
}

/** Seed the store: you ('me') and a teammate ('ada') in run 7 with a fight row. */
export function seedRun(run: Record<string, unknown> = {}, members: Record<string, Record<string, unknown>> = {}, fight: Record<string, unknown> | null = {}) {
  const s = useBossStore.getState();
  s.reset();
  s.setMe('me');
  s.setRow('spireRun', spireRun(run));
  s.setRow('spireMember', spireMember('me', { slot: 0, ...members.me }));
  s.setRow('spireMember', spireMember('ada', { slot: 1, ...members.ada }));
  if (fight) s.setRow('spireFight', spireFight(fight));
}
