import { t, SenderError } from 'spacetimedb/server';
import type { Identity } from 'spacetimedb';
import spacetimedb from '../schema';
import {
  Cosmetic, HEDGE_RING, INVITE_TTL_MICROS, MAX_FRIENDS, PlayerState, SocialNotice, chebyshev, generateInviteCode, joinSpot, normalizeInviteCode, ringOf,
} from '../../../shared/sim';
import { blockedTiles } from '../lib/blocked';
import { heldKeys } from '../lib/brambles';
import { clearInteractions, currentTick, findPlayer, requirePlayer, sameId, savePlayer, touchInput } from '../lib/players';
import { notify } from '../lib/social';
import { unlockCosmetic } from '../lib/progress';
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
    befriend(ctx, p.identity, inviter.identity);
    befriend(ctx, inviter.identity, p.identity);

    let text: string;
    const attacked = [...ctx.db.player.iter()].some((o) => o.online && o.hostile && sameId(o.combatTarget, p.identity));
    if (!inviter.online || inviter.state !== PlayerState.Alive) {
      text = `${inviter.name} is your friend now. They are not around right now.`;
    } else if (p.state !== PlayerState.Alive) {
      text = `${inviter.name} is your friend now. Use Go to once you are back on your feet.`;
    } else if ((p.combatTarget && p.hostile) || attacked) {
      text = `${inviter.name} is your friend now. Finish your fight, then use Go to.`;
    } else if (chebyshev(p, inviter) <= 2) {
      text = `${inviter.name} is your friend now.`;
    } else {
      const keys = heldKeys(ctx, p);
      const spot = joinSpot(inviter, keys.stick, blockedTiles(ctx), keys.club);
      clearInteractions(ctx, p);
      p.x = spot.tile.x;
      p.z = spot.tile.z;
      // Landing past the hedge counts as reaching the Coast, like play_stats (the tick only sees walked steps).
      if (ringOf(p) > HEDGE_RING) unlockCosmetic(ctx, p.identity, Cosmetic.CoastScarf);
      text = spot.barrier === 'boulders'
        ? `${inviter.name} is past the boulder line. You need a stone club to reach them, so you landed at the nearest spot on the Coast.`
        : spot.clamped
        ? `${inviter.name} is past the brambles. You need a sturdy stick to reach them, so you washed up at the nearest spot in the Grove.`
        : `You joined ${inviter.name}.`;
    }
    savePlayer(ctx, p);
    notify(ctx, p.identity, inviter.identity, SocialNotice.InviteJoined, text);
    notify(ctx, inviter.identity, p.identity, SocialNotice.FriendAdded, `${p.name} joined with your invite link`);
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
    notify(ctx, target, p.identity, SocialNotice.FriendAdded, `${p.name} added you as a friend`);
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
