import { t, SenderError } from 'spacetimedb/server';
import type { Identity } from 'spacetimedb';
import spacetimedb from '../schema';
import {
  Cosmetic, areaOf, INVITE_TTL_MICROS, MentorMilestone, MAX_FRIENDS, PlayerState, SocialNotice, chebyshev, generateInviteCode, joinSpot, normalizeInviteCode,
} from '../../../shared/sim';
import { blockedTiles } from '../lib/blocked';
import { heldKeys } from '../lib/brambles';
import { clearInteractions, currentTick, findPlayer, requirePlayer, sameId, savePlayer, touchInput } from '../lib/players';
import { notify, notifyThrottled, readPair, writePair } from '../lib/social';
import { unlockCosmetic } from '../lib/progress';
import { mentorMilestone, recordInviter } from '../lib/mentor';
import type { Ctx } from '../lib/types';

function hasFriend(ctx: Ctx, owner: Identity, other: Identity): boolean {
  for (const row of ctx.db.friend.owner.filter(owner)) if (sameId(row.friend, other)) return true;
  return false;
}

/** Add `other` to `owner`'s list. Returns false when already there or the list is full. */
function befriend(ctx: Ctx, owner: Identity, other: Identity): boolean {
  if (sameId(owner, other) || hasFriend(ctx, owner, other)) return false;
  if ([...ctx.db.friend.owner.filter(owner)].length >= MAX_FRIENDS) return false;
  ctx.db.friend.insert({ id: 0n, owner, friend: other, since: ctx.timestamp });
  return true;
}

/**
 * Make (or replace) your "join me" code. The link carries only this code; it
 * lasts INVITE_TTL_MICROS. Reading it back: the invite_code row, visible only to you.
 */
export const createInvite = spacetimedb.reducer((ctx) => {
  const p = requirePlayer(ctx);
  touchInput(p, currentTick(ctx));
  savePlayer(ctx, p);
  const now = ctx.timestamp.microsSinceUnixEpoch;
  // Sweep expired codes here: rare, and the table holds one row per inviter at most.
  for (const row of [...ctx.db.inviteCode.iter()]) {
    if (row.expiresAtMicros <= now || sameId(row.inviter, p.identity)) ctx.db.inviteCode.code.delete(row.code);
  }
  let code = generateInviteCode(() => ctx.random());
  for (let i = 0; i < 8 && ctx.db.inviteCode.code.find(code); i++) code = generateInviteCode(() => ctx.random());
  if (ctx.db.inviteCode.code.find(code)) throw new SenderError('try again');
  ctx.db.inviteCode.insert({ code, inviter: p.identity, expiresAtMicros: now + INVITE_TTL_MICROS });
});

/**
 * Open someone's invite link: you become friends both ways and, when you can,
 * you wash up beside them. Never while you are in a fight or down; a joiner
 * without a stick lands at the nearest Grove tile when the inviter is past
 * the brambles (and is told why).
 */
