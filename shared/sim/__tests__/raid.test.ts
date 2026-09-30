import { describe, expect, it } from 'vitest';
import {
  RAID_ANNOUNCE_LEADS_MS, RAID_HP_BASE, RAID_HP_MAX_PLAYERS, RAID_HP_PER_PLAYER, RAID_INTERVAL_MS, RAID_MIN_CONTRIBUTION, RAID_WINDOW_MS,
  formatCountdown, nextRaidWakeMs, raidDue, raidMaxHp, raidRewardees, raidStatus,
} from '../raid';
import { GiantState, giantHpAt, stepGiant, freshGiant } from '../giant';
import { MENTOR_MIN_AGE_MS, MENTOR_RANGE, chooseMentor, isVeteranOf, mentorEligible, mentorTier } from '../mentor';
import { COSMETICS, Cosmetic, MENTOR_PIN_COSMETICS, getCosmetic } from '../skills';

const H = 60 * 60 * 1000;
const us = (ms: number) => BigInt(ms) * 1000n;
const asleep = (wakeMs: number, announced = 0) => ({ awake: false, nextWakeAtMicros: us(wakeMs), raidEndsAtMicros: 0n, announced });

describe('raid schedule math', () => {
  it('wakes every 3 hours on the UTC hour grid, strictly after now', () => {
    expect(RAID_INTERVAL_MS).toBe(3 * H);
    expect(nextRaidWakeMs(0)).toBe(3 * H);
    expect(nextRaidWakeMs(3 * H - 1)).toBe(3 * H);
    expect(nextRaidWakeMs(3 * H)).toBe(6 * H);
    const d = Date.UTC(2026, 8, 30, 13, 7, 0);
    expect(new Date(nextRaidWakeMs(d)).toISOString()).toBe('2026-09-30T15:00:00.000Z');
  });

  it('announces T-10 then T-1 once each; a late start skips straight to the shortest due lead', () => {
    const wake = 6 * H;
    expect(raidDue(asleep(wake), wake - 11 * 60_000)).toEqual({ kind: 'none' });
    const ten = raidDue(asleep(wake), wake - RAID_ANNOUNCE_LEADS_MS[0]);
    expect(ten).toEqual({ kind: 'announce', minutes: 10, announced: 1 });
    expect(raidDue(asleep(wake, 1), wake - 5 * 60_000)).toEqual({ kind: 'none' });
    expect(raidDue(asleep(wake, 1), wake - 30_000)).toEqual({ kind: 'announce', minutes: 1, announced: 3 });
    expect(raidDue(asleep(wake, 3), wake - 1)).toEqual({ kind: 'none' });
    // Module came up at T-30 s: only the 1-minute warning, marking both sent.
    expect(raidDue(asleep(wake), wake - 30_000)).toEqual({ kind: 'announce', minutes: 1, announced: 3 });
  });

  it('wakes on time, reschedules a raid missed entirely, sleeps when the window ends', () => {
    const wake = 6 * H;
    expect(raidDue(asleep(wake, 3), wake)).toEqual({ kind: 'wake' });
    expect(raidDue(asleep(wake, 3), wake + RAID_WINDOW_MS - 1)).toEqual({ kind: 'wake' });
    expect(raidDue(asleep(wake, 3), wake + RAID_WINDOW_MS)).toEqual({ kind: 'missed' });
    const awake = { awake: true, nextWakeAtMicros: 0n, raidEndsAtMicros: us(wake + RAID_WINDOW_MS), announced: 0 };
    expect(raidDue(awake, wake + 1000)).toEqual({ kind: 'none' });
    expect(raidDue(awake, wake + RAID_WINDOW_MS)).toEqual({ kind: 'sleep' });
    expect(RAID_WINDOW_MS).toBe(15 * 60_000);
  });

  it('countdown text for the HUD', () => {
    expect(formatCountdown(754_000, 0)).toBe('12:34');
    expect(formatCountdown(3_723_000, 0)).toBe('1:02:03');
    expect(formatCountdown(0, 5000)).toBe('0:00');
    expect(raidStatus(asleep(754_000), 0)?.label).toBe('The Giant wakes in 12:34');
    expect(raidStatus({ awake: true, nextWakeAtMicros: 0n, raidEndsAtMicros: us(60_000), announced: 0 }, 0)).toMatchObject({ awake: true, label: 'Giant raid! 1:00 left' });
    expect(raidStatus(null, 0)).toBeNull();
  });
});

