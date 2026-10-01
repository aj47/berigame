import { carrying, duelFor } from '../lib/adventure';
import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { DUMMY_ID, MELEE_RANGE, Pending, chebyshev, emoteReady, isEmote } from '../../../shared/sim';
import { blockedTiles } from '../lib/blocked';
import { interactionTile } from '../lib/brambles';
import { clearInteractions, currentTick, requireAlivePlayer, savePlayer, touchInput } from '../lib/players';
import { ensureDummy } from '../lib/dummy';

/**
 * Walk up to a training dummy and keep swinging at it with whatever you hold.
 * Open to everyone (no combat grant): it harms nobody, and it works inside the
 * safe ring and during grace, which it does not end. Moving, harvesting,
 * attacking a player or being hit stops it.
 */
export const attackDummy = spacetimedb.reducer(
  { dummyId: t.u32() },
  (ctx, { dummyId }) => {
    const p = requireAlivePlayer(ctx);
    if (carrying(ctx, p.identity)) throw new SenderError("Put down the giant berry first; it needs both hands");
    const dummy = dummyId === DUMMY_ID ? ensureDummy(ctx) : ctx.db.trainingDummy.id.find(dummyId);
    if (!dummy) throw new SenderError('no such dummy');
    const T = currentTick(ctx);
    touchInput(p, T);
    // Re-selecting the dummy you are already hitting keeps the swing rhythm.
    if (p.pending === Pending.Dummy && p.pendingId === BigInt(dummy.id) && !p.combatTarget) {
      savePlayer(ctx, p);
      return;
    }
    const readyAt = p.nextSwingTick;
    clearInteractions(ctx, p);
    if (chebyshev(p, dummy) > MELEE_RANGE) {
      const dest = interactionTile(ctx, p, dummy, blockedTiles(ctx), MELEE_RANGE);
      p.targetX = dest.x;
      p.targetZ = dest.z;
    }
    p.pending = Pending.Dummy;
    p.pendingId = BigInt(dummy.id);
    p.nextSwingTick = Math.max(readyAt, T + 1);
    savePlayer(ctx, p);
  }
);

/**
 * A cosmetic emote (shared/sim Emote), broadcast through the emote_event
 * table. Rate limited by touchInput and a short per-player cooldown. It does
 * not change what you are doing; clients end the pose when you move or act.
 */
export const emote = spacetimedb.reducer(
  { emote: t.u8() },
  (ctx, { emote }) => {
    if (!isEmote(emote)) throw new SenderError('unknown emote');
    const p = requireAlivePlayer(ctx);
    if (carrying(ctx, p.identity)) throw new SenderError("Put down the giant berry first; it needs both hands");
    const T = currentTick(ctx);
    touchInput(p, T);
    const last = ctx.db.emoteCooldown.identity.find(p.identity);
    if (!emoteReady(last?.lastTick, T)) throw new SenderError('slow down');
    if (last) ctx.db.emoteCooldown.identity.update({ ...last, lastTick: T });
    else ctx.db.emoteCooldown.insert({ identity: p.identity, lastTick: T });
    ctx.db.emoteEvent.insert({ tick: T, player: p.identity, emote });
    savePlayer(ctx, p);
  }
);