export const redeemInvite = spacetimedb.reducer(
  { code: t.string() },
  (ctx, { code }) => {
    const p = requirePlayer(ctx);
    const T = currentTick(ctx);
    touchInput(p, T);
    const clean = normalizeInviteCode(code);
    const row = clean ? ctx.db.inviteCode.code.find(clean) : undefined;
    if (!row || row.expiresAtMicros <= ctx.timestamp.microsSinceUnixEpoch) throw new SenderError('That invite link has expired. Ask for a new one.');
    if (sameId(row.inviter, p.identity)) throw new SenderError('That is your own invite link');
    const inviter = findPlayer(ctx, row.inviter);
    if (!inviter) throw new SenderError('That invite link has expired. Ask for a new one.');
    // Codes are single-use per joiner: opening the same link again changes nothing.
    const redeemed = readPair(ctx, p.identity, inviter.identity);
    if (redeemed.redeemedCode === row.code) {
      notify(ctx, p.identity, inviter.identity, SocialNotice.Info,
        hasFriend(ctx, p.identity, inviter.identity)
          ? `You already used this invite link. ${inviter.name} is on your friends list: use Go to to join them.`
          : 'You already used this invite link. Ask for a new one.');
      return;
    }
    writePair(ctx, { ...redeemed, redeemedCode: row.code });
    recordInviter(ctx, p.identity, inviter.identity);
    befriend(ctx, p.identity, inviter.identity);
    const inviterAdded = befriend(ctx, inviter.identity, p.identity);
    // Only claim a friendship that exists (a full list refuses the add).
    const joinerHas = hasFriend(ctx, p.identity, inviter.identity);
    const inviterHas = hasFriend(ctx, inviter.identity, p.identity);
    const lead = joinerHas
      ? `${inviter.name} is your friend now.`
      : `Your friends list is full (${MAX_FRIENDS}), so ${inviter.name} was not added.`;

    let text: string;
    const attacked = [...ctx.db.player.iter()].some((o) => o.online && o.hostile && sameId(o.combatTarget, p.identity));
    if (!inviter.online || inviter.state !== PlayerState.Alive) {
      text = `${lead} They are not around right now.`;
    } else if (p.state !== PlayerState.Alive) {
      text = joinerHas ? `${lead} Use Go to once you are back on your feet.` : `${lead} You cannot join them while you are down.`;
    } else if ((p.combatTarget && p.hostile) || attacked) {
      text = joinerHas ? `${lead} Finish your fight, then use Go to.` : `${lead} You cannot join them mid-fight.`;
    } else if (chebyshev(p, inviter) <= 2) {
      text = joinerHas ? lead : `You are already beside ${inviter.name}. ${lead}`;
    } else {
      const keys = heldKeys(ctx, p);
      const spot = joinSpot(inviter, keys.stick, blockedTiles(ctx), keys.club);
      clearInteractions(ctx, p);
      p.x = spot.tile.x;
      p.z = spot.tile.z;
      // Landing past the hedge counts as reaching the Coast, like play_stats (the tick only sees walked steps).
      if ((areaOf(p) === 'coast' || areaOf(p) === 'boulders') && unlockCosmetic(ctx, p.identity, Cosmetic.CoastScarf)) mentorMilestone(ctx, p, MentorMilestone.Coast);
      text = spot.barrier === 'boulders'
        ? `${inviter.name} is past the boulder line. You need a stone club to reach them, so you landed at the nearest spot on the Coast.`
        : spot.clamped
        ? `${inviter.name} is past the brambles. You need a sturdy stick to reach them, so you washed up at the nearest spot in the Grove.`
        : `You joined ${inviter.name}.`;
      if (!joinerHas) text += ` ${lead}`;
    }
    savePlayer(ctx, p);
    notify(ctx, p.identity, inviter.identity, SocialNotice.InviteJoined, text);
    const inviterText = inviterAdded
      ? `${p.name} joined with your invite link and is on your friends list`
      : inviterHas
      ? `${p.name} joined with your invite link`
      : `${p.name} joined with your invite link. Your friends list is full, so they were not added.`;
    notify(ctx, inviter.identity, p.identity, SocialNotice.FriendAdded, inviterText);
    if (inviterAdded || joinerHas) {
      // They already know each other now: a later add is not news.
      writePair(ctx, { ...readPair(ctx, p.identity, inviter.identity), friendNoticed: true });
    }
  }
);

/** Add someone to your friends list (one-way: it shows you their status and area). */
export const addFriend = spacetimedb.reducer(
  { target: t.identity() },
  (ctx, { target }) => {
    const p = requirePlayer(ctx);
    touchInput(p, currentTick(ctx));
    savePlayer(ctx, p);
    const other = findPlayer(ctx, target);
    if (!other) throw new SenderError('no such player');
    if (sameId(target, p.identity)) throw new SenderError('that is you');
    if (hasFriend(ctx, p.identity, target)) return;
    if (!befriend(ctx, p.identity, target)) throw new SenderError(`Your friends list is full (${MAX_FRIENDS})`);
    // Told once per pair, ever (a remove + re-add is not news), and never
    // faster than the notice cooldown.
    if (!readPair(ctx, p.identity, target).friendNoticed) {
      notifyThrottled(ctx, target, p.identity, SocialNotice.FriendAdded, `${p.name} added you as a friend`, { friendNoticed: true });
    }
  }
);

export const removeFriend = spacetimedb.reducer(
  { target: t.identity() },
  (ctx, { target }) => {
    const p = requirePlayer(ctx);
    touchInput(p, currentTick(ctx));
    savePlayer(ctx, p);
    for (const row of [...ctx.db.friend.owner.filter(p.identity)]) {
      if (sameId(row.friend, target)) ctx.db.friend.id.delete(row.id);
    }
  }
);
