import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { CHAT_KEEP_ROWS, MAX_CHAT_LEN, NAME_MAX_LEN, NAME_MIN_LEN } from '../../../shared/sim';
import { currentTick, requirePlayer, savePlayer, touchInput } from '../lib/players';
import { requireCapability } from '../lib/access';
import { activity } from '../lib/activity';
import { idKey } from '../lib/playerStore';
import type { Ctx } from '../lib/types';
import type { Identity } from 'spacetimedb';

type ChatRow = NonNullable<ReturnType<Ctx['db']['chatMessage']['id']['find']>>;

/** `who`'s chat lines: by the sender index, or a scan in test harnesses without one. */
function ownLines(ctx: Ctx, who: Identity): Iterable<ChatRow> {
  const index = (ctx.db.chatMessage as unknown as { sender?: { filter(id: Identity): Iterable<ChatRow> } }).sender;
  if (index && typeof index.filter === 'function') return index.filter(who);
  const k = idKey(who);
  return Array.from(ctx.db.chatMessage.iter()).filter((m) => idKey(m.sender) === k);
}

export const sendChat = spacetimedb.reducer(
  { text: t.string() },
  (ctx, { text }) => {
    requireCapability(ctx, ctx.sender, 'chat');
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_CHAT_LEN) throw new SenderError('bad message length');
    const p = requirePlayer(ctx);
    const T = currentTick(ctx);
    // The sender's own lines through the sender index (no scan of the table, no identity-to-hex per row).
    for (const message of ownLines(ctx, p.identity)) {
      if (T - message.tick < 5) throw new SenderError('wait three seconds between messages');
    }
    touchInput(p, T);
    savePlayer(ctx, p);
    ctx.db.chatMessage.insert({ id: 0n, sender: p.identity, text: trimmed, tick: T, sentAt: ctx.timestamp, x: p.x, z: p.z });
    activity(ctx, p.identity, 'chats');
    // Keep the newest CHAT_KEEP_ROWS: usually exactly one line over, the oldest (smallest id) goes.
    const over = Number(ctx.db.chatMessage.count()) - CHAT_KEEP_ROWS;
    if (over === 1) {
      let oldest: bigint | undefined;
      for (const m of ctx.db.chatMessage.iter()) if (oldest === undefined || m.id < oldest) oldest = m.id;
      if (oldest !== undefined) ctx.db.chatMessage.id.delete(oldest);
    } else if (over > 1) {
      const ids = Array.from(ctx.db.chatMessage.iter(), (m) => m.id).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      for (let i = 0; i < over; i++) ctx.db.chatMessage.id.delete(ids[i]);
    }
  }
);

export const setName = spacetimedb.reducer(
  { name: t.string() },
  (ctx, { name }) => {
    const trimmed = name.trim();
    if (trimmed.length < NAME_MIN_LEN || trimmed.length > NAME_MAX_LEN) throw new SenderError('name length');
    if (!/^[A-Za-z0-9_ ]+$/.test(trimmed)) throw new SenderError('letters, numbers, _ and spaces only');
    const p = requirePlayer(ctx);
    touchInput(p, currentTick(ctx));
    for (const other of ctx.db.player.iter()) { // names only: no positions (lib/playerStore.ts)
      if (other.name.toLowerCase() === trimmed.toLowerCase() && other.identity.toHexString() !== p.identity.toHexString()) {
        throw new SenderError('name taken');
      }
    }
    p.name = trimmed;
    savePlayer(ctx, p);
  }
);
