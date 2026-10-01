/**
 * Mentor rewards: when a newer player first reaches the Coast or makes their
 * first stone club, a mentor who helped them earns a keepsake (Mentor's Pin,
 * in tiers by mentee count) and the newcomer the Welcomed Ribbon. Cosmetic
 * only. Pure rules shared by the module and tests.
 *
 * A mentor is either the player whose invite link the newcomer redeemed, or a
 * mutual friend (both lists) online and alive within MENTOR_RANGE tiles at the
 * moment. Anti-abuse: the mentor must be the veteran (joined at least
 * MENTOR_MIN_AGE_MS earlier, or had already made something before the
 * newcomer ever joined, i.e. already held the key to the Boulders); one credit
 * per newcomer, ever; nobody mentors themselves.
 */

export const MENTOR_RANGE = 8;
/** The mentor joined at least a day before the newcomer. */
export const MENTOR_MIN_AGE_MS = 24 * 60 * 60 * 1000;
/** Mentee counts at which the pin gets a finer variant. */
export const MENTOR_PIN_TIERS = [1, 3, 10] as const;

/** `mentee.milestones` bits (u8). */
export const MentorMilestone = { Coast: 1, Club: 2 } as const;
export type MentorMilestone = (typeof MentorMilestone)[keyof typeof MentorMilestone];

export interface MentorPerson {
  hex: string;
  /** play_stats.firstJoinAt, ms since the epoch. */
  firstJoinMs: number;
  /** play_stats.firstCraftAt, ms (null: never made anything). */
  firstCraftMs?: number | null;
}

export interface MentorCandidate extends MentorPerson {
  /** Their invite link is the one the newcomer redeemed. */
  inviter: boolean;
  /** Each has the other on their friends list. */
  mutualFriend: boolean;
  /** Chebyshev tiles to the newcomer; null when offline or down. */
  distance: number | null;
}

/** The candidate is the veteran of the pair. */
export function isVeteranOf(mentor: MentorPerson, newbie: MentorPerson): boolean {
  if (mentor.firstJoinMs <= newbie.firstJoinMs - MENTOR_MIN_AGE_MS) return true;
  return mentor.firstCraftMs != null && mentor.firstCraftMs < newbie.firstJoinMs;
}

export function mentorEligible(newbie: MentorPerson, c: MentorCandidate): boolean {
  if (c.hex === newbie.hex) return false;
  if (!isVeteranOf(c, newbie)) return false;
  if (c.inviter) return true;
  return c.mutualFriend && c.distance !== null && c.distance <= MENTOR_RANGE;
}

/** The inviter first, then the nearest eligible friend (ties by hex). */
export function chooseMentor(newbie: MentorPerson, candidates: readonly MentorCandidate[]): MentorCandidate | null {
  const ok = candidates.filter((c) => mentorEligible(newbie, c));
  ok.sort((a, b) => Number(b.inviter) - Number(a.inviter)
    || (a.distance ?? Infinity) - (b.distance ?? Infinity)
    || (a.hex < b.hex ? -1 : a.hex > b.hex ? 1 : 0));
  return ok[0] ?? null;
}

/** The highest pin tier held at `count` mentees (-1: none). */
export function mentorTier(count: number): number {
  let tier = -1;
  MENTOR_PIN_TIERS.forEach((n, i) => { if (count >= n) tier = i; });
  return tier;
}
