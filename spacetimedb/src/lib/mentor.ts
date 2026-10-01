import type { Identity } from 'spacetimedb';
import {
  Cosmetic, MENTOR_PIN_COSMETICS, MENTOR_PIN_TIERS, PlayerState, SocialNotice, chebyshev, chooseMentor, MentorMilestone, type MentorCandidate,
} from '../../../shared/sim';
import { findPlayer, hex, sameId } from './players';
import { unlockCosmetic } from './progress';
import { notify, notifyThrottled } from './social';
import type { Ctx, MenteeRow } from './types';

const ms = (t: { microsSinceUnixEpoch: bigint } | undefined | null) => (t ? Number(t.microsSinceUnixEpoch / 1000n) : null);

function menteeRow(ctx: Ctx, id: Identity): { row: MenteeRow; stored: boolean } {
  const row = ctx.db.mentee.identity.find(id);
  return row ? { row, stored: true } : { row: { identity: id, inviter: undefined, mentor: undefined, creditedAt: undefined, milestones: 0 }, stored: false };
}

function saveMentee(ctx: Ctx, row: MenteeRow, stored: boolean): void {
  if (stored) ctx.db.mentee.identity.update(row);
  else ctx.db.mentee.insert(row);
}

/** Remember whose invite link a player first redeemed (the first one sticks). */
export function recordInviter(ctx: Ctx, joiner: Identity, inviter: Identity): void {
  const { row, stored } = menteeRow(ctx, joiner);
  if (row.inviter || row.mentor) return;
  saveMentee(ctx, { ...row, inviter }, stored);
}

function hasFriend(ctx: Ctx, owner: Identity, other: Identity): boolean {
  for (const f of ctx.db.friend.owner.filter(owner)) if (sameId(f.friend, other)) return true;
  return false;
}

/**
 * A newcomer hit a mentor milestone (their first step onto the Coast, their
 * first stone club). The first time a mentor qualifies (shared/sim/mentor.ts),
 * both get a keepsake and a notice; one credit per newcomer, ever. Reads only
 * the newcomer's friends (at most MAX_FRIENDS) and their inviter. Best-effort:
 * never breaks the reducer that called it.
 */
export function mentorMilestone(ctx: Ctx, newbie: { identity: Identity; x: number; z: number; name?: string }, milestone: MentorMilestone): void {
  try {
    const { row, stored } = menteeRow(ctx, newbie.identity);
    if (row.mentor || (row.milestones & milestone) !== 0) return;
    const next: MenteeRow = { ...row, milestones: row.milestones | milestone };
    const stats = ctx.db.playStats.identity.find(newbie.identity);
    const mentor = stats ? findMentor(ctx, newbie, row.inviter, ms(stats.firstJoinAt)!) : null;
    if (!mentor) { saveMentee(ctx, next, stored); return; }
    saveMentee(ctx, { ...next, mentor, creditedAt: ctx.timestamp }, stored);
    creditMentor(ctx, mentor, newbie, milestone);
  } catch {
    /* cosmetic only: never let it break gameplay */
  }
}

function findMentor(ctx: Ctx, newbie: { identity: Identity; x: number; z: number }, inviter: Identity | undefined, firstJoinMs: number): Identity | null {
  const ids = new Map<string, Identity>();
  if (inviter) ids.set(hex(inviter), inviter);
  for (const f of ctx.db.friend.owner.filter(newbie.identity)) ids.set(hex(f.friend), f.friend);
  const candidates: MentorCandidate[] = [];
  for (const [h, id] of ids) {
    const stats = ctx.db.playStats.identity.find(id);
    if (!stats) continue;
    const p = findPlayer(ctx, id);
    const up = p && p.online && p.state === PlayerState.Alive;
    candidates.push({
      hex: h,
      firstJoinMs: ms(stats.firstJoinAt)!,
      firstCraftMs: ms(stats.firstCraftAt),
      inviter: !!inviter && sameId(inviter, id),
      mutualFriend: hasFriend(ctx, newbie.identity, id) && hasFriend(ctx, id, newbie.identity),
      distance: up ? chebyshev(p!, newbie) : null,
    });
  }
  const best = chooseMentor({ hex: hex(newbie.identity), firstJoinMs }, candidates);
  return best ? ids.get(best.hex)! : null;
}

function creditMentor(ctx: Ctx, mentor: Identity, newbie: { identity: Identity; name?: string }, milestone: MentorMilestone): void {
  const stat = ctx.db.mentorStat.identity.find(mentor);
  const mentees = (stat?.mentees ?? 0) + 1;
  if (stat) ctx.db.mentorStat.identity.update({ ...stat, mentees });
  else ctx.db.mentorStat.insert({ identity: mentor, mentees });
  MENTOR_PIN_TIERS.forEach((n, i) => { if (mentees >= n) unlockCosmetic(ctx, mentor, MENTOR_PIN_COSMETICS[i]); });
  unlockCosmetic(ctx, newbie.identity, Cosmetic.WelcomedRibbon);
  const mentorName = findPlayer(ctx, mentor)?.name ?? 'your mentor';
  const newbieName = newbie.name ?? findPlayer(ctx, newbie.identity)?.name ?? 'A newer player';
  const what = milestone === MentorMilestone.Coast ? 'reached the Coast' : 'made their first stone club';
  notify(ctx, newbie.identity, mentor, SocialNotice.Mentor, `Welcomed! ${mentorName} showed you the way. You both earned a keepsake.`);
  notifyThrottled(ctx, mentor, newbie.identity, SocialNotice.Mentor,
    `${newbieName} ${what} with your help. Mentor's Pin: ${mentees} mentee${mentees === 1 ? '' : 's'}.`);
}
