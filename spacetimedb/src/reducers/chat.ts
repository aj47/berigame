import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { CHAT_KEEP_ROWS, MAX_CHAT_LEN, NAME_MAX_LEN, NAME_MIN_LEN } from '../../../shared/sim';
import { currentTick, requirePlayer, savePlayer, touchInput } from '../lib/players';

export const sendChat = spacetimedb.reducer(
  { text: t.string() },
  (ctx, { text }) => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_CHAT_LEN) throw new SenderError('bad message length');
    const p = requirePlayer(ctx);
    const T = currentTick(ctx);
    touchInput(p, T);
    savePlayer(ctx, p);
    ctx.db.chatMessage.insert({ id: 0n, sender: p.identity, text: trimmed, tick: T, sentAt: ctx.timestamp });
    const all = [...ctx.db.chatMessage.iter()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (let i = 0; i < all.length - CHAT_KEEP_ROWS; i++) ctx.db.chatMessage.id.delete(all[i].id);
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
    for (const other of ctx.db.player.iter()) {
      if (other.name.toLowerCase() === trimmed.toLowerCase() && other.identity.toHexString() !== p.identity.toHexString()) {
        throw new SenderError('name taken');
      }
    }
    p.name = trimmed;
    savePlayer(ctx, p);
  }
);