describe('raid HP and rewards', () => {
  it('scales with players in the Boulders at the wake, bounded both ways', () => {
    expect(raidMaxHp(0)).toBe(RAID_HP_BASE);
    expect(raidMaxHp(1)).toBe(RAID_HP_BASE);
    expect(raidMaxHp(2)).toBe(RAID_HP_BASE + RAID_HP_PER_PLAYER);
    expect(raidMaxHp(RAID_HP_MAX_PLAYERS)).toBe(2000);
    expect(raidMaxHp(500)).toBe(2000);
    expect(raidMaxHp(NaN)).toBe(RAID_HP_BASE);
  });

  it('shares rewards equally among everyone at or past the threshold', () => {
    const rows = [{ damage: RAID_MIN_CONTRIBUTION - 1 }, { damage: RAID_MIN_CONTRIBUTION }, { damage: 900 }];
    expect(raidRewardees(rows)).toEqual(rows.slice(1));
  });

  it('an asleep Giant never acts and always reads full HP', () => {
    const g = { ...freshGiant(0), state: GiantState.Asleep, hp: 10 };
    expect(stepGiant(g, 50, [{ x: g.x - 2, z: g.z, order: 0 }])).toEqual({ next: null });
    expect(giantHpAt(g, 1)).toBe(g.maxHp);
  });

  it('the raid and mentor keepsakes are cosmetics with fresh bit ids', () => {
    for (const id of [Cosmetic.GiantsTooth, Cosmetic.WelcomedRibbon, ...MENTOR_PIN_COSMETICS]) {
      expect(getCosmetic(id)?.id).toBe(id);
      expect(id).toBeLessThan(32);
    }
    expect(new Set(COSMETICS.map((c) => c.id)).size).toBe(COSMETICS.length);
  });
});

describe('mentor eligibility (pure)', () => {
  const DAY = MENTOR_MIN_AGE_MS;
  const newbie = { hex: 'n', firstJoinMs: 10 * DAY };
  const cand = (over: Partial<Parameters<typeof mentorEligible>[1]>) => ({
    hex: 'm', firstJoinMs: 8 * DAY, firstCraftMs: null, inviter: false, mutualFriend: true, distance: 3, ...over,
  });

  it('the mentor must be the veteran: a day older, or crafted before the newcomer joined', () => {
    expect(isVeteranOf({ hex: 'm', firstJoinMs: 9 * DAY }, newbie)).toBe(true);
    expect(isVeteranOf({ hex: 'm', firstJoinMs: 9 * DAY + 1 }, newbie)).toBe(false);
    expect(isVeteranOf({ hex: 'm', firstJoinMs: 10 * DAY - 5, firstCraftMs: 10 * DAY - 1 }, newbie)).toBe(true);
    expect(isVeteranOf({ hex: 'm', firstJoinMs: 10 * DAY - 5, firstCraftMs: 10 * DAY + 1 }, newbie)).toBe(false);
  });

  it('inviter anywhere, or a mutual friend within range', () => {
    expect(mentorEligible(newbie, cand({ inviter: true, mutualFriend: false, distance: null }))).toBe(true);
    expect(mentorEligible(newbie, cand({ distance: MENTOR_RANGE }))).toBe(true);
    expect(mentorEligible(newbie, cand({ distance: MENTOR_RANGE + 1 }))).toBe(false);
    expect(mentorEligible(newbie, cand({ distance: null }))).toBe(false);
    expect(mentorEligible(newbie, cand({ mutualFriend: false }))).toBe(false);
    expect(mentorEligible(newbie, cand({ hex: 'n' }))).toBe(false);
  });

  it('prefers the inviter, then the nearest friend', () => {
    const near = cand({ hex: 'near', distance: 1 });
    const far = cand({ hex: 'far', distance: 6 });
    const inviter = cand({ hex: 'inv', inviter: true, mutualFriend: false, distance: null });
    expect(chooseMentor(newbie, [far, near])?.hex).toBe('near');
    expect(chooseMentor(newbie, [far, near, inviter])?.hex).toBe('inv');
    expect(chooseMentor(newbie, [])).toBeNull();
  });

  it('pin tiers at 1, 3 and 10 mentees', () => {
    expect([0, 1, 2, 3, 9, 10, 40].map(mentorTier)).toEqual([-1, 0, 0, 1, 1, 2, 2]);
  });
});
