import { FRONTIER } from './catalog';
import type { Profile } from './model';

export const sameDisciplines = (active: readonly number[], choice: readonly number[]) =>
  active.length === choice.length && active.every(id => choice.includes(id));

/** Prices shown by the client and charged by the server share the same deadline. */
export function specializationSwitch(profile: Pick<Profile, 'active' | 'switchedAt'>, now: number) {
  const first = profile.active.length === 0;
  const readyAt = first ? 0 : profile.switchedAt + FRONTIER.switchCooldown;
  const waitMs = Math.max(0, readyAt - now);
  const normalCost = first ? 0 : FRONTIER.switchCost;
  return { first, readyAt, waitMs, normalCost, earlyCost: normalCost + (waitMs ? FRONTIER.earlySwitchExtraCost : 0) };
}
